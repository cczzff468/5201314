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
 * - func-call：同源转发调云端函数（verify-qq / ping 等动作；v5 已移除 setup-cron / stop-cron
 *   ——被动 Webhook 模式不再需要定时轮询）。背景（v3 修复）：存量已部署的旧版函数没有
 *   CORS 头，浏览器直连函数 URL 带 X-Task-Secret 等自定义头会先发 OPTIONS 预检→被拒→
 *   TypeError: Failed to fetch；走本代理同源转发（服务端到服务端无 CORS）存量部署立即
 *   修复，无需重新部署。
 * - unschedule-cron（v5 新增）：清掉旧版每分钟定时轮询的 pg_cron 任务（wx-assistant /
 *   assistant-polling），Management API SQL 直查——旧版函数里的 npm:postgres@3.5.4 路径
 *   （该版本不存在，Edge 运行时报 Could not find constraint）彻底退役；任务本来不存在
 *   也算成功（幂等）。
 * - schedule-cron（v6 新增，「云端轮询」开关开启）：pg_cron + pg_net 建每分钟定时任务，
 *   net.http_post 触发一次云端函数单轮收发（参照 ai-virtual-phone 的定时任务 SQL；
 *   X-Task-Secret 鉴权），顺手挂每日 cron 日志清理任务；幂等（先 unschedule 同名再
 *   schedule，重复点击安全重跑）。
 *
 * 防滥用：deploy 只接受本产品的函数代码（必须包含 Deno.serve 与 wx-assistant 标记）；
 * func-call 只转发到 {ref}.supabase.co 的 wx-assistant 函数（固定域名白名单，无 SSRF 面）。
 */

type DeployRequest = {
  op?: 'projects' | 'keys' | 'check-service-key' | 'storage-setup' | 'deploy' | 'func-call' | 'unschedule-cron' | 'schedule-cron';
  /** Supabase Access Token（supabase.com → Account Settings → Access Tokens） */
  token?: string;
  /** 项目 ref */
  ref?: string;
  /** service_role key（storage-setup 直传兜底用） */
  serviceKey?: string;
  /** storage-setup：候选密钥列表（自动读取的全部 secret 类 key + 已保存 key，去重） */
  serviceKeys?: string[];
  /** 任务密钥：deploy 部署后注入函数的 WX_TASK_SECRET；storage-setup 云端函数代写上传、
   *  func-call 转发鉴权、schedule-cron 定时任务鉴权都用它（X-Task-Secret） */
  secret?: string;
  /** storage-setup：要上传的文件 */
  files?: Array<{ path?: string; content?: string; bucket?: 'wx-cloud' | 'wx-cloud-public'; contentType?: string }>;
  /** deploy：函数源码 */
  code?: string;
  /** func-call：函数动作（verify-qq / ping；空 = 默认微信单轮收发。v5 起 setup-cron / stop-cron 已废弃） */
  action?: string;
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
      const filesRaw = Array.isArray(p.files) ? p.files.slice(0, 8) : [];
      const files = filesRaw
        .map((f) => ({
          path: typeof f.path === 'string' ? f.path.replace(/[^a-zA-Z0-9._/-]/g, '') : '',
          content: typeof f.content === 'string' ? f.content : '',
          bucket: f.bucket === 'wx-cloud-public' ? 'wx-cloud-public' : 'wx-cloud',
          contentType: typeof f.contentType === 'string' ? f.contentType : 'text/plain',
        }))
        .filter((f) => f.path && f.path.length <= 128 && f.content && f.content.length <= 800_000);
      // v18：超 800KB 被过滤的文件如实点名（旧版静默丢——配置大文件被丢时上传「成功」
      // 但云端拿不到该文件，属假成功；点名后用户能定位「哪个文件太大」）
      const droppedBySize = filesRaw
        .filter((f) => {
          const path = typeof f?.path === 'string' ? f.path : '';
          const content = typeof f?.content === 'string' ? f.content : '';
          return path && content.length > 800_000;
        })
        .map((f) => String(f.path));
      if (files.length === 0) return bad(400, 'missing_files', '没有可上传的文件（运行包为空？）');

      const uploadedSet = new Set<string>();
      const attempts: string[] = [];
      // v18：超 800KB 被过滤的文件如实点名（旧版静默丢——配置大文件被丢时上传「成功」
      // 但云端拿不到该文件，属假成功；点名后用户能定位「哪个文件太大」）
      if (droppedBySize.length) {
        attempts.push(`超大文件被跳过（>800KB 上限，未上传）：${droppedBySize.join('、')}——请精简后重试`);
      }
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

      // B. 云端函数代写（v4 主修复 → v18 加固）：部署过的 wx-assistant 自带 upload-file 动作，
      //    用平台注入的凭证写 Storage（还顺手建桶）——用户 Storage key 全部被拒（JWT 轮换后的
      //    signature verification failed / 项目 Storage 被 402 restricted）时这条路依然通。
      //    v18 三个加固（机主实测「运行包上传失败 402」的复盘）：
      //    ① 逐文件单独请求（旧版一次请求打包全部文件 ≈1.1MB 请求体，触云端偶发拒绝/超时）；
      //    ② 每文件最多 3 次重试 + 90 秒超时（实测同密钥同端点偶发 401 bad secret——重试即过）；
      //    ③ 写入后读回验证（受限项目 Storage 行为不可全信，读不回 = 没写上）。
      if (uploadedSet.size < files.length && taskSecret) {
        const remain = files.filter((f) => !uploadedSet.has(`${f.bucket}/${f.path}`));
        const relayBase = `${base}/functions/v1/wx-assistant`;
        for (const f of remain) {
          let okFile = false;
          let fileErr = '';
          for (let attempt = 1; attempt <= 3 && !okFile; attempt++) {
            try {
              const fr = await fetch(relayBase, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Task-Secret': taskSecret, 'X-Task-Action': 'upload-file' },
                body: JSON.stringify({ files: [f] }), // v18 ①逐文件：单请求单文件，请求体小
                signal: AbortSignal.timeout(90_000),
              }).catch(() => null);
              if (fr && fr.ok) {
                const fj = (await fr.json().catch(() => null)) as { ok?: boolean; uploaded?: string[]; error?: string } | null;
                if (fj && Array.isArray(fj.uploaded) && fj.uploaded.length > 0) {
                  // v18 ③读回验证：JSON 文件读得回才算真写上（assistant.mjs 非纯 JSON，跳过验证信 uploaded）
                  if (f.path.endsWith('.json')) {
                    const rb = await fetch(relayBase, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-Task-Secret': taskSecret, 'X-Task-Action': 'read-file' },
                      body: JSON.stringify({ path: f.path }),
                      signal: AbortSignal.timeout(30_000),
                    }).catch(() => null);
                    const rj = rb && rb.ok ? ((await rb.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null) : null;
                    if (rj && rj.ok === true && typeof rj.data !== 'undefined') {
                      okFile = true;
                    } else {
                      fileErr = '写入后读回验证失败（函数报成功但 Storage 里读不回该文件）';
                    }
                  } else {
                    okFile = true;
                  }
                } else {
                  fileErr = fj && typeof fj.error === 'string' && fj.error ? fj.error.slice(0, 90) : '函数回包无 uploaded（旧版函数？重新「一键部署」升级）';
                }
              } else if (fr && fr.status === 401) {
                fileErr = '任务密钥不匹配（401）——重新点「一键部署」重注密钥后再试';
                break; // 密钥不对重试无意义
              } else {
                // 函数非 200（含旧版函数掉进默认轮询分支返回的 200/其它）：如实记录状态码与片段
                let stext = '';
                if (fr) {
                  try { stext = (await fr.text().catch(() => '')).slice(0, 90); } catch { stext = ''; }
                }
                fileErr = fr ? `函数返回 ${fr.status}${stext ? `：${stext}` : ''}` : '超时（约 90 秒无响应——函数未部署/冷启动/网络波动）';
              }
            } catch {
              fileErr = '请求异常（网络波动）';
            }
            if (!okFile && attempt < 3) await new Promise((r) => setTimeout(r, 1500));
          }
          if (okFile) {
            uploadedSet.add(`${f.bucket}/${f.path}`);
            via = 'function';
          }
          attempts.push(
            okFile
              ? `云端代写·${f.path}：成功`
              : `云端代写·${f.path}：失败（${fileErr || '未知错误'}）`,
          );
        }
      }

      if (uploadedSet.size >= files.length && droppedBySize.length === 0) {
        return NextResponse.json({
          ok: true,
          uploaded: [...uploadedSet],
          publicUrl: `${base}/storage/v1/object/public/wx-cloud-public/assistant.mjs`,
          ...(usedKey ? { usedKey } : {}),
          via,
        });
      }

      // C. 汇总报错：直传每轮 + 代写结果 + 定位指引。
      //    v18：Storage 402 restricted（平台违规限制）单独识别——这是 Supabase 平台侧对
      //    项目的 Storage 直写限制（用户实测：直传全 402，云端函数平台凭证读写照常可用）。
      //    直传 402 + 代写成功时根本不会走到这里（上面已 ok 返回）；走到这里且带 402 =
      //    直传 402 且代写也失败——如实说明两条路各自的状态与可行出路。
      const rejectHint = lastRejectedBody ? keyRejectHint(lastRejectedKey) : '';
      const restricted = /restricted|violation/i.test(lastRejectedBody) || attempts.some((a) => /402/.test(a));
      const restrictedNote = restricted
        ? '你的 Supabase 项目 Storage 直写被平台限制（402 restricted——多为平台风控判定违规，需到 Supabase 控制台查看项目状态/申诉解除）。'
        : '';
      const gatewayNote =
        '本站网关不受影响：网站开着时真机微信/QQ 照常自动收发回复（表情包/语音全量可用）；云端函数兜底路径才依赖 Supabase。';
      return bad(
        502,
        'storage_upload_failed',
        `运行包上传失败（已试 ${attempts.length} 条路径）：${attempts.join('；')}。` +
          (bucketNote ? `${bucketNote}。` : '') +
          (restrictedNote ? `${restrictedNote}` : rejectHint || '请确认项目在运行、网络正常；重新点「一键部署」可升级云端函数（v4 支持代写上传，不依赖项目密钥）') +
          `${gatewayNote}`,
      );
    }

    // ---- 开启云端 24 小时收发（v9 建立；v16 升格 10 秒轮询）——两个 pg_cron 任务：
    // ① wx-assistant：每 10 秒 net.http_post 打函数 cron-cycle&fast=1（微信短窗单轮收发——
    //    10 秒内必检必回，超窗空手不烧配额）；
    // ② wx-assistant-qq：每分钟打 cron-cycle&qq=1（QQ WebSocket 会话保持到预算 ~135s，
    //    会话断点 Resume 续传）；
    // 都在用户自己的 Supabase 项目里跑——不依赖本站在线。Management API SQL 逐条执行；
    // 先 unschedule 同名任务再 schedule（幂等，重复点击安全重跑）；顺手挂每日日志清理。 ----
    if (p.op === 'schedule-cron') {
      const secret = typeof p.secret === 'string' ? p.secret.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 200) : '';
      if (!secret) return bad(400, 'missing_secret', '任务密钥缺失：请重新一键部署后再试');
      const funcUrl = `https://${ref}.supabase.co/functions/v1/wx-assistant?action=cron-cycle`;
      // 逐条 SQL：建扩展（容忍已存在）→ 清同名旧任务（容忍不存在）→ 建 10 秒主任务 + QQ 保持任务 + 日志清理任务
      const steps: Array<{ label: string; sql: string; tolerant?: boolean }> = [
        { label: '启用 pg_cron', sql: 'create extension if not exists pg_cron;', tolerant: true },
        { label: '启用 pg_net', sql: 'create extension if not exists pg_net;', tolerant: true },
        { label: '清理同名旧任务', sql: "select cron.unschedule('wx-assistant');", tolerant: true },
        { label: '清理同名旧任务', sql: "select cron.unschedule('wx-assistant-qq');", tolerant: true },
        { label: '清理同名旧任务', sql: "select cron.unschedule('assistant-polling');", tolerant: true },
        { label: '清理同名旧任务', sql: "select cron.unschedule('wx-assistant-cleanup');", tolerant: true },
        {
          label: '创建 10 秒轮询任务（微信）',
          sql:
            `select cron.schedule('wx-assistant', '10 seconds', $CRON$\n` +
            `  select net.http_post(\n` +
            `    url     := '${funcUrl}&fast=1',\n` +
            `    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Task-Secret', '${secret}'),\n` +
            `    body    := jsonb_build_object(),\n` +
            `    timeout_milliseconds := 15000\n` +
            `  );\n` +
            `$CRON$);`,
        },
        {
          label: '创建 QQ 保持任务（每分钟）',
          sql:
            `select cron.schedule('wx-assistant-qq', '* * * * *', $CRON$\n` +
            `  select net.http_post(\n` +
            `    url     := '${funcUrl}&qq=1',\n` +
            `    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Task-Secret', '${secret}'),\n` +
            `    body    := jsonb_build_object(),\n` +
            `    timeout_milliseconds := 150000\n` +
            `  );\n` +
            `$CRON$);`,
        },
        {
          label: '创建日志清理任务',
          sql:
            `select cron.schedule('wx-assistant-cleanup', '0 3 * * *', $CRON$\n` +
            `  delete from cron.job_run_details where end_time < now() - interval '3 days';\n` +
            `$CRON$);`,
        },
      ];
      const failures: string[] = [];
      for (const s of steps) {
        const r = await fetch(`${MGMT}/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: s.sql, read_only: false }),
          signal: AbortSignal.timeout(20_000),
        }).catch(() => null);
        if (!r) {
          if (!s.tolerant) failures.push(`${s.label}：网络超时`);
          continue;
        }
        const text = await r.text().catch(() => '');
        if (r.ok && !/"error"\s*:/.test(text.slice(0, 400))) continue;
        // 建扩展 / 清同名旧任务：尽力而为，任何错误都不算失败——pg_cron 的 unschedule
        // 对不存在的任务报「could not find valid entry for job」（用户实测踩坑：旧正则
        // 只认 could not be found，匹配不上被误判成真失败）；真正的问题会在下方创建步骤
        // 暴露（pg_cron 没建成 → cron.schedule 同样报错），这里宽容不影响定位。
        if (s.tolerant) continue;
        failures.push(`${s.label}：HTTP ${r.status}${text ? `（${text.slice(0, 100)}）` : '（无响应体）'}`);
      }
      if (failures.length === 0) {
        return NextResponse.json({ ok: true, msg: '云端轮询已开启：每 10 秒自动轮询回复（微信 10 秒内必检必回；QQ 长连接断点续传）——存在你自己的 Supabase 里，不依赖本站在线' });
      }
      // 指引只给一次（汇总在末尾）——走到这里只剩创建步骤的真实失败（Token 权限 / pg_cron 不可用等）
      return bad(502, 'schedule_failed', `开启云端轮询失败：${failures.join('；')}。多为 Access Token 无效或无数据库查询权限；可复制本页下方「手动 SQL」兜底段，到 Supabase → SQL Editor 执行`);
    }

    // ---- 清掉旧版定时轮询的 pg_cron 任务（v5：被动 Webhook 模式，轮询彻底退役） ----
    // Management API SQL 直查（与建桶同一条链路，只依赖 Access Token）；任务不存在 /
    // pg_cron 未启用都算「已停」（幂等）——用户看到的就是「已停止，零配额消耗」
    if (p.op === 'unschedule-cron') {
      const results: string[] = [];
      let stopped = 0;
      for (const name of ['wx-assistant', 'wx-assistant-qq', 'assistant-polling', 'wx-assistant-cleanup']) {
        const r = await fetch(`${MGMT}/v1/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `select cron.unschedule('${name}');`, read_only: false }),
          signal: AbortSignal.timeout(20_000),
        }).catch(() => null);
        if (!r) {
          results.push(`${name}：网络超时`);
          continue;
        }
        const text = await r.text().catch(() => '');
        if (r.ok && !/"error"\s*:/.test(text.slice(0, 400))) {
          stopped++;
          results.push(`${name}：已清除`);
        } else if (/does not exist|could not be found|could not find|not exist|not found|找不到|未找到/i.test(text)) {
          stopped++; // 任务本来就没有 / cron 扩展没启用 = 已经是停止状态（pg_cron 报 could not find valid entry for job 也在这类）
          results.push(`${name}：本来就没有定时任务`);
        } else {
          results.push(`${name}：失败（HTTP ${r.status}${text ? `：${text.slice(0, 100)}` : ''}）——可到 Supabase SQL Editor 手动执行 select cron.unschedule('${name}');`);
        }
      }
      if (stopped > 0) {
        return NextResponse.json({ ok: true, msg: `云端轮询已停止（零配额消耗）：${results.join('；')}` });
      }
      return bad(502, 'unschedule_failed', `清除旧轮询任务失败：${results.join('；')}。可到 Supabase → SQL Editor 手动执行：select cron.unschedule('wx-assistant'); select cron.unschedule('assistant-polling');`);
    }

    // ---- 部署 Edge Function ----
    if (p.op === 'deploy') {
      const code = typeof p.code === 'string' ? p.code : '';
      // 只接受本产品的云函数代码（防被当成任意部署接口滥用）
      if (!code || code.length > 512_000 || !code.includes('Deno.serve') || !code.includes('wx-assistant')) {
        return bad(400, 'invalid_code', '函数代码校验失败：只接受本产品的 wx-assistant 云函数（需含 Deno.serve 与 wx-assistant 标记）');
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
