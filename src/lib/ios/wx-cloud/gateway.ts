'use client';

/**
 * 内置 IM 网关（本服务自带的 7×24 收发通道）——前端 API 层 · v7。
 *
 * 定位（彻底替换 v6 的「QQ 境内出口（腾讯云函数）」与「云端轮询 pg_cron」两条路）：
 * - 免费：服务就跑在本应用里，不需要用户注册任何第三方云、不填任何密钥；
 * - 免配置：QQ 走官方 WebSocket 长连接（q.qq.com「事件订阅」默认支持，出站连接，
 *   无需在控制台配置任何回调地址——Webhook 回调要求境内可达出口、Supabase 境外函数
 *   URL 被 QQ 平台拒收的坑彻底绕开）；微信 iLink 长轮询 7×24 自动回复；
 * - 配置中心不变：仍读用户自己的 Supabase 私有桶运行包（wx-cloud/config.json），
 *   手机 App 接入/换绑/改「API 设置」自动同步后，网关 60 秒内跟上；聊天历史回写
 *   Supabase——「拉取云端聊天记录」链路原样可用。
 *
 * 通信约定：浏览器一律走同源网关路径 /api/im-gateway?XTransformPort=3100（Caddy 转发到
 * mini-services/im-gateway，端口 3100）。
 */

import { wxCloudSnapshot, ensureTaskSecret } from './store';

// ---------------- 类型 ----------------

/** 网关状态（GET /api/im-gateway 回包） */
export interface ImGatewayStatus {
  running: boolean;
  startedAt?: number;
  ref?: string;
  /** v8：配置读写通道——relay=经云端函数中继（无项目密钥也能跑）/ direct=直连 Storage */
  mode?: 'relay' | 'direct';
  qq?: {
    state: 'disabled' | 'connecting' | 'ready' | 'error';
    sessionId?: string;
    botName?: string;
    lastSeq?: number;
    lastEventAt?: number;
    events?: number;
    reconnects?: number;
    lastError?: string;
  };
  wx?: { running?: boolean; lastRunAt?: number; lastError?: string; replied?: number };
}

export interface ImGatewayOpResult {
  ok: boolean;
  msg: string;
  /** 开启时顺手做了的事（如停用旧「云端轮询」）——UI 拼进提示 */
  note?: string;
}

const GATEWAY_URL = '/api/im-gateway?XTransformPort=3100';

/** 用户手动停过网关的标记（localStorage）：自动拉起（页面打开/掉线自愈）尊重用户选择，
 *  不追着重开；下次手动「开启」时清除。v10：以前只有页面内存 ref（关页就忘），这里落盘。 */
const GW_USER_OFF_KEY = 'im-gateway-user-off';

function gwUserOff(): boolean {
  try {
    return localStorage.getItem(GW_USER_OFF_KEY) === '1';
  } catch {
    return false;
  }
}
function setGwUserOff(v: boolean): void {
  try {
    if (v) localStorage.setItem(GW_USER_OFF_KEY, '1');
    else localStorage.removeItem(GW_USER_OFF_KEY);
  } catch {
    /* 隐私模式等忽略 */
  }
}

// ---------------- API ----------------

/** 查询网关状态（不抛错：连不上/未部署一律返回 null，由 UI 决定怎么展示） */
export async function fetchImGatewayStatus(): Promise<ImGatewayStatus | null> {
  try {
    const res = await fetch(GATEWAY_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as ImGatewayStatus;
  } catch {
    return null;
  }
}

/**
 * 开启网关（幂等：同项目已在跑则服务端直接返回「已在运行」）。
 * v9 定位：网关 = 免费加速器（本站在线时 QQ 长连接 + 微信秒回轮询）；云端 24 小时收发
 * 骨干由用户 Supabase 里的 pg_cron 定时任务承担（部署后自动建立），与本网关并发跑
 * 安全（v9 轮询锁 + 认领表，见 sources.ts）——不再「开网关就停定时任务」：定时任务是
 * 离开本站后唯一的收发通道，必须常开。
 * v8：鉴权凭证二选一——serviceKey（直连 Storage）或任务密钥（经云端函数 read-file / upload-file
 * 中继读写）。代写路径部署后 serviceKey 为空时，任务密钥中继是唯一可用通道，不能拿
 * 「还没部署」拦住网关（用户实测踩坑：部署成功了但网关静默开不起来，微信永远没人回）。
 */
export async function startImGateway(reason: string): Promise<ImGatewayOpResult> {
  const st = wxCloudSnapshot();
  const supa = st.supabase;
  if (!supa?.ref || !supa.projectUrl || (!supa.serviceKey && !supa.secret)) {
    return { ok: false, msg: '还没部署云端：先到 设置 → 云端助手 完成一键部署' };
  }
  setGwUserOff(false); // 手动开启后解除「用户关闭」标记，自动拉起恢复生效
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'start',
        supaUrl: supa.projectUrl,
        supaKey: supa.serviceKey || '',
        ref: supa.ref,
        // v8 中继参数：网关无项目密钥时经云端函数读写（任务密钥鉴权；没生成过就顺手生成）
        relayUrl: supa.projectUrl.replace(/\/+$/, '') + '/functions/v1/wx-assistant',
        relaySecret: supa.secret || ensureTaskSecret(),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; msg?: string } | null;
    if (!res.ok || !j?.ok) return { ok: false, msg: j?.msg || `网关启动失败（${res.status}）` };
    return { ok: true, msg: (reason ? reason + '：' : '') + (j.msg || '网关已开启') };
  } catch (e) {
    return { ok: false, msg: '连不上内置网关：' + (e instanceof Error ? e.message.slice(0, 80) : String(e)) };
  }
}

/** 停止网关（QQ 断开长连接、微信自动回复停——本机页面回复仍可用）。
 *  v10：标记用户手动关闭——页面打开/掉线自愈的自动拉起不再追着重开（重新手动开启即解除）。 */
export async function stopImGateway(): Promise<ImGatewayOpResult> {
  setGwUserOff(true);
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'stop' }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; msg?: string } | null;
    if (!res.ok || !j?.ok) return { ok: false, msg: j?.msg || `网关停止失败（${res.status}）` };
    return { ok: true, msg: j.msg || '自动在线已停止' };
  } catch (e) {
    return { ok: false, msg: '连不上内置网关：' + (e instanceof Error ? e.message.slice(0, 80) : String(e)) };
  }
}

/**
 * 「自动确保在线」：接入页/部署后自动调用——先查状态，没在跑才真正开启（幂等、
 * 不打扰已在运行的用户）。返回是否发起了开启（供 UI 提示一次性 toast）。
 * v8：serviceKey 为空（代写路径部署）也可开——中继模式只需要任务密钥。
 * v10：用户手动停止过的不再自动拉起（尊重用户选择；手动「开启」时解除标记）。
 */
export async function ensureImGatewayRunning(reason: string): Promise<ImGatewayOpResult | null> {
  if (gwUserOff()) return null;
  const st = wxCloudSnapshot();
  if (!st.supabase?.ref || !st.supabase.projectUrl || (!st.supabase.serviceKey && !st.supabase.secret)) return null;
  const cur = await fetchImGatewayStatus();
  if (cur?.running) return null;
  return startImGateway(reason);
}

/**
 * v10 通知网关重查 QQ 凭证（op=refresh）：手机 App 重推运行包（接入/换绑/自动补同步）
 * 后调用——网关里 QQ 通道处于「未接入（没凭证）」时立即重连，免去等它 30 秒的
 * 自查周期；已在线/连接中不动。静默尽力而为（失败不打扰）。
 */
export async function refreshImGateway(): Promise<void> {
  try {
    await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'refresh' }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* 静默：网关没跑/连不上都不影响主流程 */
  }
}
