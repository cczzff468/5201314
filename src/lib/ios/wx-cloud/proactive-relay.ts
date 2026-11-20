'use client';

/**
 * 主动消息真机跟随（v16，机主定调「主动发消息让他跟跟随网站里面设置的」）：
 * 网站的「主动发消息」引擎（ProactiveMsgWatcher：定时/事件/自主/提醒/焦虑关怀五类触发）
 * 每次给角色投递主动消息时——该角色恰好是「真机微信/QQ 已接入的绑定联系人」且云端
 * 已部署，就把同一份内容转发到真机微信/QQ，让真机上的 TA 跟着网站设置一起主动开口。
 *
 * 转发链路（两级，静默 best-effort，绝不阻塞站内投递）：
 * ① 本站内置 IM 网关（/api/im-gateway?XTransformPort=3100，op=send-active）：网关在线时
 *    用它转发——走本站服务器，零用户配额消耗；
 * ② 云端函数 send-active 动作（经 /api/cloud-deploy 代理同源转发）：仅在网关没跑且
 *    用户「云端轮询」开关开着时兜底（尊重「停用=零配额消耗」的语义——停用轮询后主动
 *    转发不再烧用户的函数配额）。
 *
 * 微信侧用最近会话上下文（state/wx-lastctx.json，24h 内）代发；QQ 侧走活跃消息接口
 * （state/qq-active.json 记的 openid；QQ 平台限每用户每月 4 条，超限该次转发报错，
 * 静默记日志不影响站内）。旧版 v15 的 QQ 早安/晚安定时器已删除——主动时机完全由
 * 网站里各角色的「主动发消息」设置决定。
 */

import { wxCloudSnapshot } from './store';
import { wxIlinkLoginSnapshot } from '../weixin-connect';
import { qqBotLoginSnapshot } from '../qq-connect';
// v22 云端健康断路器：熔断冷却期云端兑底转发直接跳过（免烧注定失败的请求）
import { cloudCooling } from './cloud-health';

/** 网关 HTTP 入口（经 Caddy 反代：浏览器同源 fetch，端口走 XTransformPort 查询参数） */
const GW_URL = '/api/im-gateway?XTransformPort=3100';

export interface RelayResult {
  ok: boolean;
  via: 'gateway' | 'cloud' | 'none';
  sent?: number;
  error?: string;
}

/** 该联系人是否是真机通道的绑定角色（= 真机上 TA 就是这个角色）+ 云端已部署 */
function relayTargetReady(app: 'wx' | 'qq', contactId: string): boolean {
  const st = wxCloudSnapshot();
  if (st.platform !== 'supabase' || !(st.supabase?.deployedAt ?? 0)) return false;
  if (!contactId) return false;
  if (app === 'wx') return wxIlinkLoginSnapshot()?.boundContactId === contactId;
  return qqBotLoginSnapshot()?.boundContactId === contactId;
}

/** ① 网关转发：op=send-active（网关在线时用；服务器侧零用户配额） */
async function relayViaGateway(app: 'wx' | 'qq', texts: string[]): Promise<RelayResult> {
  try {
    const r = await fetch(GW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'send-active', channel: app, texts }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) return { ok: false, via: 'gateway', error: 'HTTP ' + r.status };
    const j = (await r.json().catch(() => null)) as { ok?: boolean; sent?: number; error?: string } | null;
    if (!j || j.ok !== true) return { ok: false, via: 'gateway', error: (j && j.error) || '网关未运行' };
    return { ok: true, via: 'gateway', sent: j.sent };
  } catch (e) {
    return { ok: false, via: 'gateway', error: e instanceof Error ? e.message : String(e) };
  }
}

/** ② 云端函数转发：action=send-active（经 /api/cloud-deploy/supabase 同源代理）——
 *  仅云端轮询开着时兜底（停用=零配额语义）；v22 熔断冷却期直接跳过（云端也正在受限，
 *  烧请求注定失败——站内投递已保证，网关通道优先在上一步已试过） */
async function relayViaCloud(app: 'wx' | 'qq', texts: string[]): Promise<RelayResult> {
  const st = wxCloudSnapshot();
  const supa = st.supabase;
  if (!supa?.token || !supa.ref || !supa.secret) return { ok: false, via: 'cloud', error: '云端凭证不完整' };
  if (!(supa.cronOn ?? false)) return { ok: false, via: 'none', error: '云端轮询已停用（零配额消耗）——真机主动转发跳过' };
  if (cloudCooling()) return { ok: false, via: 'none', error: '云端写通道熔断中（15 分钟内不再尝试，网关优先）' };
  try {
    const res = await fetch('/api/cloud-deploy/supabase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'func-call', ref: supa.ref, secret: supa.secret, action: 'send-active', body: { channel: app, texts } }),
      signal: AbortSignal.timeout(45_000),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; sent?: number; error?: string; message?: string } | null;
    if (res.status === 200 && j && j.ok === true) return { ok: true, via: 'cloud', sent: j.sent };
    return { ok: false, via: 'cloud', error: (j && (j.error || j.message)) || 'HTTP ' + res.status };
  } catch (e) {
    return { ok: false, via: 'cloud', error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 站内主动消息 → 真机转发（deliverProactiveMsg 调用；fire-and-forget 静默 best-effort）。
 * 返回结果仅供日志/调试；失败不影响站内投递（站内的消息照常落库上屏）。
 */
export async function relayProactiveToRealDevice(app: 'wx' | 'qq', contactId: string, texts: string[]): Promise<RelayResult | null> {
  try {
    if (!texts.length || !relayTargetReady(app, contactId)) return null;
    const list = texts.map((t) => String(t).slice(0, 800));
    const gw = await relayViaGateway(app, list);
    if (gw.ok) {
      console.log('[proactive-relay] 真机' + (app === 'wx' ? '微信' : 'QQ') + '主动转发成功（网关）：' + list.length + ' 条');
      return gw;
    }
    // 网关没跑（或通道未接入）→ 云端函数兜底（云端轮询开着才有意义）
    const cl = await relayViaCloud(app, list);
    if (cl.ok) {
      console.log('[proactive-relay] 真机' + (app === 'wx' ? '微信' : 'QQ') + '主动转发成功（云端）：' + list.length + ' 条');
    } else if (cl.via === 'cloud') {
      console.warn('[proactive-relay] 真机主动转发失败：' + (cl.error || '').slice(0, 120));
    }
    return cl;
  } catch {
    /* 任何异常静默：站内投递已保证 */
    return null;
  }
}
