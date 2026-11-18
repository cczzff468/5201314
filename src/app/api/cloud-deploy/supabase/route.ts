import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Supabase 云端部署代理（浏览器 CORS 限制，api.supabase.com 与项目域名都不放行第三方站点）。
 *
 * 五个操作（用户的 Access Token / service_role key 每次请求透传，服务端不留存）：
 * - projects：列出用户的项目（选择部署目标 ref）
 * - keys：取项目 service_role key（上传运行包到 Storage 用）
 * - storage-setup：建桶（wx-cloud 私有 + wx-cloud-public 公开，v3 主路径 Management API
 *   SQL 直插 storage.buckets，参照 ai-virtual-phone 仓库解法）并上传文件
 * - deploy：把微信云端助手 Edge Function 部署进用户项目（Management API）
 * - func-call：同源转发调云端函数（verify-qq / setup-cron / stop-cron / ping 等动作）。
 *   背景（v3 修复）：存量已部署的旧版函数没有 CORS 头，浏览器直连函数 URL 带
 *   X-Task-Secret 等自定义头会先发 OPTIONS 预检→被拒→TypeError: Failed to fetch；
 *   走本代理同源转发（服务端到服务端无 CORS）存量部署立即修复，无需重新部署。
 *
 * 防滥用：deploy 只接受本产品的函数代码（必须包含 Deno.serve 与 wx-assistant 标记）；
 * func-call 只转发到 {ref}.supabase.co 的 wx-assistant 函数（固定域名白名单，无 SSRF 面）。
 */

type DeployRequest = {
  op?: 'projects' | 'keys' | 'check-service-key' | 'storage-setup' | 'deploy' | 'func-call';
  /** Supabase Access Token（supabase.com → Account Settings → Access Tokens） */
  token?: string;
  /** 项目 ref */
  ref?: string;
  /** service_role key（storage-setup 用） */
  serviceKey?: string;
  /** storage-setup：要上传的文件 */
  files?: Array<{ path?: string; content?: string; bucket?: 'wx-cloud' | 'wx-cloud-public'; contentType?: string }>;
  /** deploy：函数源码 */
  code?: string;
  /** func-call：函数动作（verify-qq / setup-cron / stop-cron / ping；空 = 默认微信轮询） */
  action?: string;
  /** func-call：任务密钥（X-Task-Secret） */
  secret?: string;
  /** func-call：POST body（JSON 序列化后透传） */
  body?: Record<string, unknown>;
  /** func-call：超时毫秒（默认 70s，ping 默 100s 轮询窗口可到 150s） */
  timeoutMs?: number;
};

const MGMT = 'https://api.supabase.com';

function bad(status: number, error: string, message?: string) {
  return NextResponse.json({ error, message: message ?? '' }, { status });
}

/** 从请求体提取项目 ref（check-service-key 在公共 ref 校验前就要用） */
function ref0(p: DeployRequest): string {
  return typeof p.ref === 'string' ? p.ref.trim() : '';
}

/**
 * Storage 请求头（按 key 类型区分，官方文档两套鉴权）：
 * - legacy JWT（eyJ 开头 anon/service_role）：apikey + Authorization Bearer 双带。
 * - 新式 key（sb_secret_ / sb_publishable_ 开头）不是 JWT，只能放 apikey 头——放
 *   Authorization Bearer 会被网关/Storage 当 JWT 解析，报 400 "Invalid Compact JWS"
 *   （官方迁移指南：Send publishable and secret keys on the apikey header, not on
 *   Authorization: Bearer）。网关验证 apikey 后会自动签发短期 service_role JWT。
 */
function supaStorageHeaders(serviceKey: string, contentType?: string): Record<string, string> {
  const isNewStyleKey = /^(sb_secret_|sb_publishable_)/.test(serviceKey);
  const h: Record<string, string> = isNewStyleKey
    ? { apikey: serviceKey }
    : { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  if (contentType) h['Content-Type'] = contentType;
  return h;
}

/** 响应体是否属于「key 被当 JWT 解析失败」（Invalid Compact JWS / Invalid JWT） */
function isJwsRejected(body: string): boolean {
  return /invalid\s+(compact\s+)?jws|invalid\s+jwt|not\s+a\s+valid\s+jwt/i.test(body);
}

/** 新式 sb_secret_ key 不被项目 Storage 接受时的指引（换 legacy service_role JWT） */
const LEGACY_KEY_HINT =
  '新式 sb_secret_ key 在个别项目上不被 Storage 接受——请到 Supabase 控制台 Project Settings → API Keys → Legacy API keys，创建/复制旧版 service_role（eyJ 开头），用下方「手动粘贴」换上再试';

/** 非 sb_secret_ 的密钥被拒时的通用指引（区分 sbp_ Access Token 误填 / publishable / 其它） */
function keyMisuseHint(key: string): string {
  if (key.startsWith('sbp_')) {
    return 'sbp_ 开头的是 Supabase Access Token（管理项目用的，填错位置了）——这里要用项目密钥：sb_secret_ 开头的新式 secret key，或 eyJ 开头的旧版 service_role';
  }
  if (key.startsWith('sb_publishable_')) {
    return 'sb_publishable_ 是公开密钥（权限只相当于 anon），不能写 Storage——要用 sb_secret_ 开头或 eyJ 开头的 service_role 密钥';
  }
  return '请确认粘贴的是完整密钥（sb_secret_ 开头新式 key，或 eyJ 开头旧版 service_role）';
}

export async function POST(req: NextRequest) {
  let p: DeployRequest;
  try {
    p = (await req.json()) as DeployRequest;
  } catch {
    return bad(400, 'invalid_json');
  }
  const token = typeof p.token === 'string' ? p.token.trim() : '';

  // ---- 云端函数同源转发（存量旧版函数无 CORS 也能用；服务端到服务端无 CORS 限制） ----
  // 不需要 Access Token：函数鉴权走 X-Task-Secret（部署时生成的任务密钥）
  if (p.op === 'func-call') {
    const ref = ref0(p);
    if (!/^[a-z0-9]{12,40}$/.test(ref)) return bad(400, 'invalid_ref', '还没选择云端项目');
    const action = typeof p.action === 'string' ? p.action.replace(/[^a-z0-9-]/gi, '').slice(0, 40) : '';
    const secret = typeof p.secret === 'string' ? p.secret.slice(0, 200) : '';
    if (!secret) return bad(400, 'missing_secret', '任务密钥缺失：请重新一键部署后再试');
    const timeoutMs = Math.min(Math.max(Number(p.timeoutMs) || 70_000, 5_000), 150_000);
    // 固定域名白名单：只允许 {ref}.supabase.co 的 wx-assistant 函数，无 SSRF 面
    const url = `https://${ref}.supabase.co/functions/v1/wx-assistant`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Task-Secret': secret,
        ...(action ? { 'X-Task-Action': action } : {}),
      },
      body: JSON.stringify(p.body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null);
    if (!r) {
      return bad(504, 'func_unreachable', `连不上你的云端助手（${url}）：请确认已完成「一键部署」；刚部署的函数冷启动需 10-30 秒，稍等再试`);
    }
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { 'Content-Type': r.headers.get('content-type') ?? 'application/json' },
    });
  }

  // ---- 验证 service_role / secret key（手动粘贴保存前先测：能不能写 Storage；只需项目 key，不需要 Access Token） ----
  if (p.op === 'check-service-key') {
    const serviceKey = typeof p.serviceKey === 'string' ? p.serviceKey.trim() : '';
    if (!serviceKey || serviceKey.length > 400) return bad(400, 'missing_service_key');
    const ref = ref0(p);
    if (!/^[a-z0-9]{12,40}$/.test(ref)) return bad(400, 'invalid_ref', '还没选择项目：先在上方读取项目列表并选中一个项目，再粘贴密钥');
    const r = await fetch(`https://${ref}.supabase.co/storage/v1/bucket`, {
      headers: supaStorageHeaders(serviceKey),
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);
    if (!r) return bad(502, 'unreachable', '连不上你的 Supabase 项目：请确认项目在运行（免费项目闲置一周会自动暂停 Paused，到 Supabase 控制台点 Restore 恢复），网络恢复后再试');
    if (r.ok) return NextResponse.json({ ok: true });
    const rBody = await r.text().catch(() => '');
    const detail =
      r.status === 401 || r.status === 403
        ? '这个 key 没有项目写入权限：要用 secret 类 key（sb_secret_ 开头或 legacy service_role），publishable / anon key 不行'
        : r.status === 400 && isJwsRejected(rBody)
          ? `这个密钥不被项目 Storage 接受（Invalid Compact JWS）：密钥被当 JWT 解析失败。${serviceKey.startsWith('sb_secret_') ? LEGACY_KEY_HINT : keyMisuseHint(serviceKey)}`
          : r.status === 404
            ? '找不到项目（ref 不对？），请确认选择的是正确项目'
            : `Supabase 返回 ${r.status}${rBody ? `：${rBody.slice(0, 120)}` : ''}`;
    return bad(r.status === 401 || r.status === 403 ? 403 : 502, 'invalid_key', detail);
  }

  if (!token || token.length > 400) return bad(400, 'missing_token');
  const auth = { Authorization: `Bearer ${token}` };

  try {
    // ---- 列项目 ----
    if (p.op === 'projects') {
      const r = await fetch(`${MGMT}/v1/projects`, { headers: auth, signal: AbortSignal.timeout(15_000) });
      const text = await r.text();
      return new NextResponse(text, {
        status: r.status,
        headers: { 'Content-Type': r.headers.get('content-type') ?? 'application/json' },
      });
    }

    const ref = typeof p.ref === 'string' ? p.ref.trim() : '';
    if (!/^[a-z0-9]{12,40}$/.test(ref)) return bad(400, 'invalid_ref');

    // ---- 取项目 API keys（官方平台指南写法：?reveal=true 拿明文） ----
    // 关键行为：无 reveal 时新项目常返回 200 但 api_key 全为 null（拿不到明文），
    // 所以 reveal 版优先；reveal 403/失败（PAT 权限不含 secrets read）再退回无参数版；
    // 两版都拿不到就透传最后错误（前端引导手动粘贴）。
    if (p.op === 'keys') {
      let lastStatus = 0;
      let lastText = '';
      for (const query of ['?reveal=true', '']) {
        const r = await fetch(`${MGMT}/v1/projects/${ref}/api-keys${query}`, {
          headers: auth,
          signal: AbortSignal.timeout(15_000),
        }).catch(() => null);
        if (!r) continue;
        lastStatus = r.status;
        lastText = await r.text();
        if (r.ok) {
          // 200 且响应里确实带了明文 key → 直接用；200 但全 null（无 reveal 的行为）→ 继续试下一版
          const hasPlainKey = /"(?:api_key|key)"\s*:\s*"(?:eyJ|sb_secret_)[^"]{20,}/.test(lastText);
          if (hasPlainKey || query === '') {
            return new NextResponse(lastText, {
              status: r.status,
              headers: { 'Content-Type': r.headers.get('content-type') ?? 'application/json' },
            });
          }
          continue;
        }
      }
      return new NextResponse(lastText || '{"error":"keys_unreachable"}', {
        status: lastStatus || 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ---- 建桶 + 上传文件 ----
    if (p.op === 'storage-setup') {
      const serviceKey = typeof p.serviceKey === 'string' ? p.serviceKey.trim() : '';
      if (!serviceKey || serviceKey.length > 400) return bad(400, 'missing_service_key');
      const base = `https://${ref}.supabase.co`;

      // ① 项目状态预检：免费项目闲置一周自动暂停，Paused 时 Storage 一律失败——直接给 Restore 指引。
      //    注意 Management API 的运行态是 ACTIVE_HEALTHY / ACTIVE_UNHEALTHY 等带后缀的形式，
      //    一律以 ACTIVE 开头即视为运行中（用户实测曾被「ACTIVE_HEALTHY ≠ ACTIVE」误拦，项目明明健康）
      const pr = await fetch(`${MGMT}/v1/projects/${ref}`, { headers: auth, signal: AbortSignal.timeout(12_000) }).catch(() => null);
      if (pr && pr.ok) {
        const pj = (await pr.json().catch(() => null)) as { status?: string } | null;
        const pstatus = pj?.status ?? '';
        if (pstatus && !pstatus.toUpperCase().startsWith('ACTIVE')) {
          return bad(502, 'project_not_active', `你的项目当前状态是「${pstatus}」（免费项目闲置一周会自动暂停）——请到 Supabase 控制台打开该项目，点 Restore 恢复运行，再回来重新点「一键部署」`);
        }
      }

      // ② 密钥预检：列桶 401/403 = publishable/anon（没有写权限）；400 + Invalid JWS =
      //    key 被当 JWT 解析失败（sb_secret_ 放了 Bearer / 该项目 Storage 不认新式 key）
      const lb = await fetch(`${base}/storage/v1/bucket`, {
        headers: supaStorageHeaders(serviceKey),
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null);
      if (!lb) return bad(502, 'unreachable', `连不上你的项目 Storage（${base}）：请稍后重试；若持续失败，请确认项目未被删除`);
      if (lb.status === 401 || lb.status === 403) {
        const isNew = serviceKey.startsWith('sb_');
        return bad(
          403,
          'invalid_key',
          `这个密钥没有项目写入权限（Storage 列桶返回 ${lb.status}）：上传文件要用 secret 类密钥——Supabase 控制台 Project Settings → API Keys 里 sb_secret_ 开头的 secret key，或旧版 eyJ 开头的 service_role；publishable / anon key 不行。可在下方「手动粘贴」里换一个` +
            (isNew ? `。若确认 key 没粘错，可能是该项目 Storage 暂不认新式 key——${LEGACY_KEY_HINT}` : ''),
        );
      }
      if (lb.status === 400) {
        const lbBody = await lb.text().catch(() => '');
        if (isJwsRejected(lbBody)) {
          return bad(
            403,
            'invalid_key',
            `密钥被项目 Storage 当 JWT 解析失败（Invalid Compact JWS，Supabase 返回 400）${lbBody ? `：${lbBody.slice(0, 120)}` : ''}。` +
              (serviceKey.startsWith('sb_secret_') ? LEGACY_KEY_HINT : keyMisuseHint(serviceKey)),
          );
        }
      }

      // ③ 建桶（v3 主路径：Management API SQL 直插 storage.buckets——参照 ai-virtual-phone 仓库）。
      //    新式 sb_secret_ key 在部分项目上被 Storage 管理端点拒收：GET 列桶能过，POST 建桶却
      //    400 {"statusCode":"403","message":"Invalid Compact JWS","code":"AccessDenied"}（用户实测
      //    踩坑）。SQL 路径用 Access Token 鉴权，与 Storage 密钥体系完全解耦，两类 key 都不再依赖；
      //    on conflict do nothing 幂等（桶已存在 = 成功）。SQL 失败（PAT 无 database/query 权限等）
      //    再退回原 REST 建桶路径兜底（serviceKey 那套，含「已存在」GET 确认）。
      let bucketSqlErr = '';
      let bucketDone = false;
      try {
        const qs = await fetch(`${MGMT}/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query:
              'insert into storage.buckets (id, name, public) values ' +
              "('wx-cloud', 'wx-cloud', false), ('wx-cloud-public', 'wx-cloud-public', true) " +
              'on conflict (id) do nothing;',
            read_only: false,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (qs.ok) {
          bucketDone = true;
        } else {
          const qsBody = (await qs.text().catch(() => '')).slice(0, 140);
          bucketSqlErr = `SQL 建桶失败（HTTP ${qs.status}${qsBody ? `：${qsBody}` : ''}）`;
        }
      } catch {
        bucketSqlErr = 'SQL 建桶失败（Management API 连不上/超时）';
      }

      if (!bucketDone) {
        // REST 兜底（原路径）：POST 失败（含「已存在」）后 GET 确认桶真的存在，不存在才报错——不再吞错
        for (const bucket of [
          { name: 'wx-cloud', public: false },
          { name: 'wx-cloud-public', public: true },
        ]) {
          const cr = await fetch(`${base}/storage/v1/bucket`, {
            method: 'POST',
            headers: supaStorageHeaders(serviceKey, 'application/json'),
            body: JSON.stringify(bucket),
            signal: AbortSignal.timeout(15_000),
          }).catch(() => null);
          if (cr?.ok) continue;
          const exist = await fetch(`${base}/storage/v1/bucket/${bucket.name}`, {
            headers: supaStorageHeaders(serviceKey),
            signal: AbortSignal.timeout(10_000),
          }).catch(() => null);
          if (!exist || !exist.ok) {
            const t = cr ? await cr.text().catch(() => '') : '网络超时';
            const jwsHint = cr?.status === 400 && isJwsRejected(t)
              ? `。密钥被当 JWT 解析失败${serviceKey.startsWith('sb_') ? `——${LEGACY_KEY_HINT}` : ''}`
              : '';
            return bad(
              502,
              'bucket_failed',
              `建桶失败（${bucket.name}，${cr ? `Supabase 返回 ${cr.status}` : '连不上'}${t ? `：${t.slice(0, 120)}` : ''}）——多半是密钥无效或无建桶权限，请换 secret 类密钥（见下方「手动粘贴」）${jwsHint}${
                bucketSqlErr ? `；另 SQL 建桶路径也已失败：${bucketSqlErr}（请检查 Access Token 是否有数据库查询权限）` : ''
              }`,
            );
          }
        }
      }

      // ④ 上传：失败时读出响应体，把 Storage 的真实原因带回前端
      const files = Array.isArray(p.files) ? p.files.slice(0, 8) : [];
      const uploaded: string[] = [];
      let lastUploadStatus = 0;
      let lastUploadBody = '';
      for (const f of files) {
        const path = typeof f.path === 'string' ? f.path.replace(/[^a-zA-Z0-9._/-]/g, '') : '';
        const content = typeof f.content === 'string' ? f.content : '';
        const bucket = f.bucket === 'wx-cloud-public' ? 'wx-cloud-public' : 'wx-cloud';
        if (!path || path.length > 128 || !content || content.length > 800_000) continue;
        const r = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
          method: 'POST',
          headers: { ...supaStorageHeaders(serviceKey, f.contentType ?? 'text/plain'), 'x-upsert': 'true' },
          body: content,
          signal: AbortSignal.timeout(20_000),
        });
        lastUploadStatus = r.status;
        if (r.ok) {
          uploaded.push(`${bucket}/${path}`);
        } else {
          lastUploadBody = (await r.text().catch(() => '')).slice(0, 200);
        }
      }
      if (files.length > 0 && uploaded.length === 0) {
        const hint = /invalid\s*(api\s*key|jwt|token|jws)|apikey|signature|unauthorized/i.test(lastUploadBody)
          ? '——密钥不被 Storage 接受：到 Supabase 控制台 Project Settings → API Keys 重新复制 secret 类 key（sb_secret_ 开头或 service_role），用下方「手动粘贴」换一个再试；若 sb_secret_ 仍报 Invalid Compact JWS，请改用旧版 service_role（Legacy API keys 里创建，eyJ 开头）'
          : /bucket/i.test(lastUploadBody)
            ? '——桶没建起来：多半是密钥无建桶权限，请换 secret 类 key（见下方「手动粘贴」）'
            : /paused|suspend/i.test(lastUploadBody)
              ? '——项目已被暂停：到 Supabase 控制台 Restore 后重试'
              : '';
        return bad(502, 'storage_upload_failed', `所有文件都上传失败（Supabase 返回 ${lastUploadStatus || '网络错误'}${lastUploadBody ? `：${lastUploadBody}` : ''}）${hint}`);
      }
      return NextResponse.json({ ok: true, uploaded, publicUrl: `${base}/storage/v1/object/public/wx-cloud-public/assistant.mjs` });
    }

    // ---- 部署 Edge Function ----
    if (p.op === 'deploy') {
      const code = typeof p.code === 'string' ? p.code : '';
      // 只接受本产品的云函数代码（防被当成任意部署接口滥用）
      if (!code || code.length > 512_000 || !code.includes('Deno.serve') || !code.includes('wx-assistant')) {
        return bad(400, 'invalid_code');
      }
      const form = new FormData();
      form.append(
        'metadata',
        JSON.stringify({ name: 'wx-assistant', entrypoint_path: 'index.ts', verify_jwt: false }),
      );
      form.append('file', new Blob([code], { type: 'application/typescript' }), 'index.ts');
      const r = await fetch(`${MGMT}/v1/projects/${ref}/functions/deploy?slug=wx-assistant`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      const text = await r.text();
      return new NextResponse(text, {
        status: r.status,
        headers: { 'Content-Type': r.headers.get('content-type') ?? 'application/json' },
      });
    }

    return bad(400, 'unknown_op');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return bad(502, 'upstream_unreachable', message);
  }
}
