'use client';

/**
 * Supabase 一键部署管线（全部经 /api/cloud-deploy/supabase 代理，解决 CORS；
 * 用户凭证只在内存与用户自己的浏览器密文 kv 里，服务端不留存）。
 *
 * 流程（v4 新顺序）：列项目 → 部署 wx-assistant Edge Function（Management API，只依赖
 * Access Token，这条链路最稳）→ 建桶+上传运行包（候选密钥×双头型直传 → 云端函数代写
 * 多级兜底——用户 Storage key 被 JWT 轮换/新式 key 兼容性拒收时也能部署成功）→
 * 自动开定时轮询。更新配置只需重新同步（storage-setup），无需重部署。
 */

import { useWxCloud, wxCloudSnapshot, ensureTaskSecret, type WxCloudSupabase } from './store';
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

/** v4：收集项目 api-keys 响应里「所有」可用的 secret 类 key（多形状兼容同 pickServiceKey）。
 *  顺序：sb_secret_ 新式在前（新项目主路径），legacy service_role（eyJ）在后（兑底）——
 *  上传时逐个试，哪个通用哪个；全部被拒还有云端函数代写兑底。 */
export function pickAllServiceKeys(j: unknown): string[] {
  const out: string[] = [];
  const push = (k: unknown) => {
    if (typeof k === 'string' && k && !out.includes(k)) out.push(k);
  };
  const arr = Array.isArray(j)
    ? j
    : j && typeof j === 'object' && Array.isArray((j as { data?: unknown[] }).data)
      ? ((j as { data?: unknown[] }).data as unknown[])
      : null;
  if (arr) {
    for (const x of arr) {
      if (!x || typeof x !== 'object') continue;
      const k = (x as { api_key?: string; key?: string }).api_key ?? (x as { key?: string }).key;
      if (typeof k === 'string' && k.startsWith('sb_secret_')) push(k);
    }
    for (const x of arr) {
      if (!x || typeof x !== 'object') continue;
      const name = (x as { name?: string }).name;
      const k = (x as { api_key?: string; key?: string }).api_key ?? (x as { key?: string }).key;
      if (typeof k === 'string' && k.startsWith('eyJ') && (name === 'service_role' || name === 'service_role_key')) push(k);
    }
  } else if (j && typeof j === 'object') {
    const o = j as { service_role?: string; service_role_key?: string; secret?: string };
    if (o.secret && o.secret.startsWith('sb_secret_')) push(o.secret);
    if (o.service_role) push(o.service_role);
    if (o.service_role_key) push(o.service_role_key);
  }
  return out;
}

/** 同步运行包到用户 Supabase Storage（config.json 私有 + assistant.mjs 公开桶；不动云端聊天历史）。
 *  v4：上传三级兑底（服务端代理里实现）——候选密钥×双头型直传 → 云端函数代写（平台注入
 *  凭证写入，不依赖用户 key）。所以「自动读取项目密钥失败」不再阻断同步：直传没成时代写
 *  兑着；两端都不行才把每轮真实结果带回来。 */
export async function syncRunPackage(): Promise<DeployResult> {
  const st = wxCloudSnapshot();
  let supa = st.supabase;
  if (!supa?.token || !supa.ref) return { ok: false, msg: '请先填写 Supabase Access Token 并选择项目' };

  // 存量坏 key 自愈（用户实测踩坑）：serviceKey 被填成了 Access Token（sbp_ 开头）或公开密钥
  // （sb_publishable_）时 Storage 必拒——直接清掉（候选列表里也剔掉，下次重新自动获取/手动粘贴）
  if (supa.serviceKey && /^(sbp_|sb_publishable_)/.test(supa.serviceKey)) {
    supa = { ...supa, serviceKey: '' };
    useWxCloud.getState().saveSupabase(supa);
  }

  const pkg: RunPackageResult = await buildRunPackage();
  if (!pkg.ok) return { ok: false, msg: pkg.msg };

  // 候选密钥：已保存的 + 自动读取的全部 secret 类 key（尽力而为，读不到不阻断——
  // 还有云端函数代写路径，它不需要项目密钥）
  const candidates: string[] = [];
  if (supa.serviceKey) candidates.push(supa.serviceKey);
  try {
    const { j } = await supaProxy({ op: 'keys', token: supa.token, ref: supa.ref }, 25_000);
    for (const k of pickAllServiceKeys(j)) if (!candidates.includes(k)) candidates.push(k);
  } catch {
    /* 读取失败不阻断：代写路径不需要密钥 */
  }

  const { status, j } = await supaProxy(
    {
      op: 'storage-setup',
      token: supa.token,
      ref: supa.ref,
      serviceKeys: candidates,
      // 任务密钥：云端函数代写上传用它鉴权（没生成过就顺手生成并保存）
      secret: supa.secret || ensureTaskSecret(),
      files: [
        { path: 'config.json', content: JSON.stringify(pkg.pkg, null, 2), bucket: BUCKET_PRIVATE, contentType: 'application/json' },
        { path: 'assistant.mjs', content: ASSISTANT_MJS, bucket: BUCKET_PUBLIC, contentType: 'text/javascript' },
      ],
    },
    150_000,
  );
  if (status !== 200) {
    const rec = (j ?? {}) as { message?: string; error?: string };
    return { ok: false, msg: rec.message || rec.error || `运行包上传失败（${status}）` };
  }

  // 保存直传成功的那个 key（密文 kv，后续同步免再取）；代写成功时清掉存量坏 key
  const rec = (j ?? {}) as { usedKey?: string; via?: string };
  const next: WxCloudSupabase = {
    ...supa,
    serviceKey: typeof rec.usedKey === 'string' ? rec.usedKey : '',
    projectUrl: `https://${supa.ref}.supabase.co`,
  };
  useWxCloud.getState().saveSupabase(next);
  const viaNote = rec.via === 'function' ? '（云端函数代写——项目密钥被 Storage 拒收，已走平台凭证通道）' : '';
  return {
    ok: true,
    msg: pkg.note ? `运行包已同步到你的 Supabase${viaNote}${pkg.note}` : `运行包已同步到你的 Supabase${viaNote}`,
    funcUrl: `${next.projectUrl}/functions/v1/${FUNC_SLUG}`,
    ...(pkg.note ? { note: pkg.note } : {}),
  };
}

/** 接入/断开微信/QQ 后的后台自动同步：已部署过云端就重新推一次运行包（无需用户手动点同步）。
 *  返回 null = 还没部署过（接入页本身也被「先部署」阻断，这里只是兑底）；结果写进
 *  useWxCloud.lastAutoSync（带 channel 标记，只在对应接入页展示）供接入页展示同步状态行。 */
export async function autoSyncRunPackageIfDeployed(reason: string, channel: 'qq' | 'wx'): Promise<DeployResult | null> {
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
  useWxCloud.getState().setLastAutoSync({ ok: r.ok, msg: r.ok ? `${reason}：云端配置已自动同步` : `${reason}后自动同步失败（${r.msg.slice(0, 80)}）——到 设置 → 云端助手 点「重新同步运行包」`, channel });
  return r;
}

/** 一键部署（v4 新顺序）：① 部署 Edge Function + 注入任务密钥 WX_TASK_SECRET（Management
 *  API，只依赖 Access Token——这条链路最稳）→ ② 同步运行包（直传多级兑底 + 云端函数代写；
 *  此时函数已在，用户 Storage key 被项目全拒也能传上去）→ ③ 自动开定时轮询。旧顺序
 *  「先上传再部署」在 key 被拒收（signature verification failed 等）时卡死在第一步，
 *  函数根本部署不出去。 */
export async function deploySupabase(): Promise<DeployResult> {
  const st0 = wxCloudSnapshot();
  let supa = st0.supabase;
  if (!supa?.token || !supa.ref) return { ok: false, msg: '请先填写 Supabase Access Token 并选择项目' };

  // 任务密钥先立住：部署时注入函数（WX_TASK_SECRET），同步运行包时云端代写鉴权都用它
  const secret = ensureTaskSecret();
  supa = wxCloudSnapshot().supabase ?? supa;

  const dep = await supaProxy({ op: 'deploy', token: supa.token, ref: supa.ref, code: EDGE_FUNCTION_TS, secret }, 150_000);
  if (dep.status >= 400) {
    const rec = (dep.j ?? {}) as { message?: string; error?: string };
    return { ok: false, msg: rec.message || rec.error || `函数部署失败（${dep.status}）` };
  }

  const projectUrl = `https://${supa.ref}.supabase.co`;
  useWxCloud.getState().saveSupabase({
    ...supa,
    projectUrl,
    deployedAt: Date.now(),
  });
  useWxCloud.getState().setPlatform('supabase');

  // 运行包上传（函数已部署：候选密钥直传 → 云端函数代写多级兑底）
  const sync = await syncRunPackage();
  if (!sync.ok) {
    return { ...sync, msg: `云端函数已部署成功，但运行包上传失败：${sync.msg}` };
  }

  // 自动开启定时轮询（函数直连用户库执行 cron.schedule；失败时 UI 可用手动 SQL 兜底）
  // v3：走同源代理转发（旧版函数无 CORS 头，浏览器直连 funcUrl 必 Failed to fetch →
  // 定时开不了 → 微信云端接管后 AI 不回消息；代理转发无 CORS 问题，存量部署立即修复）
  let cronOk = false;
  let cronMsg = '';
  try {
    // v4：重读快照（ensureTaskSecret 刚写过库），避免用到部署前的旧 secret
    const fresh = wxCloudSnapshot().supabase ?? supa;
    const r = await funcViaProxy(fresh.ref, fresh.secret, 'setup-cron', {}, 60_000);
    const jr = r.j as { ok?: boolean; error?: string } | null;
    cronOk = r.ok && !!jr?.ok;
    cronMsg = cronOk
      ? '，云端轮询已开启'
      : `（自动开启失败：${(jr?.error || r.text || r.status).toString().slice(0, 60)}，可用开关重开或手动 SQL 兜底）`;
  } catch (e) {
    cronMsg = `（自动开启失败：${(e instanceof Error ? e.message : String(e)).slice(0, 60)}，可用开关重开或手动 SQL 兜底）`;
  }
  // 部署后同步开关状态（cronOn 跟随 setup-cron 真实结果；「云端轮询」开关据此展示）
  useWxCloud.getState().saveSupabase({ ...(wxCloudSnapshot().supabase ?? supa), cronOn: cronOk });

  return {
    ok: true,
    msg: `云端助手已部署到你的 Supabase${cronMsg}${sync.note ?? ''}`,
    funcUrl: `${projectUrl}/functions/v1/${FUNC_SLUG}`,
    ...(sync.note ? { note: sync.note } : {}),
  };
}

/** 开启云端定时轮询（「云端轮询」开关 ON：云端每分钟自动收发一轮、TA 全天在线）——
 *  v3 走同源代理（旧版函数无 CORS 头，直连会 Failed to fetch）；成功后写 cronOn=true */
export async function startSupabaseCron(): Promise<{ ok: boolean; msg: string }> {
  const supa = wxCloudSnapshot().supabase;
  if (!supa?.ref) return { ok: false, msg: '还没部署：先完成一键部署' };
  try {
    const r = await funcViaProxy(supa.ref, supa.secret, 'setup-cron', {}, 60_000);
    const j = r.j as { ok?: boolean; error?: string } | null;
    if (r.ok && j?.ok) {
      useWxCloud.getState().saveSupabase({ ...supa, cronOn: true });
      return { ok: true, msg: '云端轮询已开启：TA 全天在线自动回复' };
    }
    return { ok: false, msg: j?.error || `开启失败（${r.status}）——可用「定时轮询手动 SQL」兑底` };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/** 停用云端定时轮询（「云端轮询」开关 OFF：不再被 cron 唤醒，零配额消耗）——v3 走同源代理
 *  （旧版函数无 CORS 头，直连会 Failed to fetch）；成功后写 cronOn=false */
export async function stopSupabaseCron(): Promise<{ ok: boolean; msg: string }> {
  const supa = wxCloudSnapshot().supabase;
  if (!supa?.ref) return { ok: false, msg: '还没部署' };
  try {
    const r = await funcViaProxy(supa.ref, supa.secret, 'stop-cron', {}, 30_000);
    const j = r.j as { ok?: boolean; error?: string } | null;
    if (r.ok && j?.ok) {
      useWxCloud.getState().saveSupabase({ ...supa, cronOn: false });
      return { ok: true, msg: '已停用云端轮询（零配额消耗）' };
    }
    return { ok: false, msg: j?.error || `停用失败（${r.status}）` };
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
