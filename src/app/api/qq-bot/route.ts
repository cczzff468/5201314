import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * QQ 官方机器人平台代理（测试连接用）。
 *
 * - action=token：POST 换取 access_token。双端点降级：先打官方现行端点
 *   https://api.bot.qq.com/app/getAppAccessToken（2026-09 官方文档现行版，海外 IP 可达），
 *   失败再回退旧端点 https://bots.qq.com/api/v1/getAppAccessToken（大陆服务器可用）。
 * - action=me：GET https://api.sgroup.qq.com/users/@me（用凭证取机器人资料，验证真通）。
 *
 * 注意（v2 勘误）：旧端点 bots.qq.com/api/v1/* 在腾讯网关层对海外 IP 返回 503，并非凭证错误；
 * 新端点 /app/getAppAccessToken 已开放给海外出口（沙箱实测 200 + 业务 JSON），业务错误按
 * 官方文档约定以 HTTP 200 + 响应体 code 返回（100001 频控 / 100007 AppID 无效 / 100016
 * 凭证不对 / 10004 机器人不存在），需按 code 而非 HTTP 状态判定成败。
 *
 * 凭证由客户端每次请求携带，服务端不留存。
 */

type QqBotRequest = {
  action?: 'token' | 'me';
  appId?: string;
  appSecret?: string;
  accessToken?: string;
};

export async function POST(req: NextRequest) {
  let payload: QqBotRequest;
  try {
    payload = (await req.json()) as QqBotRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const action = payload.action === 'me' ? 'me' : 'token';

  try {
    if (action === 'token') {
      const appId = typeof payload.appId === 'string' ? payload.appId.trim() : '';
      const appSecret = typeof payload.appSecret === 'string' ? payload.appSecret.trim() : '';
      if (!/^[a-zA-Z0-9]{4,64}$/.test(appId) || !appSecret || appSecret.length > 200) {
        return NextResponse.json({ error: 'invalid_credentials' }, { status: 400 });
      }
      // 双端点降级：新端点先行（海外出口可达，业务错误 HTTP 200 + code），
      // 拿不到 access_token 再回退旧端点（兼容大陆部署或新端点抖动）
      const tokenEndpoints = [
        'https://api.bot.qq.com/app/getAppAccessToken',
        'https://bots.qq.com/api/v1/getAppAccessToken',
      ];
      let lastStatus = 0;
      let lastText = '';
      for (const endpoint of tokenEndpoints) {
        try {
          const upstream = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId, clientSecret: appSecret }),
            signal: AbortSignal.timeout(15_000),
          });
          lastStatus = upstream.status;
          lastText = await upstream.text();
          // 官方文档：业务错误 HTTP 仍 200，以响应体为准——拿到 access_token 或非网关 503 的
          // 业务回包（含 code 错误码）即为本端点真实结果，直接透传，不再打下一个端点
          const hasToken = lastText.includes('access_token');
          const gatewayBlocked = upstream.status === 503;
          if (hasToken || !gatewayBlocked) {
            return new NextResponse(lastText, {
              status: upstream.status,
              headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
            });
          }
        } catch (e) {
          // 单个端点网络抖动：记录后继续降级
          lastStatus = 0;
          lastText = e instanceof Error ? e.message : String(e);
        }
      }
      return new NextResponse(lastText || 'upstream_unreachable', {
        status: lastStatus || 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // action === 'me'：用 access_token 拉机器人公开资料（Authorization: QQBot <token>）
    const token = typeof payload.accessToken === 'string' ? payload.accessToken.trim() : '';
    if (!token || token.length > 512) {
      return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
    }
    const upstream = await fetch('https://api.sgroup.qq.com/users/@me', {
      headers: { Authorization: `QQBot ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'upstream_unreachable', message }, { status: 502 });
  }
}
