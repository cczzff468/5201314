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

import { useSyncExternalStore } from 'react';

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
  /** v25：真机「正在输入」——网关收到真机用户消息、调 core 生成回复期间置位（通道级条目；
   *  网关侧 120 秒陈旧兜底后自动不再输出） */
  typing?: { wx?: ImGatewayTypingEntry; qq?: ImGatewayTypingEntry };
  /** v22：Supabase 写通道熔断状态（网关侧断路器真源——fetch 层拦 *.supabase.co 写请求：
   *  连续 3 次失败（402/429/5xx/网络错）→冷却 15 分钟，期间云端写全走本地、真机收发不受影响；
   *  halfopen=冷却到期的半开探测瞬间）。站内 ClawBox 通道状态行消费它 */
  supaWrite?: { state: 'ok' | 'cooling' | 'halfopen'; fails?: number; lastErr?: string; until?: number };
}

/** v25 真机「正在输入」条目：contactKey=网关侧对端标识（QQ：单聊 openid/群 id；微信：对端
 *  username——网关的 fetch 观察器从 iLink getconfig 请求体里取的 from_user_id）。真机历史是
 *  单线索扁平列表，站内按「绑定角色会话」做通道级命中，contactKey 仅参考（不参与站内匹配） */
export interface ImGatewayTypingEntry {
  contactKey: string;
  since: number;
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

/** 查询网关状态（不抛错：连不上/未部署一律返回 null，由 UI 决定怎么展示）。
 *  v25：拿到状态顺手更新真机 typing 快照（noteTypingFromStatus）——订阅方零额外请求。 */
export async function fetchImGatewayStatus(): Promise<ImGatewayStatus | null> {
  try {
    const res = await fetch(GATEWAY_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = (await res.json()) as ImGatewayStatus;
    noteTypingFromStatus(j);
    return j;
  } catch {
    return null;
  }
}

// ---------------- v25 真机 typing 快照（聊天页 / 会话列表共用，零额外轮询） ----------------

/** 模块级快照：true=该通道网关正在生成回复（「对方正在输入」）。喂它的只有既有的
 *  fetchImGatewayStatus 调用方——12s 的 cloud-history-sync 全局循环 + 聊天页打开真机
 *  会话期间的 4s 轮询；订阅方（聊天页指示器/会话列表副标题）自己不发请求。 */
let typingSnapshot: { wx: boolean; qq: boolean } = { wx: false, qq: false };
const typingListeners = new Set<() => void>();

/** 从网关状态更新快照（有变化才广播——轮询空转不打扰订阅方重渲染） */
function noteTypingFromStatus(st: ImGatewayStatus): void {
  const next = { wx: Boolean(st?.typing?.wx), qq: Boolean(st?.typing?.qq) };
  if (next.wx === typingSnapshot.wx && next.qq === typingSnapshot.qq) return;
  typingSnapshot = next;
  for (const fn of typingListeners) fn();
}

/** 某通道真机「正在输入」是否命中（网关收到真机用户消息、生成回复期间） */
export function gatewayTypingActive(channel: 'wx' | 'qq'): boolean {
  return typingSnapshot[channel];
}

/** 订阅 typing 快照变化（useSyncExternalStore 订阅源） */
export function subscribeGatewayTyping(cb: () => void): () => void {
  typingListeners.add(cb);
  return () => typingListeners.delete(cb);
}

/** 聊天页 / 会话列表共用 hook：真机某通道「对方正在输入…」（订阅快照，不发请求） */
export function useGatewayTyping(channel: 'wx' | 'qq'): boolean {
  return useSyncExternalStore(subscribeGatewayTyping, () => gatewayTypingActive(channel), () => false);
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

// ---------------- v21 网关本地聊天历史 ----------------

/** 网关本地历史条目（核心 appendQqHistory / saveWxHistory 逐条镜像落盘的形状） */
export interface GatewayLocalHistMsg {
  id?: string;
  role?: string;
  content?: string;
  ts?: number;
}

/**
 * v21 拉网关本地聊天历史（op=qq-history / wx-history）：网关在线期间真机微信/QQ 收发的
 * 每条记录都在本机文件里（核心逐条镜像落盘，与 Supabase Storage 无关）——Storage 被
 * 402/502 限制/项目暂停期间网站聊天界面照常显示；云端 Storage 只是镜像。
 * 连不上/网关没跑/没数据返回 null（调用方自己回退云端直读/中继）。
 */
export async function fetchGatewayLocalHistory(channel: 'qq' | 'wx'): Promise<GatewayLocalHistMsg[] | null> {
  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: channel + '-history' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean; msgs?: GatewayLocalHistMsg[] } | null;
    if (!j?.ok || !Array.isArray(j.msgs)) return null;
    return j.msgs;
  } catch {
    return null;
  }
}
