import { NextResponse } from 'next/server';

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

/** 从任意形态的模型列表响应中提取模型 id（兼容 {data:[...]} / {models:[...]} / 裸数组，排序去重） */
function extractModelIds(payload: unknown): string[] {
  const ids: string[] = [];

  const pushId = (item: unknown): void => {
    if (typeof item === 'string') {
      if (item && !ids.includes(item)) ids.push(item);
      return;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const id = obj.id ?? obj.name ?? obj.model;
      if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
    }
  };

  if (Array.isArray(payload)) {
    payload.forEach(pushId);
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) obj.data.forEach(pushId);
    else if (Array.isArray(obj.models)) obj.models.forEach(pushId);
  }

  return ids.sort((a, b) => a.localeCompare(b));
}

/** 修正重复的版本段（粘贴常见错误：/v1/v1 → /v1） */
function collapseVersions(u: string): string {
  return u.replace(/(\/v\d+)\/v\d+$/, '$1');
}

/** 私有/本机地址（云端服务器不可达，客户端应改用浏览器直连） */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

/**
 * 归一化出 models 端点候选列表：截掉 chat/completions 段后，
 * 以版本段（/v1、/v4 等）结尾直接拼 /models；否则先试 /v1/models 再试 /models。
 * 很多反代/中转只代理 chat/completions 而没有模型列表接口，多路径尝试可提高命中率。
 */
function buildModelsCandidates(rawBaseUrl: string): string[] {
  let base = collapseVersions(rawBaseUrl.trim().replace(/\/+$/, ''));
  const marker = 'chat/completions';
  const idx = base.indexOf(marker);
  if (idx !== -1) base = collapseVersions(base.slice(0, idx).replace(/\/+$/, ''));
  if (/\/v\d+$/.test(base)) return [`${base}/models`];
  return [`${base}/v1/models`, `${base}/models`];
}

export async function POST(request: Request) {
  let body: { baseUrl?: unknown; apiKey?: unknown };
  try {
    body = (await request.json()) as { baseUrl?: unknown; apiKey?: unknown };
  } catch {
    return NextResponse.json({ error: '请求体不是有效的 JSON' }, { status: 400 });
  }

  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!baseUrl) {
    return NextResponse.json({ error: '请先填写 API 地址' }, { status: 400 });
  }

  // 内网地址：云端服务器必然不可达，立即返回 directOnly 标记让客户端改用浏览器直连
  try {
    if (isPrivateHost(new URL(baseUrl).hostname)) {
      return NextResponse.json(
        {
          error: '该地址位于局域网/本机，云端服务器无法访问，已改用浏览器直连',
          directOnly: true,
          url: baseUrl,
        },
        { status: 502 }
      );
    }
  } catch {
    // URL 解析失败走正常流程
  }

  const candidates = buildModelsCandidates(baseUrl);
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const MANUAL_HINT =
    '该 API 未提供模型列表接口，不影响聊天使用；请在模型输入框直接手动填写模型名（可查阅服务商文档）。';

  let lastUrl = candidates[0];
  let sawAnyResponse = false;

  for (const url of candidates) {
    lastUrl = url;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      // 网络错误 / 超时：换下一个候选路径，都失败再报错
      continue;
    }
    sawAnyResponse = true;

    if (res.status === 401) {
      return NextResponse.json(
        {
          error: 'API Key 无效或未授权（401）。若聊天可用，也可忽略模型列表、直接手动填写模型名',
          url,
        },
        { status: 502 }
      );
    }
    if (res.status === 403) {
      const payload: unknown = await res.json().catch(() => null);
      const detail = extractUpstreamError(payload);
      if (detail && /country|region|territory|unsupported|blocked/i.test(detail)) {
        return NextResponse.json(
          {
            error: `服务拒绝访问（403）：${detail} —— 该服务商对服务器所在地区限制，请换用国内 API`,
            directOnly: true,
            url,
          },
          { status: 502 }
        );
      }
      return NextResponse.json(
        {
          error: detail
            ? `服务拒绝访问（403）：${detail}。若聊天可用，也可忽略模型列表、直接手动填写模型名`
            : '服务拒绝访问（403）。若聊天可用，也可忽略模型列表、直接手动填写模型名',
          url,
        },
        { status: 502 }
      );
    }
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      // 该路径不存在：尝试下一个候选（很多反代只有 chat/completions）
      continue;
    }
    if (!res.ok) {
      return NextResponse.json({ error: `服务返回异常（HTTP ${res.status}）`, url }, { status: 502 });
    }

    const payload: unknown = await res.json().catch(() => null);
    if (!payload) continue; // HTML/空响应等：尝试下一个候选
    const models = extractModelIds(payload);
    if (models.length > 0) {
      return NextResponse.json({ models, url });
    }
    // 200 但解析不出模型：尝试下一个候选
  }

  if (!sawAnyResponse) {
    // 所有候选都网络不可达：不是「无模型列表」，不应误报，让客户端改用浏览器直连兑底
    return NextResponse.json(
      {
        error: '无法连接到目标 API：地址不可达或服务商网络受限',
        directOnly: true,
        url: lastUrl,
      },
      { status: 502 }
    );
  }
  // 有响应但拿不到模型列表（404/405/501、200 但非模型列表 JSON 等）：优雅降级，不阻塞使用
  return NextResponse.json({ models: [], hint: MANUAL_HINT, url: lastUrl });
}
