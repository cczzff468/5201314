'use client';

/**
 * 图像生成（生图）+ 锁脸 —— 共享逻辑层（微信 / QQ / 信息单聊共用；群聊暂不触发）。
 *
 * 功能结构：
 * 1. 配置：全局 ImgGenConfig（settings store，与聊天/识图配置独立）——提供方固定 OpenAI 兼容
 *    （DALL·E / gpt-image / Flux 等兼容 /images/generations、/images/edits 的网关）；
 *    请求方式 = 服务端转发（/api/imggen，推荐，免跨域）或浏览器直连（需接口允许 CORS）；
 * 2. 锁脸：每个角色独立的「参考图」（imggen-ref:<contactId>，dataURL 压缩存 kv）+ 可选「外貌描述」
 *    （imggen-appearance:<contactId>）。生成时：
 *    - 有参考图 → 优先走 /images/edits（multipart，参考图作为输入图），脸随参考图保持一致；
 *      若接口不支持 edits（4xx），自动回退 generations 并把外貌描述拼进提示词兜底；
 *    - 无参考图 → generations，把「外貌描述」拼进提示词尽量保持一致性；
 * 3. 照片标签：AI 回复文本里输出 [照片:描述]（或朋友圈同款 [照片:使用参考图:描述] /
 *    [照片:不使用参考图:描述]，兼容全角【】与中英文冒号），extractPhotoTags 从气泡文本剥出标签，
 *    每个标签经 generateCharacterPhoto 生图后以 kind='image' 消息追加进聊天；
 * 4. 生成结果：聊天显示 + 自动存入该角色相册（origin 'ai'，AI 后续可用 [选图发送] 重发）+
 *    写记忆（30 分钟节流，不刷屏）；失败只落系统提示行，不影响聊天；
 * 5. 手动触发：微信加号面板 / QQ 星星面板「生成照片」（填描述 → 角色以第一人称拍一张发出来）；
 * 6. 稳健性（Task 20-a1）：客户端生图请求统一 150s 超时（AbortSignal.timeout，超时转友好文案）；
 *    照片标签描述上限放宽到 400 字（朋友圈双语描述过长会令整个标签识别失败原样上屏）；
 *    新增流式分段防截断工具（UNFINISHED_PHOTO_TAG_RE / splitUnfinishedPhotoTag /
 *    stripUnfinishedPhotoTag，标签跨段 carry-over / 兜底剥除用）。
 */

import { kvDel, kvGet, kvSet } from '@/lib/ios/idb-kv';
import type { ImgGenConfig } from '@/lib/ios/store';
import { memAddEventFragment } from '@/lib/memory';

// ---------------- 锁脸：角色参考图 + 外貌描述（按 contactId 隔离） ----------------

export interface ImgGenFaceRef {
  /** 参考图 dataURL（上传时已压缩） */
  src: string;
  updatedAt: number;
}

const refKeyOf = (contactId: string) => `imggen-ref:${contactId}`;
const appearKeyOf = (contactId: string) => `imggen-appearance:${contactId}`;

/** 读角色参考图（无 / 坏数据 = null） */
export function getFaceRef(contactId: string): ImgGenFaceRef | null {
  const raw = kvGet(refKeyOf(contactId)) as Partial<ImgGenFaceRef> | null | undefined;
  if (raw && typeof raw.src === 'string' && raw.src.startsWith('data:image/')) {
    return { src: raw.src, updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0 };
  }
  return null;
}

/** 写 / 替换角色参考图；src=null 删除 */
export function setFaceRef(contactId: string, src: string | null): void {
  if (!contactId) return;
  if (src === null) {
    kvDel(refKeyOf(contactId));
    return;
  }
  kvSet(refKeyOf(contactId), { src, updatedAt: Date.now() });
}

/** 读角色外貌描述（锁脸兜底文案；空串 = 未填） */
export function getAppearanceNote(contactId: string): string {
  const v = kvGet(appearKeyOf(contactId));
  return typeof v === 'string' ? v.trim() : '';
}

/** 写角色外貌描述（空串 = 清除） */
export function setAppearanceNote(contactId: string, note: string): void {
  if (!contactId) return;
  kvSet(appearKeyOf(contactId), note.trim());
}

// ---------------- 图片压缩（上传参考图 / 落库生成结果共用） ----------------

/**
 * 把 dataURL 压缩（缩放到 maxPx 内 + JPEG 重编码）；失败原样返回（不阻塞主流程）。
 * 参考图默认 512px（脸要清楚、体积可控 ~50-150KB），生成结果默认 1024px（聊天展示清晰）。
 */
export function compressImageSrc(src: string, maxPx = 512, quality = 0.86): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(src);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    } catch {
      resolve(src);
    }
  });
}

// ---------------- 照片标签：提取（从 AI 回复文本剥出） ----------------

export interface PhotoTag {
  /** 画面描述（生图提示词主体） */
  desc: string;
  /** 是否指定使用参考图（朋友圈同款三段式标签 [照片:使用参考图:desc]） */
  useRef: boolean;
}

const PHOTO_TAG_RE =
  /[【\[]\s*(?:照片|图片)\s*[:：]\s*(使用参考图|不使用参考图|不用参考图)?\s*[:：]?\s*([^\]】]{1,400})[\]】]/g;

/**
 * 从回复文本里提取全部照片标签并从原文剥除：
 * 支持 [图片:描述] / [照片:描述] / 【图片：描述】全角变体 / [照片:使用参考图:描述] / [照片:不使用参考图:描述]
 * （desc 为空 / 全空白的标签直接丢弃；图片/照片两种写法都认——prompt 教的是 [图片:描述]，兼容模型输出的旧写法）；
 * useRef 语义：默认 true（有参考图就锁脸），仅明确写「不使用参考图/不用参考图」才为 false；
 * 描述长度上限 400 字（原 160：朋友圈双语模式下照片描述会中英双语化，上限过短会导致整个标签
 * 匹配失败、标签原样上屏不剥除）。
 */
export function extractPhotoTags(text: string): { text: string; tags: PhotoTag[] } {
  if (!text || (text.indexOf('照片') === -1 && text.indexOf('图片') === -1)) return { text, tags: [] };
  const tags: PhotoTag[] = [];
  const stripped = text.replace(PHOTO_TAG_RE, (_m, mode: string | undefined, desc: string) => {
    const d = (desc ?? '').trim();
    if (d) tags.push({ desc: d, useRef: mode !== '不使用参考图' && mode !== '不用参考图' });
    return '';
  });
  return { text: stripped.replace(/[ \t]{2,}/g, ' ').trim(), tags };
}

/** 文本里是否含未剥除的照片标签（渲染层防御性提示用；一般提取后即无） */
export function hasPhotoTag(text: string): boolean {
  return /[【\[]\s*(?:照片|图片)\s*[:：]/.test(text ?? '');
}

// ---------------- 流式分段防截断：照片标签跨段 carry-over ----------------

/**
 * 尾部未闭合的照片标签起始（尾部 $ 锚定）：流式输出把一段完整回复切成多个分段时，
 * [图片:xxx] / [照片:使用参考图:xxx] 可能正好被切成两半，前一段会以此正则的匹配结尾。
 */
export const UNFINISHED_PHOTO_TAG_RE = /[【\[]\s*(?:照片|图片)\s*[:：][^\]】]*$/;

/**
 * 流式分段 carry-over：若 text 尾部是未闭合的照片标签起始（如「[图片:黄昏的咖」），
 * 把该部分截出作为 carry（与下一段拼接后再走 extractPhotoTags 解析），send 为本段
 * 可立即解析/投递的部分；未命中则原样返回（send=text、carry 空串）。
 * 不做处理的话，半截标签会被当普通文本上屏，且下一段的剩余部分也无法闭合还原。
 */
export function splitUnfinishedPhotoTag(text: string): { send: string; carry: string } {
  const t = text ?? '';
  const m = UNFINISHED_PHOTO_TAG_RE.exec(t);
  if (!m) return { send: t, carry: '' };
  return { send: t.slice(0, m.index), carry: t.slice(m.index) };
}

/**
 * 直接剥掉尾部未闭合的照片标签起始（渲染/投递兜底用，防半截标签上屏）。
 * 只影响尾部这一处未闭合起始；已闭合的完整标签不归它管（由 extractPhotoTags 剥除）。
 */
export function stripUnfinishedPhotoTag(text: string): string {
  return (text ?? '').replace(UNFINISHED_PHOTO_TAG_RE, '');
}

// ---------------- 提示词规则（聊天 system 注入） ----------------

/**
 * 生图照片标签规则：注入聊天 system，让 AI 知道自己可以「发图片」（能力常开——
 * 对方配置了生图就收到真实照片，没配置/生成失败会收到一张写着画面描述的文字图片卡片，AI 无需关心）。
 * 描述用第三人称画面描述（锁脸会自动带上角色本人形象），不要在描述里写文字/水印要求。
 */
export function buildPhotoTagRule(charName: string): string {
  return (
    `【发图片能力】你（${charName}）可以在回复里发一张你拍的照片/图片：在回复文本里输出标签 [图片:画面描述]，系统会把标签替换成真实图片发给对方。\n` +
    `- 格式：[图片:画面描述]，描述用具体的画面语言（场景/构图/光线/动作/表情/氛围，20~60字），如「[图片:黄昏的咖啡厅窗边，长发女生托腮看镜头，暖光落在侧脸上]」；一次最多一张；不要包含文字/水印/分镜要求；标签单独或放在消息末尾，不要套在引号里。\n` +
    `- 何时发：结合你的人设、当前聊天内容、你们的共同回忆和此刻的情绪，自然想分享的瞬间（想让TA看你的样子、眼前的风景、正在做的事、有纪念意义的时刻）才发；要有节制——大多数回复不带图，不要每条都发，不要连发。\n` +
    `- 系统会按你的形象生成照片（面部与你本人一致），描述里不用写五官长相；你不需要描述照片「已发出」以外的话，不要假装对方点评过照片内容，也不用解释技术细节。`
  );
}

// ---------------- 生成管线 ----------------

/** 配置是否可用（自动/手动生图前的统一门槛） */
export function imgGenConfigReady(cfg: ImgGenConfig): boolean {
  return Boolean(cfg.baseUrl.trim() && cfg.apiKey.trim() && cfg.model.trim());
}

/** 生图最终提示词拼装：画面描述 + （无参考图时）外貌描述 + 补充提示词 */
export function buildFinalPrompt(cfg: ImgGenConfig, desc: string, appearance: string, withAppearance: boolean): string {
  const parts: string[] = [];
  const d = desc.trim();
  if (d) parts.push(d);
  if (withAppearance && appearance) parts.push(appearance);
  const extra = cfg.extraPrompt.trim();
  if (extra) parts.push(extra);
  return parts.join('，');
}

/** 记忆节流：同角色两条照片记忆至少间隔 30 分钟（「不刷屏」） */
const MEM_THROTTLE_MS = 30 * 60 * 1000;
const memLastKey = (contactId: string) => `imggen-mem-last:${contactId}`;

/** 生图成功后写一条轻量记忆（节流；失败静默） */
export function notePhotoMemory(contactId: string, app: 'wx' | 'qq' | 'sms', desc: string): void {
  try {
    const last = Number(kvGet(memLastKey(contactId)) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < MEM_THROTTLE_MS) return;
    kvSet(memLastKey(contactId), Date.now());
    const d = desc.trim().slice(0, 60) || '一张照片';
    void memAddEventFragment(contactId, app, `（拍了一张照片发给你：${d}）`, { sourceTag: 'imggen' });
  } catch {
    /* 记忆失败不影响聊天 */
  }
}

/**
 * 把图片（dataURL 或 URL）触发浏览器下载（长按菜单「保存」共用三端）；失败返回 false。
 */
export function downloadImageSrc(src: string, name?: string): boolean {
  try {
    const a = document.createElement('a');
    a.href = src;
    a.download = name || `photo-${Date.now()}.png`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

// ---------------- OpenAI 兼容生图（服务端转发 / 浏览器直连 共用参数拼装） ----------------

/** 归一化基地址 → /images/generations 与 /images/edits 两个端点候选（修 /v1/v1、粘贴完整端点等常见错误） */
export function imggenEndpoints(baseUrl: string): { generations: string[]; edits: string[] } {
  const t = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/(\/v\d+)\/v\d+$/, '$1');
  // 已粘贴完整端点：直接用
  if (/\/images\/generations$/.test(t)) return { generations: [t], edits: [t.replace(/generations$/, 'edits')] };
  if (/\/images\/edits$/.test(t)) return { generations: [t.replace(/edits$/, 'generations')], edits: [t] };
  // /chat/completions 结尾（从聊天配置顺手抄来）：退一层
  const base = t.replace(/\/chat\/completions$/, '');
  // 已带 /v1：直接拼；否则补 /v1（OpenAI 兼容网关默认）
  const root = /\/v\d+$/.test(base) ? base : `${base}/v1`;
  return { generations: [`${root}/images/generations`], edits: [`${root}/images/edits`] };
}

/** dataURL → Blob（multipart edits 用） */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const m = /^data:([^;,]+)(;[^,]*)?,(.*)$/.exec(dataUrl);
    if (!m) return null;
    const bin = atob(m[3]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] || 'image/png' });
  } catch {
    return null;
  }
}

/** 从任意形态的图片响应里取出图片（b64_json 直转 / url 拉取；多张取第一张） */
export async function pickImageFromResponse(payload: unknown): Promise<string | null> {
  try {
    const obj = payload as { data?: unknown; images?: unknown; url?: unknown; b64_json?: unknown };
    let item: unknown = null;
    if (Array.isArray(obj?.data) && obj.data.length > 0) item = obj.data[0];
    else if (Array.isArray(obj?.images) && obj.images.length > 0) item = obj.images[0];
    else if (typeof obj?.url === 'string' || typeof obj?.b64_json === 'string') item = obj;
    if (item && typeof item === 'object') {
      const it = item as { b64_json?: unknown; url?: unknown; image_url?: unknown };
      if (typeof it.b64_json === 'string' && it.b64_json) return `data:image/png;base64,${it.b64_json}`;
      const u = typeof it.url === 'string' ? it.url : typeof it.image_url === 'string' ? it.image_url : null;
      if (u) {
        const res = await fetch(u);
        if (res.ok) {
          const blob = await res.blob();
          return await new Promise<string | null>((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
            fr.onerror = () => resolve(null);
            fr.readAsDataURL(blob);
          });
        }
      }
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

/** 尽力提取上游错误信息 */
export function extractImgGenError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as { error?: unknown; message?: unknown };
    if (typeof obj.error === 'string' && obj.error) return obj.error;
    if (obj.error && typeof obj.error === 'object') {
      const e = obj.error as { message?: unknown };
      if (typeof e.message === 'string' && e.message) return e.message;
    }
    if (typeof obj.message === 'string' && obj.message) return obj.message;
  }
  return fallback;
}

export interface GenerateCharacterPhotoArgs {
  cfg: ImgGenConfig & { mode?: 'proxy' | 'direct' };
  /** 角色 ID（读参考图/外貌描述） */
  contactId: string;
  /** 画面描述（照片标签内容 / 手动输入） */
  desc: string;
  /** 角色名（错误提示/日志用） */
  charName: string;
  /** 是否尝试使用参考图（标签明确「不使用参考图」时传 false） */
  useRef?: boolean;
}

export interface GenerateCharacterPhotoResult {
  /** 生成图 dataURL（已压缩） */
  src: string;
  /** 实际使用的提示词（记忆/日志用） */
  prompt: string;
  /** 是否走了参考图（edits） */
  usedRef: boolean;
}

/**
 * 给角色生成一张照片（锁脸主入口）：
 * 1. 读参考图/外貌描述 → 拼提示词；
 * 2. 有参考图且 useRef：先试 /images/edits（multipart 带参考图）；接口不支持（非 2xx）→ 回退 generations+外貌描述；
 * 3. mode='proxy' 走 /api/imggen 服务端转发；mode='direct' 浏览器直连（需 CORS）；
 * 4. 结果压缩到 ≤1024px 返回。
 */
export async function generateCharacterPhoto(args: GenerateCharacterPhotoArgs): Promise<GenerateCharacterPhotoResult> {
  const { cfg, contactId, desc, charName } = args;
  const useRef = args.useRef !== false;
  const ref = useRef ? getFaceRef(contactId) : null;
  const appearance = getAppearanceNote(contactId);
  const prompt = buildFinalPrompt(cfg, desc, appearance, !ref);

  // —— 请求参数（proxy/direct 共用） ——
  const mode: 'proxy' | 'direct' = cfg.mode === 'direct' ? 'direct' : 'proxy';
  const bodyBase = {
    mode,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    prompt,
    size: cfg.size.trim() || '1024x1024',
    quality: cfg.quality.trim(),
  };

  let rawSrc: string | null = null;
  let usedRef = false;

  if (ref) {
    // 先试 edits（带参考图锁脸）
    try {
      rawSrc = await requestImage({ ...bodyBase, refDataUrl: ref.src });
      usedRef = rawSrc != null;
    } catch {
      rawSrc = null;
    }
    // edits 不支持 → 回退 generations + 外貌描述兜底
    if (!rawSrc) {
      const fallbackPrompt = buildFinalPrompt(cfg, desc, appearance, true);
      rawSrc = await requestImage({ ...bodyBase, prompt: fallbackPrompt, refDataUrl: null });
      usedRef = false;
    }
  } else {
    rawSrc = await requestImage({ ...bodyBase, refDataUrl: null });
  }

  if (!rawSrc) {
    throw new Error(`${charName}的照片生成失败：接口没有返回图片`);
  }

  const src = await compressImageSrc(rawSrc, 1024, 0.9);
  if (!src.startsWith('data:image/')) throw new Error(`${charName}的照片生成失败：返回内容不是有效图片`);
  return { src, prompt, usedRef };
}

/**
 * 通用单张生图（无角色 / 无锁脸）：美团「我的公益」等非聊天场景用。
 * 与 generateCharacterPhoto 同一条请求管线（proxy / direct、150s 超时、压缩），
 * 只是不带参考图与外貌描述；失败抛错（错误文案已友好化）。
 */
export async function generateFreePhoto(
  cfg: ImgGenConfig & { mode?: 'proxy' | 'direct' },
  desc: string,
): Promise<string> {
  const prompt = buildFinalPrompt(cfg, desc, '', false);
  const mode: 'proxy' | 'direct' = cfg.mode === 'direct' ? 'direct' : 'proxy';
  const rawSrc = await requestImage({
    mode,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    prompt,
    size: cfg.size.trim() || '1024x1024',
    quality: cfg.quality.trim(),
    refDataUrl: null,
  });
  if (!rawSrc) throw new Error('图片生成失败：接口没有返回图片');
  const src = await compressImageSrc(rawSrc, 1024, 0.9);
  if (!src.startsWith('data:image/')) throw new Error('图片生成失败：返回内容不是有效图片');
  return src;
}

/** 客户端生图请求超时（150s）：服务端 /api/imggen 自身已有 280s 上限，客户端提前降级避免干等 */
const REQUEST_TIMEOUT_MS = 150_000;
/** 超时/中断的统一友好文案 */
const REQUEST_TIMEOUT_MSG = '生图请求超时，请稍后重试';

/**
 * 是否为超时/中断类错误：AbortSignal.timeout 触发的是 DOMException（name='TimeoutError'，
 * 手动 abort / 部分运行时为 'AbortError'），但各端 message 措辞不一，兜底按关键字识别。
 */
function isTimeoutError(e: unknown): boolean {
  if (typeof DOMException !== 'undefined' && e instanceof DOMException) {
    return e.name === 'TimeoutError' || e.name === 'AbortError';
  }
  return e instanceof Error && /timeout|abort/i.test(`${e.name}${e.message}`);
}

/** fetch + 150s 超时（AbortSignal.timeout）；超时/中断错误统一转友好文案，其余错误原样抛出 */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    if (isTimeoutError(e)) throw new Error(REQUEST_TIMEOUT_MSG);
    throw e;
  }
}

/** 单次生图请求：proxy 走 /api/imggen；direct 浏览器直连。返回原始 dataURL；失败抛错（含 150s 超时） */
async function requestImage(body: {
  mode: 'proxy' | 'direct';
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  refDataUrl: string | null;
}): Promise<string | null> {
  if (body.refDataUrl) {
    // edits：multipart（proxy 与 direct 都用 FormData）
    const fd = new FormData();
    fd.append('baseUrl', body.baseUrl);
    fd.append('apiKey', body.apiKey);
    fd.append('model', body.model);
    fd.append('prompt', body.prompt);
    fd.append('size', body.size);
    if (body.quality && body.quality !== 'auto') fd.append('quality', body.quality);
    const blob = dataUrlToBlob(body.refDataUrl);
    if (blob) fd.append('image', blob, 'ref.png');
    return body.mode === 'proxy'
      ? postProxy(fd)
      : postDirectMultipart(body.baseUrl, body.apiKey, body.model, body.prompt, body.size, body.quality, blob);
  }
  if (body.mode === 'proxy') {
    const res = await fetchWithTimeout('/api/imggen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { src?: string; error?: string } | null;
    if (!res.ok || !data?.src) throw new Error(data?.error || `生图接口错误（${res.status}）`);
    return data.src;
  }
  // direct JSON generations
  const eps = imggenEndpoints(body.baseUrl);
  let lastErr = '生图失败';
  for (const ep of eps.generations) {
    try {
      const res = await fetchWithTimeout(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.apiKey}` },
        body: JSON.stringify({
          model: body.model,
          prompt: body.prompt,
          n: 1,
          ...(body.size && body.size !== 'auto' ? { size: body.size } : {}),
          ...(body.quality && body.quality !== 'auto' ? { quality: body.quality } : {}),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        lastErr = extractImgGenError(payload, `生图接口错误（${res.status}）`);
        continue;
      }
      const src = await pickImageFromResponse(payload);
      if (src) return src;
      lastErr = '接口没有返回图片';
    } catch (e) {
      lastErr = isTimeoutError(e)
        ? REQUEST_TIMEOUT_MSG
        : e instanceof Error
          ? e.message
          : '网络错误（检查接口是否允许跨域 CORS）';
    }
  }
  throw new Error(lastErr);
}

/** proxy + multipart：/api/imggen 原样转发 FormData（带 150s 超时） */
async function postProxy(fd: FormData): Promise<string | null> {
  const res = await fetchWithTimeout('/api/imggen', { method: 'POST', body: fd });
  const data = (await res.json().catch(() => null)) as { src?: string; error?: string } | null;
  if (!res.ok || !data?.src) throw new Error(data?.error || `生图接口错误（${res.status}）`);
  return data.src;
}

/** direct + multipart：浏览器直连 /images/edits */
async function postDirectMultipart(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
  quality: string,
  blob: Blob | null,
): Promise<string | null> {
  const eps = imggenEndpoints(baseUrl);
  let lastErr = '生图失败';
  for (const ep of eps.edits) {
    try {
      const fd = new FormData();
      if (blob) fd.append('image', blob, 'ref.png');
      fd.append('prompt', prompt);
      fd.append('model', model);
      fd.append('n', '1');
      if (size && size !== 'auto') fd.append('size', size);
      if (quality && quality !== 'auto') fd.append('quality', quality);
      const res = await fetchWithTimeout(ep, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        lastErr = extractImgGenError(payload, `生图接口错误（${res.status}）`);
        continue;
      }
      const src = await pickImageFromResponse(payload);
      if (src) return src;
      lastErr = '接口没有返回图片';
    } catch (e) {
      lastErr = isTimeoutError(e)
        ? REQUEST_TIMEOUT_MSG
        : e instanceof Error
          ? e.message
          : '网络错误（检查接口是否允许跨域 CORS）';
    }
  }
  throw new Error(lastErr);
}

// ---------------- 聊天记录压缩（三端生图画面构思 / 文字图片卡片共用） ----------------

/** 聊天记录条目的最小形态（ChatMsg/WxMsg/QQMsg 的公共子集；图片 dataURL 不外泄，只取描述占位） */
export type PhotoDescHistoryItem = {
  role: string;
  content: string;
  kind?: string;
  img?: { desc?: string } | null;
  voice?: { transcript?: string; localText?: string } | null;
};

/**
 * 聊天记录 → 上下文短行（生图画面构思 / 文字图片卡片共用）：逐条压成「我：… / TA：…」；
 * 图片 →「[图片]（图片内容：…）」占位（QQ 端图片 dataURL 存 content，绝不进上下文）；
 * 语音 → 转写文本；每行截断 80 字，最多取最近 max 条。
 */
export function buildPhotoDescHistory(
  items: PhotoDescHistoryItem[],
  myLabel = '我',
  peerLabel = 'TA',
  max = 14,
): string[] {
  const line = (who: string, text: string) => `${who}：${text}`;
  return items
    .filter((m) => m.kind !== 'sys' && m.kind !== 'notice')
    .slice(-max)
    .map((m) => {
      const who = m.role === 'me' || m.role === 'user' ? myLabel : peerLabel;
      if (m.kind === 'image') return line(who, m.img?.desc ? `[图片]（图片内容：${m.img.desc}）` : '[图片]');
      if (m.kind === 'voice') return line(who, m.voice?.transcript || m.voice?.localText || '[语音]');
      const t = (m.content ?? '').trim();
      if (!t || t.startsWith('data:image/')) return '';
      return line(who, t.length > 80 ? `${t.slice(0, 80)}…` : t);
    })
    .filter(Boolean);
}
