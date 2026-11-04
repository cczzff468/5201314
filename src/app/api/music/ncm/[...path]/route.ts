import { NextRequest } from 'next/server';

/**
 * 网易云 API 代理（内置多通道，自动故障切换）：
 *   /api/music/ncm/<path>?<query>  →  按链序尝试上游，仅对「连接级失败」自动降级：
 *
 *   ① NCM_API_UPSTREAM（环境变量，若显式设置则最优先——自部署同机/跨机场景）
 *   ② http://localhost:3010（沙箱 vendor 实例 mini-services/netease-api，零冷启动，最快）
 *   ③ NCM_API_FALLBACK（内置云端兜底，默认指向用户部署在 Vercel 的 api-enhanced 实例：
 *      https://api-enhanced-ochre-rho.vercel.app —— 本机实例未运行/沙箱重置时自动接管，
 *      把 5200 项目部署到任何其它机器也开箱即用，无需任何配置）
 *
 * 切换规则：
 * - 只在「拒绝连接 / DNS 失败 / 超时」时降级到下一跳；上游已返回的 HTTP 响应
 *   （含网易风控 4xx/5xx）原样透传，不跨实例重试（避免重复请求副作用）；
 * - 每个响应带 x-ncm-upstream 头（local / cloud / explicit），便于定位当前服务实例；
 * - 本机失联后记忆 60 秒，期间直达下一跳，避免每个请求都白等一次连接超时。
 *
 * 为什么经这层而不是前端直连：
 * - 统一同源 /api/music/ncm/*，沙箱内外行为一致，且顺带解决跨域与 cookie 透传；
 * - 音频/封面直链另有 /api/music/stream 白名单代理（http 混合内容与防盗链），不受本配置影响。
 *
 * API 本体：api-enhanced v4.41.1（vendor 于 mini-services/netease-api，源 cczzff468/api-enhanced），
 * 外部部署指南见 deploy/ncm-api/README.md。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCAL = 'http://localhost:3010';
const CLOUD_FALLBACK =
  process.env.NCM_API_FALLBACK?.trim() || 'https://api-enhanced-ochre-rho.vercel.app';
const EXPLICIT = process.env.NCM_API_UPSTREAM?.trim() || '';

/** 上游链：超时按场景区分——本机 6s（连不上/假死即降级）；
 *  云端 25s（Vercel 冷启动 5-15s 属正常，需容忍） */
const CHAIN: { base: string; tag: string; timeoutMs: number }[] = EXPLICIT
  ? [
      { base: EXPLICIT, tag: 'explicit', timeoutMs: 25_000 },
      { base: CLOUD_FALLBACK, tag: 'cloud', timeoutMs: 25_000 },
    ]
  : [
      { base: LOCAL, tag: 'local', timeoutMs: 6_000 },
      { base: CLOUD_FALLBACK, tag: 'cloud', timeoutMs: 25_000 },
    ];

/** 本机失联记忆（毫秒时间戳）：60s 内不再尝试本机，直达下一跳 */
let localDownUntil = 0;

async function tryUpstream(
  base: string,
  target: string,
  method: string,
  contentType: string,
  body: string | undefined,
  timeoutMs: number,
): Promise<Response | null> {
  try {
    return await fetch(`${base}/${target}`, {
      method,
      headers: { 'Content-Type': contentType },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // 连接级失败（拒绝连接/DNS/超时）→ 交给链上下一跳
    return null;
  }
}

async function proxy(req: NextRequest, path: string[]) {
  const url = new URL(req.url);
  const target = `${path.map(encodeURIComponent).join('/')}${url.search}`;
  const method = req.method;
  const contentType = req.headers.get('content-type') ?? 'application/json';
  // body 只读一次：多跳重试复用同一份（req.text() 二次调用会抛 Body already read）
  const body = method === 'GET' || method === 'HEAD' ? undefined : await req.text();

  const tried: string[] = [];
  for (const up of CHAIN) {
    if (up.tag === 'local' && Date.now() < localDownUntil) {
      tried.push(`${up.tag}(跳过,失联记忆中)`);
      continue;
    }
    const res = await tryUpstream(up.base, target, method, contentType, body, up.timeoutMs);
    if (res) {
      const headers = new Headers();
      headers.set('content-type', res.headers.get('content-type') ?? 'application/json; charset=utf-8');
      headers.set('cache-control', 'no-store');
      headers.set('x-ncm-upstream', up.tag);
      return new Response(res.body, { status: res.status, headers });
    }
    tried.push(up.tag);
    if (up.tag === 'local') localDownUntil = Date.now() + 60_000;
  }

  return new Response(
    JSON.stringify({
      code: -2,
      message: `网易云 API 全通道不可达（已尝试: ${tried.join(' → ')}；云端兜底 ${CLOUD_FALLBACK}）。请检查本机 mini-services/netease-api 与外部网络。`,
    }),
    { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
