'use client';

/**
 * Supabase 一键部署管线（全部经 /api/cloud-deploy/supabase 代理，解决 CORS；
 * 用户凭证只在内存与用户自己的浏览器密文 kv 里，服务端不留存）。
 *
 * 流程（v5 被动 Webhook 版）：列项目 → 部署 wx-assistant Edge Function（Management API，只依赖
 * Access Token，这条链路最稳）→ 建桶+上传运行包（候选密钥×双头型直传 → 云端函数代写
 * 多级兜底——用户 Storage key 被 JWT 轮换/新式 key 兼容性拒收时也能部署成功）→ 顺手清
 * 掉旧版每分钟定时轮询任务（unschedule-cron，幂等）。QQ 收发走被动 Webhook（消息来了
 * 才运行，零轮询消耗）；微信代答由手机页面开着时的本机回复承担，或手动「云端测试一次」
 * 单轮收发。更新配置只需重新同步（storage-setup），无需重部署。
 */

import { useWxCloud, wxCloudSnapshot, ensureTaskSecret, type WxCloudSupabase } from './store';
import { buildRunPackage, type RunPackageResult } from './run-package';
import { ASSISTANT_MJS, EDGE_FUNCTION_TS, CLOUD_RUNTIME_VER } from './sources';

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

/** v3：云端函数同源转发调（verify-qq / ping / 默微信单轮收发）。存量旧版函数没有
 *  CORS 头，浏览器直连函数 URL（带 X-Task-Secret 自定义头）会先发 OPTIONS 预检被拒→
 *  TypeError: Failed to fetch；走 Next 服务端转发（服务端到服务端无 CORS）存量部署立即
 *  修复；新版函数（v3 起）自带 CORS 头，直连也可，代理双保险。返回 status+text。
 *  v5：setup-cron / stop-cron 已退役（被动 Webhook 模式无需轮询；清旧任务走
 *  stopSupabaseCron → Management API SQL，不再经函数）。 */
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

/** v8：经云端函数中继读私有桶 JSON（func-call 代理 → read-file 动作）。serviceKey 拿不到/
 *  被拒（代写路径部署后为空，或 JWT 轮换后旧 key 全拒）时唯一的读通道——与内置 IM 网关
 *  同一条路。云端函数 ver>=8 才支持（旧函数不是 relay 形状回包，按不支持返回 null）。
 *  null = 通道不可用/文件不存在；调用方各自组织可读文案。 */
export async function readBucketJsonViaRelay<T>(ref: string, path: string): Promise<T | null> {
  const secret = wxCloudSnapshot().supabase?.secret || '';
  if (!ref || !secret) return null;
  try {
    const { status, j } = await supaProxy({ op: 'func-call', ref, secret, action: 'read-file', body: { path } }, 30_000);
    if (status !== 200) return null;
    const rec = j as { ok?: boolean; relay?: boolean; data?: unknown } | null;
    if (!rec || rec.ok !== true || rec.relay !== true || typeof rec.data === 'undefined') return null;
    return rec.data as T;
  } catch {
    return null;
  }
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

  // v15 运行时升级链：同步不再只推配置——先探云端函数代际（action=ping 回 ver），旧于
  // 当前代就重部署最新函数代码。旧版「重新同步只推配置不推代码」= 真机一直跑旧函数
  // （只回一两条/不会表情包/不会语音/不会引用的根因）。探测不到不阻断；部署失败只附注
  // （配置仍同步，重试一键部署可补）。升级后的版本号写进 store（设置页版本行展示）。
  let upgradeNote = '';
  let runtimeVer: number | null = null;
  try {
    const pv = await funcViaProxy(supa.ref, supa.secret || ensureTaskSecret(), 'ping', {}, 20_000);
    const vr = pv.j && typeof pv.j.ver === 'number' ? pv.j.ver : null;
    if (vr !== null) runtimeVer = vr;
  } catch {
    /* 探不到（旧版函数无 ping 动作/网络问题）：跳过升级，同步继续 */
  }
  if (runtimeVer !== null && runtimeVer < CLOUD_RUNTIME_VER) {
    try {
      const dep = await supaProxy({ op: 'deploy', token: supa.token, ref: supa.ref, code: EDGE_FUNCTION_TS, secret: supa.secret || ensureTaskSecret() }, 150_000);
      if (dep.status < 400) {
        runtimeVer = CLOUD_RUNTIME_VER;
        upgradeNote = '；云端运行时代码已升级到最新（v' + CLOUD_RUNTIME_VER + '）';
      } else {
        upgradeNote = `；注意：云端运行时升级失败（${dep.status}）——重新点一次「一键部署」可重试`;
      }
    } catch {
      upgradeNote = '；注意：云端运行时升级失败（网络超时）——重新点一次「一键部署」可重试';
    }
  }
  useWxCloud.getState().setLastRuntimeVer(runtimeVer);

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
        // v14 微信表情包（真图发送）：独立文件 emoticons.json（避开 config.json 的 800KB 单文件
        // 上限；云端核心读它的 wechat 段，QQ 表情仍走 config.json 的 qq.emoticons 不变）
        ...(pkg.emoticonsFile
          ? [{ path: 'emoticons.json', content: JSON.stringify(pkg.emoticonsFile), bucket: BUCKET_PRIVATE, contentType: 'application/json' } as const]
          : []),
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
  // v16：同步后顺手升级定时任务到「10 秒轮询」档（幂等 schedule-cron：先 unschedule 同名
  // 再建——存量 1 分钟任务被换成 wx-assistant 10s + wx-assistant-qq 每分钟两个任务；
  // 用户手动关过轮询 cronOn=false 则不动）。失败不阻断（文案不追加——重开开关可重试）。
  if ((wxCloudSnapshot().supabase?.cronOn ?? false)) {
    try {
      const fresh = wxCloudSnapshot().supabase ?? next;
      const { status, j: j2 } = await supaProxy({ op: 'schedule-cron', token: fresh.token, ref: fresh.ref, secret: fresh.secret || ensureTaskSecret() }, 60_000);
      const rec2 = (j2 ?? {}) as { ok?: boolean };
      if (status === 200 && rec2.ok) upgradeNote = (upgradeNote ? upgradeNote + '；' : '') + '；云端轮询已升级为每 10 秒一档';
    } catch {
      /* 定时任务升级失败不影响配置同步；开关重开可重试 */
    }
  }
  const viaNote = rec.via === 'function' ? '（云端函数代写——项目密钥被 Storage 拒收，已走平台凭证通道）' : '';
  return {
    ok: true,
    msg: pkg.note ? `运行包已同步到你的 Supabase${viaNote}${upgradeNote}${pkg.note}` : `运行包已同步到你的 Supabase${viaNote}${upgradeNote}`,
    funcUrl: `${next.projectUrl}/functions/v1/${FUNC_SLUG}`,
    ...(pkg.note ? { note: pkg.note } : {}),
  };
}

/** 接入/断开微信/QQ、改「API 设置」后的后台自动同步：已部署过云端就重新推一次运行包（无需
 *  用户手动点同步）。返回 null = 还没部署过（接入页本身也被「先部署」阻断，这里只是兑底）；
 *  结果写进 useWxCloud.lastAutoSync（带 channel 标记，只在对应页面展示）供页面展示同步状态行。 */
export async function autoSyncRunPackageIfDeployed(reason: string, channel: 'qq' | 'wx' | 'api'): Promise<DeployResult | null> {
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
  // v10：同步成功后顺手通知内置网关重查 QQ 凭证（op=refresh：QQ 通道还处于「未接入」
  // 时立即重连，免去网关 30 秒自查周期——接入 QQ 后几秒内点亮的最后一块拼图）。
  if (r.ok) {
    void import('./gateway').then((m) => m.refreshImGateway()).catch(() => undefined);
  }
  useWxCloud.getState().setLastAutoSync({ ok: r.ok, msg: r.ok ? `${reason}：云端配置已自动同步` : `${reason}后自动同步失败（${r.msg.slice(0, 80)}）——到 设置 → 云端助手 点「重新同步运行包」`, channel });
  return r;
}

/** 一键部署（v9 云端 7×24 骨干版）：① 部署 Edge Function + 注入任务密钥 WX_TASK_SECRET（Management
 *  API，只依赖 Access Token——这条链路最稳）→ ② 同步运行包（直传多级兑底 + 云端函数代写；
 *  此时函数已在，用户 Storage key 被项目全拒也能传上去）→ ③ 自动建立「云端轮询」定时
 *  任务（pg_cron 存用户数据库里，v16 两档：每 10 秒打 cron-cycle&fast=1 微信短窗单轮 +
 *  每分钟打 cron-cycle&qq=1 QQ WebSocket
 *  会话保持——v9 核心变化：这一切跑在用户自己的 Supabase 里，不依赖本站在线；旧版部署后
 *  顺手清定时任务的行为反转）。失败不阻断部署（失败原因进文案，重试一键部署即可）。 */
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

  // 运行包上传（函数已部署：候选密钥直传 → 云端函数代写多级兜底）
  const sync = await syncRunPackage();
  if (!sync.ok) {
    return { ...sync, msg: `云端函数已部署成功，但运行包上传失败：${sync.msg}` };
  }

  // v9/v16：自动建立「云端轮询」定时任务（pg_cron + pg_net，存用户数据库；每 10 秒微信短窗
  // 单轮 + 每分钟 QQ 长连接保持两档）——离开本站后微信 10 秒一档照收、QQ 断点续连，收发
  // 骨干彻底落在用户自己的 Supabase 项目里。幂等 best-effort：失败不阻断部署（文案带原因）。
  let cronNote = '';
  try {
    const fresh = wxCloudSnapshot().supabase ?? supa;
    const { status, j } = await supaProxy({ op: 'schedule-cron', token: fresh.token, ref: fresh.ref, secret }, 60_000);
    const rec = (j ?? {}) as { ok?: boolean; msg?: string };
    if (status === 200 && rec.ok) {
      useWxCloud.getState().saveSupabase({ ...(wxCloudSnapshot().supabase ?? fresh), cronOn: true });
      cronNote = '；云端轮询已开启：每 10 秒自动轮询回复（跑在你的 Supabase 里，本站关了也照常收发）';
    } else {
      cronNote = `；注意：云端轮询未能开启（${(rec.msg || `HTTP ${status}`).slice(0, 90)}）——重新点一次「一键部署」可重试`;
    }
  } catch {
    cronNote = '；注意：云端轮询未能开启（网络超时）——重新点一次「一键部署」可重试';
  }

  return {
    ok: true,
    // v9 文案：骨干在用户自己的 Supabase（不依赖本站在线）；本站网关只是免费加速器
    msg: `云端助手已部署到你的 Supabase${cronNote}${sync.note ?? ''}，微信 QQ 全天自动收发（无需任何回调地址；云端轮询每 10 秒一档，随时可在「云端轮询」开关停用/再开启）`,
    funcUrl: `${projectUrl}/functions/v1/${FUNC_SLUG}`,
    ...(sync.note ? { note: sync.note } : {}),
  };
}

/** 开启云端轮询（v16 升格 10 秒档；v9 起部署后自动建立，此处供重试/修复/重开用）：两个
 *  pg_cron 任务——wx-assistant（每 10 秒打 cron-cycle&fast=1：微信短窗单轮收发）+
 *  wx-assistant-qq（每分钟打 cron-cycle&qq=1：QQ WebSocket 会话保持）。存在用户自己的
 *  Supabase 数据库里，不依赖本站在线；双轮询器安全（锁+认领）由函数核心兑底，与本站
 *  网关同跑不会双回。停止走 stopSupabaseCron（立刻生效、零配额消耗）。 */
export async function startSupabaseCron(): Promise<{ ok: boolean; msg: string }> {
  let supa = wxCloudSnapshot().supabase;
  if (!supa?.ref || !supa.token) return { ok: false, msg: '还没部署：先完成一键部署' };
  // 任务密钥：与部署时注入函数的 WX_TASK_SECRET 同源（没生成过就顺手生成并保存）
  const secret = supa.secret || ensureTaskSecret();
  supa = wxCloudSnapshot().supabase ?? supa;
  try {
    const { status, j, text } = await supaProxy({ op: 'schedule-cron', token: supa.token, ref: supa.ref, secret }, 60_000);
    const rec = (j ?? {}) as { ok?: boolean; msg?: string; message?: string; error?: string };
    if (status === 200 && rec.ok) {
      useWxCloud.getState().saveSupabase({ ...supa!, cronOn: true });
      return {
        ok: true,
        msg: (rec.msg || '云端轮询已开启：每 10 秒自动轮询回复') + '（跑在你的 Supabase 里，本站关了也照常收发）',
      };
    }
    return { ok: false, msg: rec.msg || rec.message || rec.error || text.slice(0, 120) || `开启失败（${status}）` };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/** 停止云端轮询（「云端轮询」开关关闭时调用）：清掉两个定时任务 + 日志清理（走服务端
 *  Management API SQL，unschedule-cron op，幂等：任务本来不存在也算成功）。停用立刻生效、
 *  零配额消耗——云端不再自动回复（删除网站/关站后也不会再回），只有页面开着时回复；
 *  重新打开开关即可再开启。 */
export async function stopSupabaseCron(): Promise<{ ok: boolean; msg: string }> {
  const supa = wxCloudSnapshot().supabase;
  if (!supa?.ref || !supa.token) return { ok: false, msg: '还没部署：先完成一键部署' };
  try {
    const { status, j, text } = await supaProxy({ op: 'unschedule-cron', token: supa.token, ref: supa.ref }, 45_000);
    const rec = (j ?? {}) as { ok?: boolean; msg?: string; message?: string; error?: string };
    if (status === 200 && rec.ok) {
      useWxCloud.getState().saveSupabase({ ...supa, cronOn: false });
      return { ok: true, msg: (rec.msg || '云端轮询已停止') + '（停用立刻生效、零配额消耗；重新打开「云端轮询」开关即可再开启自动回复）' };
    }
    return { ok: false, msg: rec.msg || rec.message || rec.error || text.slice(0, 120) || `停止失败（${status}）` };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

/** 开启云端轮询的手动 SQL（自动建立失败时的兑底；复制到 Supabase SQL Editor 执行） */
export function cronStartSql(): string {
  const supa = wxCloudSnapshot().supabase;
  const url = supa?.ref ? `https://${supa.ref}.supabase.co/functions/v1/wx-assistant?action=cron-cycle` : 'https://<你的项目ref>.supabase.co/functions/v1/wx-assistant?action=cron-cycle';
  const secret = supa?.secret || '<任务密钥>';
  return (
    'create extension if not exists pg_cron;\n' +
    'create extension if not exists pg_net;\n' +
    `select cron.unschedule('wx-assistant');\n` +
    `select cron.unschedule('wx-assistant-qq');\n` +
    `select cron.unschedule('wx-assistant-cleanup');\n` +
    `select cron.schedule('wx-assistant', '10 seconds', $CRON$\n` +
    `  select net.http_post(\n` +
    `    url     := '${url}&fast=1',\n` +
    `    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Task-Secret', '${secret}'),\n` +
    `    body    := jsonb_build_object(),\n` +
    `    timeout_milliseconds := 15000\n` +
    `  );\n` +
    `$CRON$);\n` +
    `\n` +
    `select cron.schedule('wx-assistant-qq', '* * * * *', $CRON$\n` +
    `  select net.http_post(\n` +
    `    url     := '${url}&qq=1',\n` +
    `    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Task-Secret', '${secret}'),\n` +
    `    body    := jsonb_build_object(),\n` +
    `    timeout_milliseconds := 150000\n` +
    `  );\n` +
    `$CRON$);\n` +
    `\n` +
    `-- 顺手挂一个每日清理（pg_cron 每次运行都往 cron.job_run_details 记一行，不清会蚕食容量）\n` +
    `select cron.schedule('wx-assistant-cleanup', '0 3 * * *', $CRON$\n` +
    `  delete from cron.job_run_details where end_time < now() - interval '3 days';\n` +
    `$CRON$);\n` +
    `\n` +
    `-- 停止时执行：\n` +
    `select cron.unschedule('wx-assistant');\n` +
    `select cron.unschedule('wx-assistant-qq');\n` +
    `select cron.unschedule('wx-assistant-cleanup');`
  );
}

/** 停用云端轮询的手动 SQL（开关关闭失败时的兜底；复制到 Supabase SQL Editor 执行） */
export function cronStopSql(): string {
  return "select cron.unschedule('wx-assistant'); select cron.unschedule('wx-assistant-qq'); select cron.unschedule('wx-assistant-cleanup'); select cron.unschedule('assistant-polling');";
}

/** 测试云端：调一次函数（带任务密钥），返回心跳——v3 走同源代理（旧版函数无 CORS 头，
 *  浏览器直连会 Failed to fetch；走服务端转发能看到云端真实 lastError：微信 token 过期 /
 *  LLM 配置无效等一目了然）。v5：默认动作改单轮收发（一次 getupdates 服务端挂 ~35s，零
 *  CPU 热转——旧版 100 秒热循环轮询是 546 WORKER_RESOURCE_LIMIT 的根因），点完测试 TA
 *  真的会把待回的微信消息回掉。 */
export async function pingSupabase(): Promise<{ ok: boolean; msg: string }> {
  const supa = wxCloudSnapshot().supabase;
  if (!supa?.ref) return { ok: false, msg: '还没部署：先完成一键部署' };
  try {
    // 默分支单轮收发：一次 getupdates 服务端挂 ~35s，留足 90s 窗口（旧版 100 秒热循环已退役）
    const r = await funcViaProxy(supa.ref, supa.secret, '', {}, 85_000);
    let j: { ok?: boolean; handled?: number; lastError?: string; error?: string } | null = null;
    try {
      j = JSON.parse(r.text) as typeof j;
    } catch {
      /* 非 JSON */
    }
    if (r.ok && j?.ok) {
      // v4：微信逐条回复失败不再静默（LLM 配置无效/网络不通等）——ping 里直接看到原因
      const warn = j.wxMsgError ? `；注意：最近一条微信回复失败——${String(j.wxMsgError).slice(0, 100)}（多为云端访问不了你的模型 API：核对 设置 → API 配置 的地址是否公网可达，改完重新同步运行包）` : '';
      const res = { ok: true, msg: `云端正常：本轮收发处理 ${j.handled ?? 0} 条消息（单轮收发，零轮询消耗）${warn}` };
      useWxCloud.getState().setLastPing(res);
      return res;
    }
    if (r.status === 401) {
      const res = { ok: false, msg: '密钥不匹配：请重新点「一键部署」升级到最新版函数' };
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

/** 云端心跳（state/heartbeat.json，函数每轮收发后写入）：设置页「云端轮询」开关的心跳监测用。
 *  返回 null = 通道不可用/文件不存在（未部署/旧版函数无中继读）；调用方自己组织文案。 */
export interface CloudHeartbeat {
  lastRunAt?: number;
  ok?: boolean;
  handled?: number;
  lastError?: string;
  source?: string;
  wxMsgError?: string;
  wxMsgErrorAt?: number;
}
export async function fetchCloudHeartbeat(ref: string): Promise<CloudHeartbeat | null> {
  try {
    return await readBucketJsonViaRelay<CloudHeartbeat>(ref, 'state/heartbeat.json');
  } catch {
    return null;
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
