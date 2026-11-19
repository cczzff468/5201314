import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Supabase 云端部署代理（浏览器 CORS 限制，api.supabase.com 与项目域名都不放行第三方站点）。
 *
 * 五个操作（用户的 Access Token / service_role key 每次请求透传，服务端不留存）：
 * - projects：列出用户的项目（选择部署目标 ref）
 * - keys：取项目 secret 类 key（直传上传用，可能拿到多个候选）
 * - check-service-key：手动粘贴的 key 保存前验证（两种头型都试）
 * - storage-setup：建桶（wx-cloud 私有 + wx-cloud-public 公开，v3 主路径 Management API
 *   SQL 直插 storage.buckets，参照 ai-virtual-phone 仓库解法）并上传文件。v4 上传三级兜底：
 *   ① 候选密钥（自动读取的全部 secret key + 已保存的）× 两种头型（新式 key 仅 apikey /
 *   apikey+Bearer 双带，后者即 ai-virtual-phone 参考仓库写法）逐一试直传；② 直传全军覆没
 *   （用户项目 JWT 签名密钥已轮换 → 旧 eyJ service_role 全部 signature verification failed；
 *   或该项目 Storage 拒收新式 sb_secret_ key）时，走「云端函数代写」：POST 到已部署的
 *   wx-assistant 函数 upload-file 动作（X-Task-Secret 鉴权），函数用平台注入的
 *   SUPABASE_SERVICE_ROLE_KEY 写 Storage——平台注入的凭证永远有效，彻底不依赖用户 key；
 *   ③ 都不行才报错（带每一轮的真实响应便于定位）。
 * - deploy：把微信云端助手 Edge Function 部署进用户项目（Management API），部署成功后
 *   顺手把任务密钥注入函数密钥 WX_TASK_SECRET（/v1/projects/{ref}/secrets）——upload-file
 *   在运行包还没写进桶的首次部署期也能校验任务密钥。
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
  /** service_role key（storage-setup 直传兜底用） */
  serviceKey?: string;
  /** storage-setup：候选密钥列表（自动读取的全部 secret 类 key + 已保存 key，去重） */
  serviceKeys?: string[];
  /** deploy：部署后注入函数的 WX_TASK_SECRET；storage-setup：云端函数代写上传的任务密钥 */
  secret?: string;
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
 * - 新式 key（sb_secret_ 开头）不是 JWT：官方迁移指南写法是只放 apikey 头；但参考
 *   ai-virtual-phone 仓库（lib/cloud-backup/storage-client.ts）的 apikey + Bearer 双带
 *   写法在部分网关组合上才能过——两种都试，谁通用谁。
 */
function storageAuthVariants(key: string): Array<{ tag: string; headers: Record<string, string> }> {
  if (/^sb_secret_/i.test(key)) {
    return [
      { tag: '仅apikey', headers: { apikey: key } },
      { tag: 'apikey+Bearer', headers: { apikey: key, Authorization: `Bearer ${key}` } },
    ];
  }
  if (/^sb_publishable_/i.test(key)) {
    return [{ tag: '仅apikey', headers: { apikey: key } }];
  }
  return [{ tag: 'apikey+Bearer', headers: { apikey: key, Authorization: `Bearer ${key}` } }];
}

/** 响应体是否属于「key 被项目 Storage 拒收」（JWT 签名校验失败 / 被当 JWT 解析失败 / 无权限） */
function isKeyRejected(body: string): boolean {
  return /signature verification failed|invalid\s+(compact\s+)?jws|invalid\s+jwt|not\s+a\s+valid\s+jwt|unauthorized|access.?denied/i.test(
    body,
  );
}

/** 直传与代写全失败时给用户的指引（区分 sb_secret_ / 旧版 eyJ 两种形态） */
function keyRejectHint(key: string): string {
  if (key.startsWith('sb_secret_')) {
    return '该项目 Storage 拒收新式 sb_secret_ key（两种头型都试过）——多为平台新旧密钥体系切换期的网关兼容问题。首选解法：重新点「一键部署」升级云端函数（v4 函数支持代写上传，不依赖项目密钥）；或到 Supabase 控制台 Project Settings → API Keys → Legacy API keys 创建旧版 service_role（eyJ 开头）后用「手动粘贴」再试';
  }
  if (key.startsWith('eyJ')) {
    return '这个 eyJ 开头的旧版 service_role 签名校验失败——该项目的 JWT 签名密钥已轮换，旧 key 全部失效（Supabase 2025 起新项目/轮换后的项目普遍如此）。首选解法：重新点「一键部署」升级云端函数（v4 函数支持代写上传，不依赖项目密钥）；或换 sb_secret_ 开头的新式 secret key（Project Settings → API Keys）用「手动粘贴」再试';
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
    // v4：两种头型都试（新式 sb_secret_ 在不同项目上网关行为不一致——仅 apikey 与
    // apikey+Bearer 双带各能通一部分项目），任一种通了就算有效
    let lastStatus = 0;
    let lastBody = '';
    let networkFail = true;
    for (const v of storageAuthVariants(serviceKey)) {
      const r = await fetch(`https://${ref}.supabase.co/storage/v1/bucket`, {
        headers: v.headers,
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null);
      if (!r) continue;
      networkFail = false;
      lastStatus = r.status;
      if (r.ok) return NextResponse.json({ ok: true, via: v.tag });
      lastBody = (await r.text().catch(() => '')).slice(0, 200);
      // 400 + key 被拒（signature verification failed / Invalid Compact JWS）→ 换下一种头型再试
      if (r.status === 400 && isKeyRejected(lastBody)) continue;
      break;
    }
    if (networkFail) return bad(502, 'unreachable', '连不上你的 Supabase 项目：请确认项目在运行（免费项目闲置一周会自动暂停 Paused，到 Supabase 控制台点 Restore 恢复），网络恢复后再试');
    const detail =
      lastStatus === 401 || lastStatus === 403
        ? '这个 key 没有项目写入权限：要用 secret 类 key（sb_secret_ 开头或 legacy service_role），publishable / anon key 不行'
        : lastStatus === 400 && isKeyRejected(lastBody)
          ? `密钥不被该项目 Storage 接受（${lastBody ? lastBody.slice(0, 120) : 'key 被拒'}）。${keyRejectHint(serviceKey)}`
          : lastStatus === 404
            ? '找不到项目（ref 不对？），请确认选择的是正确项目'
            : `Supabase 返回 ${lastStatus}${lastBody ? `：${lastBody.slice(0, 120)}` : ''}`;
    return bad(lastStatus === 401 || lastStatus === 403 ? 403 : 502, 'invalid_key', detail);
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
      // v4：候选密钥 = 前端自动读取的全部 secret 类 key + 已保存 key（去重；剔掉
      // sbp_ Access Token / sb_publishable_ 公开密钥这类必错形态）。上传不再强依赖密钥：
      // 直传全部被拒时走「云端函数代写」，所以这里可为空
      const rawKeys: string[] = [
        ...(Array.isArray(p.serviceKeys) ? p.serviceKeys : []),
        ...(typeof p.serviceKey === 'string' ? [p.serviceKey] : []),
      ];
      const candidates = Array.from(
        new Set(
          rawKeys
            .map((k) => k.trim())
            .filter((k) => k && k.length <= 400 && !/^(sbp_|sb_publishable_)/.test(k)),
        ),
      );
      const taskSecret = typeof p.secret === 'string' ? p.secret.trim().slice(0, 200) : '';
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

      // ② （v4 已并入 ③）原「列桶预检」不再提前判死：密钥被拒的形态千奇百怪（JWT 轮换后的
      //    signature verification failed / 新式 key 的 Invalid Compact JWS / 无写入权限），
      //    且都有「云端函数代写」兜底——逐轮真实结果进 attempts，最后汇总呈现。

      // ② 建桶（v3 主路径：Management API SQL 直插 storage.buckets——参照 ai-virtual-phone 仓库）。
      //    新式 sb_secret_ key 在部分项目上被 Storage 管理端点拒收：GET 列桶能过，POST 建桶却
      //    400 {"statusCode":"403","message":"Invalid Compact JWS","code":"AccessDenied"}（用户实测
      //    踩坑）。SQL 路径用 Access Token 鉴权，与 Storage 密钥体系完全解耦，两类 key 都不再依赖；
      //    on conflict do nothing 幂等（桶已存在 = 成功）。SQL 失败（PAT 无 database/query 权限等）
      //    再退回原 REST 建桶路径兜底（serviceKey 那套，含「已存在」GET 确认）。
      let bucketSqlErr = '';
      let bucketNote = '';
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
        // REST 兜底：候选密钥 × 头型逐一试（POST 失败含「已存在」后 GET 确认桶真的存在）。
        // v4：REST 兜底失败不再直接判死——云端函数的 upload-file 动作自带建桶，仍有
        // 机会；失败原因记进 bucketNote，最后汇总时一并呈现
        let bucketErr = '';
        bucketLoop: for (const key of candidates) {
          for (const v of storageAuthVariants(key)) {
            let roundOk = true;
            for (const bucket of [
              { name: 'wx-cloud', public: false },
              { name: 'wx-cloud-public', public: true },
            ]) {
              const cr = await fetch(`${base}/storage/v1/bucket`, {
                method: 'POST',
                headers: { ...v.headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(bucket),
                signal: AbortSignal.timeout(15_000),
              }).catch(() => null);
              if (cr?.ok) continue;
              const exist = await fetch(`${base}/storage/v1/bucket/${bucket.name}`, {
                headers: v.headers,
                signal: AbortSignal.timeout(10_000),
              }).catch(() => null);
              if (!exist || !exist.ok) {
                roundOk = false;
                const t = cr ? await cr.text().catch(() => '') : '网络超时';
                bucketErr = `建桶失败（${bucket.name}，${cr ? `Supabase 返回 ${cr.status}` : '连不上'}${t ? `：${t.slice(0, 100)}` : ''}）`;
                break;
              }
            }
            if (roundOk) {
              bucketDone = true;
              break bucketLoop;
            }
          }
        }
        if (!bucketDone) {
          bucketNote = bucketErr || (candidates.length === 0 ? '没有可用的项目密钥，REST 建桶兜底未执行' : 'REST 建桶兜底全部失败');
          if (bucketSqlErr) bucketNote += `；SQL 建桶路径也已失败：${bucketSqlErr}（请检查 Access Token 是否有数据库查询权限）`;
        }
      }

      // ③ 上传（v4 三级兜底）：A. 候选密钥 × 头型逐一直传（x-upsert 幂等，跨轮次并集补齐）；
      //    B. 直传没传齐 → 云端函数代写（wx-assistant 的 upload-file 动作：平台注入的
      //    SUPABASE_SERVICE_ROLE_KEY 写 Storage——用户 key 被项目全拒也能过）；C. 还没
      //    传齐才汇总报错（带每轮真实响应便于定位）
      const files = (Array.isArray(p.files) ? p.files.slice(0, 8) : [])
        .map((f) => ({
          path: typeof f.path === 'string' ? f.path.replace(/[^a-zA-Z0-9._/-]/g, '') : '',
          content: typeof f.content === 'string' ? f.content : '',
          bucket: f.bucket === 'wx-cloud-public' ? 'wx-cloud-public' : 'wx-cloud',
          contentType: typeof f.contentType === 'string' ? f.contentType : 'text/plain',
        }))
        .filter((f) => f.path && f.path.length <= 128 && f.content && f.content.length <= 800_000);
      if (files.length === 0) return bad(400, 'missing_files', '没有可上传的文件（运行包为空？）');

      const uploadedSet = new Set<string>();
      const attempts: string[] = [];
      let usedKey = '';
      let via = 'direct';
      let lastRejectedKey = '';
      let lastRejectedBody = '';

      directLoop: for (const key of candidates) {
        for (const v of storageAuthVariants(key)) {
          const remain = files.filter((f) => !uploadedSet.has(`${f.bucket}/${f.path}`));
          if (remain.length === 0) break directLoop;
          let okCount = 0;
          let lastStatus = 0;
          let lastBody = '';
          for (const f of remain) {
            const r = await fetch(`${base}/storage/v1/object/${f.bucket}/${f.path}`, {
              method: 'POST',
              headers: { ...v.headers, 'Content-Type': f.contentType, 'x-upsert': 'true' },
              body: f.content,
              signal: AbortSignal.timeout(20_000),
            }).catch(() => null);
            if (!r) {
              lastStatus = 0;
              lastBody = '网络错误';
              continue;
            }
            lastStatus = r.status;
            if (r.ok) {
              okCount += 1;
              uploadedSet.add(`${f.bucket}/${f.path}`);
            } else {
              lastBody = (await r.text().catch(() => '')).slice(0, 160);
              if (isKeyRejected(lastBody)) {
                lastRejectedKey = key;
                lastRejectedBody = lastBody;
              }
            }
          }
          attempts.push(`直传·${key.slice(0, 10)}…·${v.tag}：${okCount}/${remain.length} 成功${lastBody ? `（${lastStatus || '网络错误'}：${lastBody.slice(0, 80)}）` : ''}`);
          if (uploadedSet.size >= files.length) {
            usedKey = key;
            break directLoop;
          }
        }
      }

      // B. 云端函数代写（v4 主修复）：部署过的 wx-assistant 自带 upload-file 动作，用平台
      // 注入的凭证写 Storage（还顺手建桶）——用户 Storage key 全部被拒（JWT 轮换后的
      // signature verification failed 等）时这条路依然通，不依赖用户粘贴的任何 key
      if (uploadedSet.size < files.length && taskSecret) {
        const remain = files.filter((f) => !uploadedSet.has(`${f.bucket}/${f.path}`));
        try {
          const fr = await fetch(`${base}/functions/v1/wx-assistant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Task-Secret': taskSecret, 'X-Task-Action': 'upload-file' },
            body: JSON.stringify({ files: remain }),
            signal: AbortSignal.timeout(40_000),
          }).catch(() => null);
          if (!fr) {
            attempts.push('云端代写：超时（约 40 秒无响应——旧版函数会掉进默认轮询分支，或函数还没部署/冷启动中，重新「一键部署」可解决）');
          } else {
            const ftext = (await fr.text().catch(() => '')).slice(0, 300);
            let fj: { ok?: boolean; uploaded?: string[]; error?: string; handled?: unknown } | null = null;
            try {
              fj = JSON.parse(ftext) as typeof fj;
            } catch {
              /* 非 JSON */
            }
            if (fr.ok && fj && Array.isArray(fj.uploaded)) {
              for (const u of fj.uploaded) uploadedSet.add(String(u));
              via = 'function';
              attempts.push(`云端代写：${fj.uploaded.length}/${remain.length} 成功${fj.error ? `（部分失败：${String(fj.error).slice(0, 80)}）` : ''}`);
            } else if (fr.status === 401) {
              attempts.push('云端代写：任务密钥不匹配（401）——请重新点「一键部署」后再试');
            } else if (fj && typeof fj.handled === 'number') {
              attempts.push('云端代写：已部署的是旧版函数（没有代写动作）——请重新点「一键部署」升级函数');
            } else {
              attempts.push(`云端代写：函数返回 ${fr.status}${ftext ? `（${ftext.slice(0, 80)}）` : ''}——请确认已完成「一键部署」（v4 函数自带代写上传）`);
            }
          }
        } catch {
          attempts.push('云端代写：请求异常');
        }
      }

      if (uploadedSet.size >= files.length) {
        return NextResponse.json({
          ok: true,
          uploaded: [...uploadedSet],
          publicUrl: `${base}/storage/v1/object/public/wx-cloud-public/assistant.mjs`,
          ...(usedKey ? { usedKey } : {}),
          via,
        });
      }

      // C. 汇总报错：直传每轮 + 代写结果 + 定位指引
      const rejectHint = lastRejectedBody ? keyRejectHint(lastRejectedKey) : '';
      return bad(
        502,
        'storage_upload_failed',
        `运行包上传失败（已试 ${attempts.length} 条路径）：${attempts.join('；')}。` +
          (bucketNote ? `${bucketNote}。` : '') +
          (rejectHint || '请确认项目在运行、网络正常；重新点「一键部署」可升级云端函数（v4 支持代写上传，不依赖项目密钥）'),
      );
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
      // v4：部署成功后把任务密钥注入函数密钥 WX_TASK_SECRET（Management API secrets，
      // CLI `supabase secrets set` 同款端点）。函数的 upload-file 动作用它鉴权——首次
      // 部署时桶里还没有 config.json 可比对 secret，靠这个注入值先立住信任链。
      // best-effort：注入失败不影响部署结果（非代写路径仍靠桶里 config.secret 校验）
      const taskSecret = typeof p.secret === 'string' ? p.secret.trim().slice(0, 200) : '';
      if (r.ok && taskSecret.length >= 16) {
        try {
          await fetch(`${MGMT}/v1/projects/${ref}/secrets`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify([{ name: 'WX_TASK_SECRET', value: taskSecret }]),
            signal: AbortSignal.timeout(15_000),
          });
        } catch {
          /* best-effort：注入失败不挡部署 */
        }
      }
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
