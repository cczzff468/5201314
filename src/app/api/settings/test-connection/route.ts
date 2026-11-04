import { NextResponse } from 'next/server';

/**
 * 自定义 API「测试连接」（服务端代理测连）。
 *
 * 与 /api/settings/models 同一套口径：
 * - 归一化出 chat/completions 端点候选（完整端点 / /v1 结尾 / 裸域名，自动修 /v1/v1）
 * - 私网地址 / 网络不可达 / 地区限制 → directOnly:true，客户端改用浏览器直连兜底
 * - 上游有响应但配置有误（401/403/404/400/429…）→ 透传上游错误原文 + connected:true
 *   （客户端显示黄色「接口本身可达，问题出在配置」提示）
 */

interface UpstreamErrorShape {
  error?: { message?: unknown } | string;
  message?: unknown;
}

/** 尽力提取上游错误原文（{error:{message}} / {error:"..."} / {message}） */
function extractUpstreamError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as UpstreamErrorShape;
  if (typeof obj.error === 'string') return obj.error;
  if (obj.error && typeof obj.error === 'object' && typeof obj.error.message === 'string') {
    return obj.error.message;
  }
  if (typeof obj.message === 'string') return obj.message;
  return '';
}

/** 修正重复的版本段（粘贴常见错误：/v1/v1 → /v1） */
function collapseVersions(u: string): string {
  return u.replace(/(\/v\d+)\/v\d+$/, '$1').replace(/(\/v\d+)\/v\d+(?=\/chat\/completions)/, '$1');
}

/** 私有/本机地址（云端服务器不可达，客户端应改用浏览器直连） */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

/** 与 /api/chat buildChatCandidates 一致：兼容完整端点 / /v1 结尾 / 裸域名三种写法 */
function buildChatCandidates(rawBaseUrl: string): string[] {
  let base = collapseVersions(rawBaseUrl.trim().replace(/\/+$/, ''));
  const marker = 'chat/completions';
  const idx = base.indexOf(marker);
  if (idx !== -1) base = collapseVersions(base.slice(0, idx).replace(/\/+$/, ''));
  if (base.endsWith(marker)) return [base];
  if (/\/v\d+$/.test(base)) return [`${base}/chat/completions`];
  return [`${base}/v1/chat/completions`, `${base}/chat/completions`];
}

export async function POST(request: Request) {
  let body: {
    baseUrl?: unknown;
    apiKey?: unknown;
    model?: unknown;
    temperature?: unknown;
    maxTokens?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: '请求体不是有效的 JSON' }, { status: 400 });
  }

  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gpt-4o-mini';
  const temperature =
    typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? body.temperature : undefined;

  if (!baseUrl) {
    return NextResponse.json({ ok: false, error: '请先填写 API 地址' }, { status: 400 });
  }

  // 内网地址：云端服务器必然不可达，立即返回 directOnly 标记让客户端改用浏览器直连
  try {
    if (isPrivateHost(new URL(baseUrl).hostname)) {
      return NextResponse.json(
        {
          ok: false,
          error: '该地址位于局域网/本机，云端服务器无法访问，已改用浏览器直连',
          directOnly: true,
          url: baseUrl,
        },
        { status: 502 }
      );
    }
  } catch {
    // URL 解析失败走正常流程（后续 fetch 会失败并归入网络不可达）
  }

  const candidates = buildChatCandidates(baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  // 参数兼容重试（与 /api/chat、directTest 同款）：原始 → 换 max_completion_tokens → 去掉温度
  let useMaxCompletion = false;
  let curTemperature: number | undefined = temperature;

  let sawAnyResponse = false;
  let lastUrl = candidates[0];

  for (let ci = 0; ci < candidates.length; ci++) {
    const url = candidates[ci];
    lastUrl = url;

    for (let attempt = 0; attempt < 3; attempt++) {
      const payload = JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        ...(curTemperature === undefined ? {} : { temperature: curTemperature }),
        ...(useMaxCompletion ? { max_completion_tokens: 16 } : { max_tokens: 16 }),
        stream: false,
      });

      const startedAt = Date.now();
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: payload,
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        // 网络错误 / 超时：换下一个候选路径
        break;
      }
      sawAnyResponse = true;
      const latencyMs = Date.now() - startedAt;

      if (res.ok) {
        // 校验响应确为 OpenAI 兼容补全结构（防反代返回 200 错误页被误判成功）
        const json: unknown = await res.json().catch(() => null);
        const looksLikeCompletion =
          !!json &&
          typeof json === 'object' &&
          ((json as { id?: unknown }).id !== undefined ||
            'choices' in (json as Record<string, unknown>) ||
            (json as { content?: unknown }).content !== undefined ||
            (json as { response?: unknown }).response !== undefined);
        if (looksLikeCompletion) {
          return NextResponse.json({ ok: true, latencyMs, model, url });
        }
        // 200 但结构不像补全响应：按配置问题处理
        return NextResponse.json(
          {
            ok: false,
            error: '接口可达但响应不是标准补全格式，请确认该地址为 OpenAI 兼容 chat/completions 端点',
            connected: true,
            url,
          },
          { status: 502 }
        );
      }

      const raw = await res.text().catch(() => '');
      let detail = '';
      try {
        detail = extractUpstreamError(JSON.parse(raw) as unknown);
      } catch {
        detail = raw.slice(0, 160);
      }

      if (res.status === 400) {
        // 按上游提示逐项调整后重试
        if (!useMaxCompletion && /max_completion_tokens|unsupported parameter.{0,40}max_tokens/i.test(detail)) {
          useMaxCompletion = true;
          continue;
        }
        if (curTemperature !== undefined && /temperature/i.test(detail)) {
          curTemperature = undefined;
          continue;
        }
        return NextResponse.json(
          {
            ok: false,
            error: detail ? `参数被拒绝（400）：${detail}` : '请求参数被拒绝（400），请检查模型名与配置',
            connected: true,
            url,
          },
          { status: 502 }
        );
      }

      if (res.status === 401) {
        return NextResponse.json(
          { ok: false, error: 'API Key 无效或未授权（401）', connected: true, url },
          { status: 502 }
        );
      }

      if (res.status === 403) {
        if (detail && /country|region|territory|unsupported|blocked/i.test(detail)) {
          return NextResponse.json(
            {
              ok: false,
              error: `服务拒绝访问（403）：${detail} —— 该服务商对服务器所在地区限制，已改用浏览器直连`,
              connected: true,
              directOnly: true,
              url,
            },
            { status: 502 }
          );
        }
        return NextResponse.json(
          {
            ok: false,
            error: detail ? `服务拒绝访问（403）：${detail}` : '服务拒绝访问（403）',
            connected: true,
            url,
          },
          { status: 502 }
        );
      }

      if (res.status === 404) {
        // 该路径不存在：尝试下一个候选（裸域名会先试 /v1/chat/completions 再试 /chat/completions）
        if (ci < candidates.length - 1) break;
        return NextResponse.json(
          {
            ok: false,
            error: '接口路径或模型不存在（404），请检查 API 地址与模型名',
            connected: true,
            url,
          },
          { status: 502 }
        );
      }

      if (res.status === 429) {
        return NextResponse.json(
          {
            ok: false,
            error: detail ? `触发限流或额度不足（429）：${detail}` : '触发限流或额度不足（429）',
            connected: true,
            url,
          },
          { status: 502 }
        );
      }

      return NextResponse.json(
        {
          ok: false,
          error: detail ? `上游接口返回 ${res.status}：${detail}` : `上游接口返回 ${res.status}`,
          connected: true,
          url,
        },
        { status: 502 }
      );
    }
  }

  if (!sawAnyResponse) {
    // 所有候选都网络不可达：让客户端改用浏览器直连兜底（用户设备与该 API 通常同网可达）
    return NextResponse.json(
      {
        ok: false,
        error: '无法连接到目标 API：地址不可达或服务商网络受限，已改用浏览器直连',
        directOnly: true,
        url: lastUrl,
      },
      { status: 502 }
    );
  }

  // 有响应但未在上面返回（理论上不会走到）：统一兜底
  return NextResponse.json(
    { ok: false, error: '测试失败，请稍后重试', url: lastUrl },
    { status: 502 }
  );
}
