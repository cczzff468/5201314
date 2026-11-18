'use client';

/**
 * Supabase 一键部署管线（全部经 /api/cloud-deploy/supabase 代理，解决 CORS；
 * 用户凭证只在内存与用户自己的浏览器密文 kv 里，服务端不留存）。
 *
 * 流程：列项目 → 取 service_role key → 建桶+上传运行包（config.json / assistant.mjs /
 * history.json 种子）→ 部署 wx-assistant Edge Function → 给出 pg_cron 定时 SQL（复制到
 * SQL Editor 执行即 7x24 轮询）。更新配置只需重新同步（storage-setup），无需重部署。
 */

import { useWxCloud, wxCloudSnapshot, type WxCloudSupabase } from './store';
import { buildRunPackage, type RunPackageResult } from './run-package';
import { ASSISTANT_MJS, EDGE_FUNCTION_TS } from './sources';

export const FUNC_SLUG = 'wx-assistant';
export const BUCKET_PRIVATE = 'wx-cloud';
export const BUCKET_PUBLIC = 'wx-cloud-public';

export interface SupaProject {
  id: string;
  name: string;
  status?: string;
  region?: string;
}

export interface DeployResult {
  ok: boolean;
  msg: string;
  funcUrl?: string;
  /** need_manual_key = 自动读 service_role 失败，前端展开「手动粘贴」输入框 */
  code?: 'need_manual_key';
  /** 运行包没带任何接入渠道时附带的引导提示（部署仍成功：先部署 → 再接入微信/QQ） */
  note?: string;
}

async function supaProxy(body: Record<string, unknown>, timeoutMs = 60_000): Promise<{ status: number; j: unknown; text: string }> {
  const res = await fetch('/api/cloud-deploy/supabase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let j: unknown = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, j, text };
}

/** v3：云端函数同源转发调（verify-qq / setup-cron / stop-cron / 默微信轮询）。存量旧版函数没有
 *  CORS 头，浏览器直连函数 URL（带 X-Task-Secret 自定义头）会先发 OPTIONS 预检被拒→
 *  TypeError: Failed to fetch（云端验证/自动开定时/测试云端全挂，微信云端接管后 AI 不回消息
 *  的主因之一就是 setup-cron 开不了定时）；走 Next 服务端转发（服务端到服务端无 CORS）存量
 *  部署立即修复；新版函数（v3 起）自带 CORS 头，直连也可，代理双保险。返回 status+text。 */
async function funcViaProxy(
  ref: string,
  secret: string,
  action: string,
  body: Record<string, unknown> = {},
  timeoutMs = 70_000,
): Promise<{ ok: boolean; status: number; text: string; j: Record<string, unknown> | null }> {
  const { status, j, text } = await supaProxy(
    { op: 'func-call', ref, secret, ...(action ? { action } : {}), body },
    timeoutMs + 15_000,
  );
  return { ok: status >= 200 && status < 300, status, text, j: (j as Record<string, unknown> | null) ?? null };
}

/** 列出用户 Supabase 项目（部署目标选择用） */
export async function listProjects(token: string): Promise<SupaProject[]> {
  const { status, j } = await supaProxy({ op: 'projects', token }, 25_000);
  if (status !== 200 || !Array.isArray(j)) {
    const rec = (j ?? {}) as { message?: string };
    throw new Error(rec.message || `读取项目列表失败（${status}）——请确认 Access Token 有效`);
  }
  return (j as SupaProject[]).map((p) => ({ id: p.id, name: p.name, status: p.status, region: p.region }));
}

/** 手动粘贴的 key 保存前验证：调项目 Storage 列桶（代理走 check-service-key op），401/403 = 粘的是 publishable/anon */
export async function checkServiceKey(ref: string, serviceKey: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const { status, j } = await supaProxy({ op: 'check-service-key', ref, serviceKey }, 20_000);
    if (status === 200) return { ok: true, msg: 'key 有效（可写入项目 Storage）' };
    const rec = (j ?? {}) as { message?: string; error?: string };
    return { ok: false, msg: rec.message || rec.error || `验证失败（${status}）` };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/** 从项目 api-keys 响应里取 service_role（兼容：legacy 数组 / 2025 新式 sb_secret_ 数组 / 对象包裹 {data:[…]}）
 *  新式 secret key（sb_secret_ 开头）权限等价 service_role，直接可用。 */
export function pickServiceKey(j: unknown): string {
  const arr = Array.isArray(j)
    ? j
    : j && typeof j === 'object' && Array.isArray((j as { data?: unknown[] }).data)
      ? ((j as { data?: unknown[] }).data as unknown[])
      : null;
  if (arr) {
    // ① 名字直接叫 service_role / service_role_key 的项
    const named = arr.find(
      (x) =>
        x &&
        typeof x === 'object' &&
        ((x as { name?: string }).name === 'service_role' || (x as { name?: string }).name === 'service_role_key'),
    ) as { api_key?: string; key?: string } | undefined;
    if (named?.api_key) return named.api_key;
    if (named?.key) return named.key;
    // ② 新式 secret key：api_key 以 sb_secret_ 开头（type/name 含 secret）
    const secret = arr.find(
      (x) => x && typeof x === 'object' && typeof (x as { api_key?: string }).api_key === 'string' && (x as { api_key: string }).api_key.startsWith('sb_secret_'),
    ) as { api_key?: string } | undefined;
    if (secret?.api_key) return secret.api_key;
    // ③ 兜底：任何叫得出名字的项里以 sb_secret_ 开头的 key 字段
    for (const x of arr) {
      if (!x || typeof x !== 'object') continue;
      const k = (x as { key?: string }).key;
      if (typeof k === 'string' && k.startsWith('sb_secret_')) return k;
    }
  } else if (j && typeof j === 'object') {
    const o = j as { service_role?: string; service_role_key?: string; secret?: string };
    if (o.service_role) return o.service_role;
    if (o.service_role_key) return o.service_role_key;
    if (o.secret && o.secret.startsWith('sb_secret_')) return o.secret;
  }
  return '';
}

/** 同步运行包到用户 Supabase Storage（config.json 私有 + assistant.mjs 公开桶；不动云端聊天历史） */
export async function syncRunPackage(): Promise<DeployResult> {
  const st = wxCloudSnapshot();
  const supa = st.supabase;
  if (!supa?.token || !supa.ref) return { ok: false, msg: '请先填写 Supabase Access Token 并选择项目' };

  // 存量坏 key 自愈（用户实测踩坑）：serviceKey 被填成了 Access Token（sbp_ 开头）或公开密钥
  // （sb_publishable_）时 Storage 必拒——直接清掉并给出明确指引，下次部署重新自动获取/手动粘贴
  if (supa.serviceKey && /^(sbp_|sb_publishable_)/.test(supa.serviceKey)) {
    const isToken = supa.serviceKey.startsWith('sbp_');
    useWxCloud.getState().saveSupabase({ ...supa, serviceKey: '' });
    return {
      ok: false,
      code: 'need_manual_key',
      msg:
        (isToken
          ? '保存的密钥是 Access Token（sbp_ 开头，管理项目用的）——填错位置了，已自动清除。'
          : '保存的密钥是公开密钥（sb_publishable_ 开头），没有写入权限，已自动清除。') +
        '上传文件要用项目自己的密钥：到 Supabase 控制台 → Project Settings → API Keys，复制 sb_secret_ 开头的 secret key（或 Legacy API keys 里旧版 eyJ 开头的 service_role）粘贴到下方输入框，再重新点「一键部署」',
    };
  }

  const pkg: RunPackageResult = await buildRunPackage();
  if (!pkg.ok) return { ok: false, msg: pkg.msg };

  // service_key 缺失时先取一次（多形状兼容；拿不到回「手动粘贴」引导码）
  let serviceKey = supa.serviceKey;
  if (!serviceKey) {
    const { j, text } = await supaProxy({ op: 'keys', token: supa.token, ref: supa.ref }, 25_000);
    serviceKey = pickServiceKey(j);
    if (!serviceKey) {
      // 可能是 PAT 没项目权限 / 新式 secret key 不回明文——引导手动粘贴（Supabase 控制台
      // Project Settings → API 里可直接复制 service_role / sb_secret_ 开头的 secret key）
      const rec = (j ?? {}) as { message?: string; error?: string };
      void text;
      return {
        ok: false,
        code: 'need_manual_key',
        msg:
          `自动读取项目密钥失败${rec.message ? `（${String(rec.message).slice(0, 80)}）` : ''}。` +
          '说明：Access Token 只能管理项目（列项目/部署函数），上传配置文件要用项目自己的密钥（service_role 或 sb_secret_ 开头的 secret key）。' +
          '到 Supabase 控制台 → Project Settings → API Keys，复制 secret 类 key 粘贴到下方输入框（会先验证再保存），然后重新点「一键部署」',
      };
    }
  }

  const { status, j } = await supaProxy(
    {
      op: 'storage-setup',
      token: supa.token,
      ref: supa.ref,
      serviceKey,
      files: [
        { path: 'config.json', content: JSON.stringify(pkg.pkg, null, 2), bucket: BUCKET_PRIVATE, contentType: 'application/json' },
        { path: 'assistant.mjs', content: ASSISTANT_MJS, bucket: BUCKET_PUBLIC, contentType: 'text/javascript' },
      ],
    },
    60_000,
  );
  if (status !== 200) {
    const rec = (j ?? {}) as { message?: string; error?: string };
    return { ok: false, msg: rec.message || rec.error || `运行包上传失败（${status}）` };
  }

  // 保存 serviceKey（密文 kv，后续同步免再取）
  const next: WxCloudSupabase = { ...supa, serviceKey, projectUrl: `https://${supa.ref}.supabase.co` };
  useWxCloud.getState().saveSupabase(next);
  return {
    ok: true,
    msg: pkg.note ? `运行包已同步到你的 Supabase${pkg.note}` : '运行包已同步到你的 Supabase',
    funcUrl: `${next.projectUrl}/functions/v1/${FUNC_SLUG}`,
    ...(pkg.note ? { note: pkg.note } : {}),
  };
}

/** 接入/断开微信/QQ 后的后台自动同步：已部署过云端就重新推一次运行包（无需用户手动点同步）。
 *  返回 null = 还没部署过（接入页本身也被「先部署」阻断，这里只是兑底）；结果写进
 *  useWxCloud.lastAutoSync 供接入页展示同步状态行。 */
export async function autoSyncRunPackageIfDeployed(reason: string): Promise<DeployResult | null> {
  const st = wxCloudSnapshot();
  const supa = st.supabase;
  const deployed =
    (st.platform === 'supabase' && (supa?.deployedAt ?? 0) > 0) ||
    (st.platform === 'hf' && (st.hf?.deployedAt ?? 0) > 0) ||
    (st.platform === 'clawcloud' && !!st.clawcloudAt);
  if (!deployed || !supa?.token || !supa.ref) return null;
  let r: DeployResult;
  try {
    r = await syncRunPackage();
  } catch (e) {
    r = { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
  useWxCloud.getState().setLastAutoSync({ ok: r.ok, msg: r.ok ? `${reason}：云端配置已自动同步` : `${reason}后自动同步失败（${r.msg.slice(0, 80)}）——到 设置 → 云端助手 点「重新同步运行包」` });
  return r;
}

/** 一键部署：同步运行包 + 部署 Edge Function + 自动开定时轮询（无需用户复制 SQL） */
export async function deploySupabase(): Promise<DeployResult> {
  const st = wxCloudSnapshot();
  const supa = st.supabase;
  if (!supa?.token || !supa.ref) return { ok: false, msg: '请先填写 Supabase Access Token 并选择项目' };

  const sync = await syncRunPackage();
  if (!sync.ok) return sync;

  const { status, j } = await supaProxy({ op: 'deploy', token: supa.token, ref: supa.ref, code: EDGE_FUNCTION_TS }, 150_000);
  if (status >= 400) {
    const rec = (j ?? {}) as { message?: string; error?: string };
    return { ok: false, msg: rec.message || rec.error || `函数部署失败（${status}）` };
  }

  const projectUrl = `https://${supa.ref}.supabase.co`;
  useWxCloud.getState().saveSupabase({
    ...supa,
    projectUrl,
    deployedAt: Date.now(),
  });
  useWxCloud.getState().setPlatform('supabase');

  // 自动开启定时轮询（函数直连用户库执行 cron.schedule；失败时 UI 可用手动 SQL 兜底）
  // v3：走同源代理转发（旧版函数无 CORS 头，浏览器直连 funcUrl 必 Failed to fetch →
  // 定时开不了 → 微信云端接管后 AI 不回消息；代理转发无 CORS 问题，存量部署立即修复）
  let cronMsg = '';
  try {
    const r = await funcViaProxy(supa.ref, supa.secret, 'setup-cron', {}, 60_000);
    const jr = r.j as { ok?: boolean; error?: string } | null;
    cronMsg = r.ok && jr?.ok
      ? '，定时轮询已自动开启（微信云端接管即刻生效）'
      : `（自动开定时失败：${(jr?.error || r.text || r.status).toString().slice(0, 60)}，可用下方「手动 SQL」兜底）`;
  } catch (e) {
    cronMsg = `（自动开定时失败：${(e instanceof Error ? e.message : String(e)).slice(0, 60)}，可用下方「手动 SQL」兜底）`;
  }

  return {
    ok: true,
    msg: `云端助手已部署到你的 Supabase${cronMsg}${sync.note ?? ''}`,
    funcUrl: `${projectUrl}/functions/v1/${FUNC_SLUG}`,
    ...(sync.note ? { note: sync.note } : {}),
  };
}

/** 停用云端定时轮询（自动；失败用手动 SQL）——v3 走同源代理（旧版函数无 CORS 头，直连会 Failed to fetch） */
export async function stopSupabaseCron(): Promise<{ ok: boolean; msg: string }> {
  const supa = wxCloudSnapshot().supabase;
  if (!supa?.ref) return { ok: false, msg: '还没部署' };
  try {
    const r = await funcViaProxy(supa.ref, supa.secret, 'stop-cron', {}, 30_000);
    const j = r.j as { ok?: boolean; error?: string } | null;
    return r.ok && j?.ok ? { ok: true, msg: '已停用云端定时轮询（零配额消耗）' } : { ok: false, msg: j?.error || `停用失败（${r.status}）` };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/** 生成 pg_cron 定时 SQL（自动填好函数 URL 与任务密钥；复制到 Supabase SQL Editor 执行） */
export function cronSql(): string {
  const supa = wxCloudSnapshot().supabase;
  if (!supa?.ref) return '';
  const url = `https://${supa.ref}.supabase.co/functions/v1/${FUNC_SLUG}`;
  return [
    '-- 微信云端助手 · 开启每分钟自动轮询（复制全部内容到 Supabase SQL Editor 执行）',
    'create extension if not exists pg_cron;',
    'create extension if not exists pg_net;',
    "select cron.unschedule('wx-assistant');",
    'select cron.schedule(',
    "  'wx-assistant',",
    "  '* * * * *',",
    '  $$',
    `    select net.http_post(`,
    `      url := '${url}',`,
    `      headers := '{"Content-Type":"application/json","X-Task-Secret":"${supa.secret}"}'::jsonb,`,
    "      body := '{}'::jsonb",
    '    );',
    '  $$',
    ');',
  ].join('\n');
}

/** 停用云端轮询的 SQL */
export function cronStopSql(): string {
  return "select cron.unschedule('wx-assistant');";
}

/** 测试云端：调一次函数（带任务密钥），返回心跳——v3 走同源代理（旧版函数无 CORS 头，
 *  浏览器直连会 Failed to fetch；走服务端转发能看到云端真实 lastError：微信 token 过期 /
 *  LLM 配置无效等一目了然） */
export async function pingSupabase(): Promise<{ ok: boolean; msg: string }> {
  const supa = wxCloudSnapshot().supabase;
  if (!supa?.ref) return { ok: false, msg: '还没部署：先完成一键部署' };
  try {
    // 默分支会跑 100 秒微信轮询窗口，代理超时 150s 兜底（func-call 服务端上限）
    const r = await funcViaProxy(supa.ref, supa.secret, '', {}, 145_000);
    let j: { ok?: boolean; handled?: number; lastError?: string; error?: string } | null = null;
    try {
      j = JSON.parse(r.text) as typeof j;
    } catch {
      /* 非 JSON */
    }
    if (r.ok && j?.ok) {
      // v4：微信逐条回复失败不再静默（LLM 配置无效/网络不通等）——ping 里直接看到原因
      const warn = j.wxMsgError ? `；注意：最近一条微信回复失败——${String(j.wxMsgError).slice(0, 100)}（多为云端访问不了你的模型 API：核对 设置 → API 配置 的地址是否公网可达，改完重新同步运行包）` : '';
      const res = { ok: true, msg: `云端正常：本轮处理 ${j.handled ?? 0} 条消息（含 100 秒轮询窗口）${warn}` };
      useWxCloud.getState().setLastPing(res);
      return res;
    }
    if (r.status === 401) {
      const res = { ok: false, msg: '密钥不匹配：请重新点「一键部署」或检查 cron SQL 里的 X-Task-Secret' };
      useWxCloud.getState().setLastPing(res);
      return res;
    }
    if (r.status === 504) {
      const res = { ok: false, msg: '连不上云端函数：请确认已一键部署；刚部署需 10-30 秒冷启动，稍等再试' };
      useWxCloud.getState().setLastPing(res);
      return res;
    }
    const res = { ok: false, msg: (j && (j.lastError || j.error)) || `云端返回 ${r.status}：${r.text.slice(0, 120)}` };
    useWxCloud.getState().setLastPing(res);
    return res;
  } catch (e) {
    const res = { ok: false, msg: e instanceof Error ? e.message : String(e) };
    useWxCloud.getState().setLastPing(res);
    return res;
  }
}

/** 保存 Supabase 连接信息（token + ref；serviceKey 部署时自动补） */
export function saveSupabaseConn(token: string, ref: string, projectName: string): void {
  const st = wxCloudSnapshot();
  useWxCloud.getState().saveSupabase({
    token: token.trim(),
    ref: ref.trim(),
    projectUrl: `https://${ref.trim()}.supabase.co`,
    serviceKey: st.supabase?.serviceKey ?? '',
    secret: st.supabase?.secret ?? '',
    deployedAt: st.supabase?.deployedAt ?? 0,
  });
  void projectName;
}
