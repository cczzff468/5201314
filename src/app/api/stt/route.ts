import { NextRequest, NextResponse } from 'next/server';

/**
 * 语音 API · 语音识别代理（POST /api/stt）——录音文件转写服务端兑底（Web Speech 为主，见 web-speech.ts）
 * 请求形态（multipart/form-data）：config（JSON 字符串 {provider:'openai', baseUrl, apiKey, model?}）+ audio（录音文件）
 * 转发到 OpenAI 兼容 {baseUrl}/audio/transcriptions（Whisper 等）。
 * 内置识别模型（z-ai ASR）已移除：未配置 OpenAI 兼容服务商时前端不会请求本路由。
 * 返回 { text }；失败返回 { error }（中文文案，绝不回显 API Key）。
 */

import { httpsRequest, normalizeTtsBaseUrl, upstreamStatusMessage } from '@/lib/server-tts';

export const runtime = 'nodejs';

/** OpenAI 兼容：拼 audio/transcriptions 端点（与 speech 同规则：/v1 结尾追加；否则补 /v1） */
function openaiTranscriptionsUrl(base: string): string {
  const stripped = /audio\/(speech|transcriptions)/i.test(base)
    ? base.replace(/\/audio\/(speech|transcriptions).*$/i, '')
    : base;
  if (/\/audio\/transcriptions$/i.test(stripped)) return stripped;
  if (/\/v1$/i.test(stripped)) return `${stripped}/audio/transcriptions`;
  return `${stripped}/v1/audio/transcriptions`;
}

/** 手工组装 multipart/form-data 请求体（node:https 强制 IPv4 转发二进制音频用） */
function buildMultipartBody(
  fields: { name: string; value: string }[],
  file: { name: string; filename: string; contentType: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----sttform${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const head: Buffer[] = [];
  for (const f of fields) {
    head.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`, 'utf8'));
  }
  head.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      'utf8',
    ),
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { body: Buffer.concat([...head, file.data, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';

  // ---------------- OpenAI 兼容（multipart 转发；内置识别已移除，JSON/builtin 请求一律拒绝） ----------------
  if (contentType.includes('application/json')) {
    return NextResponse.json(
      { error: '内置识别模型已移除，请在设置 App 配置 OpenAI 兼容语音识别（STT），或使用浏览器实时识别' },
      { status: 400 },
    );
  }

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: '请求必须是 multipart/form-data' }, { status: 400 });
    }
    const rawCfg = form.get('config');
    let cfg: { provider?: unknown; baseUrl?: unknown; apiKey?: unknown; model?: unknown } = {};
    if (typeof rawCfg === 'string') {
      try {
        cfg = JSON.parse(rawCfg) as typeof cfg;
      } catch {
        return NextResponse.json({ error: 'config 字段必须是合法的 JSON' }, { status: 400 });
      }
    }
    if (cfg.provider !== 'openai') {
      return NextResponse.json({ error: '不支持的服务商' }, { status: 400 });
    }
    const baseUrl = normalizeTtsBaseUrl(typeof cfg.baseUrl === 'string' ? cfg.baseUrl : '');
    const apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : '';
    if (!baseUrl) {
      return NextResponse.json({ error: '请先填写语音识别（STT）的 API 地址' }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: '请先填写语音识别（STT）的 API Key' }, { status: 400 });
    }
    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json({ error: '缺少音频文件' }, { status: 400 });
    }
    // 60s opus ≈ 240KB；宽松上限 10MB 防滥用
    if (audio.size > 10_000_000) {
      return NextResponse.json({ error: '录音太长，请说短一点' }, { status: 413 });
    }
    const model = typeof cfg.model === 'string' && cfg.model.trim() ? cfg.model.trim().slice(0, 120) : 'whisper-1';
    const audioBuf = Buffer.from(await audio.arrayBuffer());
    const ext = /mp4|m4a|aac/i.test(audio.type) ? 'm4a' : /ogg/i.test(audio.type) ? 'ogg' : /wav/i.test(audio.type) ? 'wav' : 'webm';
    const { body, contentType: mpType } = buildMultipartBody(
      [{ name: 'model', value: model }],
      { name: 'file', filename: `voice.${ext}`, contentType: audio.type || 'audio/webm', data: audioBuf },
    );
    try {
      const r = await httpsRequest({
        method: 'POST',
        url: openaiTranscriptionsUrl(baseUrl),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': mpType, 'Content-Length': String(body.length) },
        body,
        timeoutMs: 60_000,
      });
      if (r.status < 200 || r.status >= 300) {
        // 上游错误：透出业务文案（401/429 等语义化），不回显 Key
        let upstream: string | null = null;
        if (r.json && typeof r.json === 'object') {
          const j = r.json as { error?: unknown; message?: unknown; text?: unknown };
          if (typeof j.message === 'string') upstream = j.message;
          else if (typeof j.text === 'string') upstream = j.text;
          else if (j.error && typeof j.error === 'object' && typeof (j.error as { message?: unknown }).message === 'string') {
            upstream = (j.error as { message: string }).message;
          } else if (typeof j.error === 'string') {
            upstream = j.error;
          }
        }
        const detail = typeof upstream === 'string' && upstream ? upstream : upstreamStatusMessage(r.status);
        return NextResponse.json({ error: `转文字失败：${detail}` }, { status: 502 });
      }
      let text = '';
      if (r.json && typeof r.json === 'object' && typeof (r.json as Record<string, unknown>).text === 'string') {
        text = (r.json as Record<string, unknown>).text as string;
      } else {
        // 非 JSON（个别网关直接返回纯文本）
        text = r.binary.toString('utf8');
      }
      return NextResponse.json({ text: text.trim() });
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : '未知错误';
      return NextResponse.json({ error: `转文字失败：${detail}` }, { status: 502 });
    }
  }

  return NextResponse.json({ error: '不支持的请求类型' }, { status: 400 });
}
