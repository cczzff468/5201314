import { NextResponse } from 'next/server';

/**
 * 图像生成服务端转发（推荐模式，避免浏览器跨域 CORS 限制）：
 * - JSON（文生图）：转发到 OpenAI 兼容 {base}/images/generations；
 * - FormData（锁脸参考图）：转发到 OpenAI 兼容 {base}/images/edits（multipart，image=参考图）；
 * 响应统一为 { src: dataURL }（b64_json 直转 / url 由服务端拉取转存）或 { error }。
 * 与 /api/settings/models 同口径：baseUrl 归一化（修 /v1/v1、接受完整端点或基地址）。
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ImgGenBody {
  baseUrl?: unknown;
  apiKey?: unknown;
  model?: unknown;
  prompt?: unknown;
  size?: unknown;
  quality?: unknown;
  refDataUrl?: unknown;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 修重复版本段（粘贴常见错误：/v1/v1 → /v1），接受完整端点 / /v1 结尾 / 裸域名 */
function imggenEndpoints(rawBaseUrl: string): { generations: string[]; edits: string[] } {
  const t = rawBaseUrl.replace(/\/+$/, '').replace(/(\/v\d+)\/v\d+$/, '$1');
  if (/\/images\/generations$/.test(t)) return { generations: [t], edits: [t.replace(/generations$/, 'edits')] };
  if (/\/images\/edits$/.test(t)) return { generations: [t.replace(/edits$/, 'generations')], edits: [t] };
  const base = t.replace(/\/chat\/completions$/, '');
  const root = /\/v\d+$/.test(base) ? base : `${base}/v1`;
  return { generations: [`${root}/images/generations`], edits: [`${root}/images/edits`] };
}

/** 尽力提取上游错误原文 */
function extractUpstreamError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as { error?: unknown; message?: unknown };
    if (typeof obj.error === 'string' && obj.error) return obj.error;
    if (obj.error && typeof obj.error === 'object') {
      const e = obj.error as { message?: unknown };
      if (typeof e.message === 'string' && e.message) return e.message;
    }
    if (typeof obj.message === 'string' && obj.message) return obj.message;
  }
  return `生图接口错误（HTTP ${status}）`;
}

/** 从任意形态的图片响应取出第一张图：b64_json → dataURL；url → 服务端拉取转 dataURL */
async function pickImage(payload: unknown): Promise<string | null> {
  const obj = payload as { data?: unknown; images?: unknown; url?: unknown; b64_json?: unknown } | null;
  let item: unknown = null;
  if (obj && Array.isArray(obj.data) && obj.data.length > 0) item = obj.data[0];
  else if (obj && Array.isArray(obj.images) && obj.images.length > 0) item = obj.images[0];
  else if (obj && (typeof obj.url === 'string' || typeof obj.b64_json === 'string')) item = obj;

  if (item && typeof item === 'object') {
    const it = item as { b64_json?: unknown; url?: unknown };
    if (typeof it.b64_json === 'string' && it.b64_json) return `data:image/png;base64,${it.b64_json}`;
    if (typeof it.url === 'string' && it.url) {
      try {
        const imgRes = await fetch(it.url, { signal: AbortSignal.timeout(60_000) });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const mime = imgRes.headers.get('content-type') || 'image/png';
          if (mime.startsWith('image/')) return `data:${mime};base64,${buf.toString('base64')}`;
        }
      } catch {
        /* url 拉取失败按无图处理 */
      }
    }
  }
  return null;
}

/** dataURL → { buffer, mime }；非法返回 null */
function parseDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const m = /^data:([^;,]+)(;[^,]*)?,(.*)$/.exec(dataUrl);
  if (!m) return null;
  try {
    return { buffer: Buffer.from(m[3], 'base64'), mime: m[1] || 'image/png' };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let contentType = req.headers.get('content-type') ?? '';
  contentType = contentType.toLowerCase();

  try {
    let baseUrl = '';
    let apiKey = '';
    let model = '';
    let prompt = '';
    let size = '1024x1024';
    let quality = '';
    let refBuffer: Buffer | null = null;
    let refMime = '';

    if (contentType.includes('multipart/form-data')) {
      // 锁脸参考图：FormData（edits）
      const fd = await req.formData();
      baseUrl = str(fd.get('baseUrl'));
      apiKey = str(fd.get('apiKey'));
      model = str(fd.get('model'));
      prompt = str(fd.get('prompt'));
      size = str(fd.get('size')) || '1024x1024';
      quality = str(fd.get('quality'));
      const img = fd.get('image');
      if (img instanceof Blob) {
        refBuffer = Buffer.from(await img.arrayBuffer());
        refMime = img.type || 'image/png';
      } else if (typeof img === 'string') {
        const parsed = parseDataUrl(img);
        if (parsed) {
          refBuffer = parsed.buffer;
          refMime = parsed.mime;
        }
      }
    } else {
      const body = (await req.json().catch(() => null)) as ImgGenBody | null;
      if (!body) return NextResponse.json({ error: '请求体不是有效 JSON' }, { status: 400 });
      baseUrl = str(body.baseUrl);
      apiKey = str(body.apiKey);
      model = str(body.model);
      prompt = str(body.prompt);
      size = str(body.size) || '1024x1024';
      quality = str(body.quality);
      if (typeof body.refDataUrl === 'string' && body.refDataUrl.startsWith('data:image/')) {
        const parsed = parseDataUrl(body.refDataUrl);
        if (parsed) {
          refBuffer = parsed.buffer;
          refMime = parsed.mime;
        }
      }
    }

    if (!baseUrl) return NextResponse.json({ error: '缺少 API 地址' }, { status: 400 });
    if (!apiKey) return NextResponse.json({ error: '缺少 API Key' }, { status: 400 });
    if (!model) return NextResponse.json({ error: '缺少模型名' }, { status: 400 });
    if (!prompt) return NextResponse.json({ error: '缺少生图提示词' }, { status: 400 });

    const eps = imggenEndpoints(baseUrl);
    const timeoutMs = 280_000;

    // —— 锁脸：带参考图 → /images/edits（multipart） ——
    if (refBuffer) {
      let lastError = '生图失败';
      for (const ep of eps.edits) {
        try {
          const fd = new FormData();
          fd.append('image', new Blob([new Uint8Array(refBuffer)], { type: refMime || 'image/png' }), 'ref.png');
          fd.append('prompt', prompt);
          fd.append('model', model);
          fd.append('n', '1');
          if (size && size !== 'auto') fd.append('size', size);
          if (quality && quality !== 'auto') fd.append('quality', quality);
          const res = await fetch(ep, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: fd,
            signal: AbortSignal.timeout(timeoutMs),
          });
          const payload = (await res.json().catch(() => null)) as unknown;
          if (!res.ok) {
            lastError = extractUpstreamError(payload, res.status);
            continue;
          }
          const src = await pickImage(payload);
          if (src) return NextResponse.json({ src });
          lastError = '接口没有返回图片';
        } catch (e) {
          lastError = e instanceof Error ? e.message : '生图请求失败';
        }
      }
      return NextResponse.json({ error: lastError }, { status: 502 });
    }

    // —— 文生图：/images/generations（JSON） ——
    let lastError = '生图失败';
    for (const ep of eps.generations) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            prompt,
            n: 1,
            ...(size && size !== 'auto' ? { size } : {}),
            ...(quality && quality !== 'auto' ? { quality } : {}),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const payload = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) {
          lastError = extractUpstreamError(payload, res.status);
          continue;
        }
        const src = await pickImage(payload);
        if (src) return NextResponse.json({ src });
        lastError = '接口没有返回图片';
      } catch (e) {
        lastError = e instanceof Error ? e.message : '生图请求失败';
      }
    }
    return NextResponse.json({ error: lastError }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '生图请求失败' }, { status: 500 });
  }
}
