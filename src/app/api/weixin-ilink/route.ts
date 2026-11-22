import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 微信 iLink（ilinkai.weixin.qq.com）官方 Bot 通道代理 —— v3 协议对齐版。
 *
 * 浏览器直连 iLink 会被 CORS 拦截，所有调用经本路由转发。v3 按官方插件协议
 * （Tencent/openclaw-weixin docs/protocol_zh_CN.md，2026-11 现行）补齐三类请求头，
 * 此前缺失正是「此 OpenClaw 的运行环境存在风险，暂无法连接」的诱因之一：
 * - 取二维码 POST（get_bot_qrcode）：带 AuthorizationType + X-WECHAT-UIN，不带 Authorization；
 * - 二维码状态长轮询 GET（get_qrcode_status）：带 iLink-App-Id + iLink-App-ClientVersion，
 *   不带 AuthorizationType/Authorization/X-WECHAT-UIN；单次长轮询服务端最长挂 ~35s；
 * - 鉴权 Bot API（getupdates/sendmessage/…）：Authorization Bearer + AuthorizationType +
 *   X-WECHAT-UIN + iLink-App-Id/ClientVersion。
 *
 * - X-WECHAT-UIN：随机 uint32 的十进制字符串再 base64（协议约定值形态，上游不校验具体值）。
 * - iLink-App-ClientVersion：插件版本 0x00MMNNPP 十进制（2.4.10 → 132106）。
 * - host 覆盖（scaned_but_redirect 的 redirect_host / confirmed 的 baseurl）：仅放行
 *   *.weixin.qq.com / *.qq.com 域名，无 SSRF 面。
 *
 * botToken 由客户端每次请求携带（Bearer + AuthorizationType: ilink_bot_token），
 * 服务端不留存任何凭证。路径白名单防滥用。
 */

const ILINK_BASE = 'https://ilinkai.weixin.qq.com';
/** 官方插件标识（protocol_zh_CN.md 请求头表）：App-Id 固定 "bot" */
const ILINK_APP_ID = 'bot';
/** ClientVersion = 插件版本 0x00MMNNPP 十进制（对应插件 2.4.10） */
const ILINK_APP_VERSION = (2 << 16) | (4 << 8) | 10; // 132106

/** 允许转发的 iLink 路径（按 pathname 前缀匹配；查询串不参与匹配） */
const ALLOWED_PATHS = [
  '/ilink/bot/get_bot_qrcode',
  '/ilink/bot/get_qrcode_status',
  '/ilink/bot/getupdates',
  '/ilink/bot/sendmessage',
  '/ilink/bot/sendtyping',
  '/ilink/bot/getconfig',
  '/ilink/bot/getuploadurl',
];

/** host 覆盖白名单：仅 *.weixin.qq.com / *.qq.com（redirect_host 与 baseurl 都在这两域内） */
function allowedHost(host: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.weixin\.qq\.com$/i.test(host) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.qq\.com$/i.test(host);
}

/** X-WECHAT-UIN：随机 uint32 十进制字符串 → base64（协议约定的值形态） */
function wechatUin(): string {
  const rand = Math.floor(Math.random() * 0xffffffff);
  return Buffer.from(String(rand), 'utf8').toString('base64');
}

type ProxyRequest = {
  /** iLink 路径（可带查询串），如 "/ilink/bot/getupdates" */
  path?: string;
  method?: 'GET' | 'POST';
  /** Bearer token（扫码登录接口不需要） */
  botToken?: string;
  /** 转发给 iLink 的请求体 */
  body?: unknown;
  /** host 覆盖（scaned_but_redirect 的 redirect_host / confirmed 返回的 baseurl；白名单校验） */
  host?: string;
};

export async function POST(req: NextRequest) {
  let payload: ProxyRequest;
  try {
    payload = (await req.json()) as ProxyRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const rawPath = typeof payload.path === 'string' ? payload.path : '';
  const qIdx = rawPath.indexOf('?');
  const pathname = qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath;
  const query = qIdx >= 0 ? rawPath.slice(qIdx) : '';

  if (!pathname.startsWith('/') || !ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.json({ error: 'forbidden_path' }, { status: 403 });
  }
  if (rawPath.length > 512) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }

  // host 覆盖（重定向/换域）：默认 ilinkai.weixin.qq.com，白名单外的 host 一律拒绝
  const hostOverride = typeof payload.host === 'string' ? payload.host.trim().toLowerCase() : '';
  if (hostOverride && !allowedHost(hostOverride)) {
    return NextResponse.json({ error: 'forbidden_host' }, { status: 403 });
  }
  const base = hostOverride ? `https://${hostOverride}` : ILINK_BASE;

  const method = payload.method === 'GET' ? 'GET' : 'POST';

  // ---- 请求头（按接口类型分发，协议见文件头注释）----
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const isQrCreate = pathname.startsWith('/ilink/bot/get_bot_qrcode');
  const isQrStatus = pathname.startsWith('/ilink/bot/get_qrcode_status');
  if (isQrStatus) {
    // 状态长轮询：仅应用头（iLink-App-Id / iLink-App-ClientVersion）
    headers['iLink-App-Id'] = ILINK_APP_ID;
    headers['iLink-App-ClientVersion'] = String(ILINK_APP_VERSION);
  } else {
    // 取二维码 POST 与鉴权 Bot API：AuthorizationType + X-WECHAT-UIN（取码不带 Authorization）
    headers.AuthorizationType = 'ilink_bot_token';
    headers['X-WECHAT-UIN'] = wechatUin();
    headers['iLink-App-Id'] = ILINK_APP_ID;
    headers['iLink-App-ClientVersion'] = String(ILINK_APP_VERSION);
    if (!isQrCreate && payload.botToken && payload.botToken.length <= 512) {
      headers.Authorization = `Bearer ${payload.botToken}`;
    }
  }

  // 长轮询超时分级：状态轮询（服务端最长挂 ~35s）与 getupdates（~25s+）放宽到 45s，其余 32s
  const longPoll = isQrStatus || pathname.startsWith('/ilink/bot/getupdates');
  const timeoutMs = longPoll ? 45_000 : 32_000;

  try {
    const upstream = await fetch(`${base}${pathname}${query}`, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(payload.body ?? {}) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
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
