'use client';

/**
 * QQ 官方机器人接入（q.qq.com 平台）——凭证存储 + 测试连接 + 角色绑定 + 官方扫码绑定 · v6。
 *
 * v6（官方扫码连接）：接入页「扫码连接」改为 q.qq.com 官方扫码绑定协议（与官方
 * @tencent-connect 系列插件同源）：本页生成二维码 → 用户手机 QQ 扫码 → 在 QQ 里选择
 * 自己创建的机器人确认绑定 → 凭证（AppID/AppSecret，AES-256-GCM 加密回传）自动到手并
 * 接入——全程不碰 bots.qq.com 的 token 验证口（海外 IP 被 503 拦的老问题彻底绕开）。
 * 手动「填写凭证」保留（q.qq.com 控制台复制 AppID/AppSecret 填入）。
 *
 * v5：双入口（扫凭证二维码 / 手动填写）——「扫凭证二维码」降级为填写页的辅助入口。
 * 接入前置条件：必须先部署云端助手（未部署时接入页阻断）——QQ 收发消息走云端 Webhook。
 *
 * 收发通道：QQ 官方已停止维护 WebSocket，走 Webhook——云端助手（部署到用户自己的
 * Supabase Edge Function / HF / ClawCloud 容器）接收 QQ 回调并代答（见 wx-cloud/sources）。
 * 手机 App 侧通过「拉取云端聊天记录」把 QQ 上的聊天同步进 QQ 聊天界面。
 *
 * 网络现实（v7 勘误）：官方现行取凭证端点 api.bot.qq.com/app/getAppAccessToken 对海外 IP 放行
 * （旧端点 bots.qq.com/api/v1/* 网关层拦海外 503，已降级为兜底）。测试连接双路兜底：先浏览器
 * 直连（新端点 → 旧端点），失败再走 /api/qq-bot 代理（同样双端点降级）；两路都不通时凭证仍可
 * 保存（网络不通 ≠ 凭证错误），部署云端后由云端验证（云端也走新端点）。
 *
 * 云端验证（v3 修复）：verifyViaCloud 改走 /api/cloud-deploy/supabase 的 func-call 同源
 * 代理——存量旧版函数没带 CORS 头，浏览器直连函数 URL（X-Task-Secret 自定义头）会先发
 * OPTIONS 预检被拒 → TypeError: Failed to fetch（「连不上云端助手」的根因）；服务端转发
 * 无 CORS，存量部署立即修复，新版函数自带 CORS 双保险。
 *
 * 持久化：kv 'qq-bot-login'（AES-GCM 密文，同 music-login-qq 模式）。
 *
 * 接入/换绑/断开后自动重推运行包到云端（cloudAutoSync，已部署过才推；动态 import 避免循环依赖）。
 */

import { create } from 'zustand';
import { ensureKvReady, kvGet, kvSet, kvDel } from './idb-kv';
import { decryptSecret, encryptSecret, isEncrypted } from './secret-box';
import { loadMsgs, saveMsgs } from '@/components/apps/qq-app/core';
import { wxCloudSnapshot } from './wx-cloud/store';

/** 接入/换绑/断开后自动重推运行包到云端（已部署过才推；动态 import 避免与 wx-cloud/supabase 的循环依赖） */
function cloudAutoSync(reason: string): void {
  void import('./wx-cloud/supabase')
    .then((m) => m.autoSyncRunPackageIfDeployed(reason))
    .catch(() => undefined);
}

// ---------------- 类型 ----------------

export interface QqBotLogin {
  appId: string;
  appSecret: string;
  /** 测试通过时拉到的机器人资料（可能没有） */
  botName?: string;
  botId?: string;
  /** 绑定的联系人（AI 角色）id：QQ 机器人在 QQ 里就是 TA */
  boundContactId?: string;
  boundContactName?: string;
  connectedAt: number;
}

export interface QqBotTestResult {
  ok: boolean;
  msg: string;
}

/** QQ 官方扫码绑定会话状态（v6：页面生成二维码 → 手机 QQ 扫码 → 选机器人确认即接入） */
export type QqQrPhase = 'idle' | 'starting' | 'waiting' | 'saving' | 'failed';

export interface QqQrBindState {
  phase: QqQrPhase;
  /** 二维码内容（qrcode 库渲染成图） */
  qrUrl?: string;
  reason?: string;
  /** 绑定确认的用户 openid（展示用） */
  userOpenid?: string;
}

// ---------------- 持久化 ----------------

const LOGIN_KEY = 'qq-bot-login';

let memQqBot: QqBotLogin | null = null;
let qqBotReady = false;

/** 同步读凭证（boot 后有效） */
export function qqBotLoginSnapshot(): QqBotLogin | null {
  return memQqBot;
}

async function persistLogin(v: QqBotLogin | null): Promise<void> {
  try {
    if (v) {
      const cipher = await encryptSecret(JSON.stringify(v));
      kvSet(LOGIN_KEY, cipher);
    } else {
      await kvDel(LOGIN_KEY);
    }
  } catch {
    /* secret-box 内部有降级 */
  }
}

// ---------------- 扫码识别（jsQR：二维码图片 → AppID/AppSecret） ----------------

/**
 * 解析二维码文本 → 凭证。三种支持格式：
 * ① AppID:AppSecret（自定义分隔符「:」「|」「空格」）
 * ② JSON（{"appId":…,"appSecret":…} / appid / clientSecret 等常见键名）
 * ③ 网址查询串（?appId=…&appSecret=… 任意顺序）
 */
export function parseQqQrText(raw: string): { appId: string; appSecret: string } | null {
  const t = raw.trim();
  if (!t) return null;
  // 形态一：AppID:AppSecret（自定义分隔符「:」「|」「空格」）
  const m = t.match(/^([a-zA-Z0-9]{4,64})[:|\s]+([a-zA-Z0-9!@#$%^&*_\-+=]{8,200})$/);
  if (m) return { appId: m[1], appSecret: m[2] };
  // 形态二：JSON
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      const appId = typeof j.appId === 'string' ? j.appId : typeof j.appid === 'string' ? j.appid : '';
      const appSecret =
        typeof j.appSecret === 'string'
          ? j.appSecret
          : typeof j.appsecret === 'string'
          ? j.appsecret
          : typeof j.clientSecret === 'string'
          ? j.clientSecret
          : '';
      if (appId && appSecret) return { appId, appSecret };
    } catch {
      /* 继续 */
    }
  }
  // 形态三：URL 查询串
  const q = t.match(/[?&](appId|appid)=([^&]+)(?:&|.*?&)(appSecret|appsecret|clientSecret|client_secret|secret)=([^&]+)/);
  if (q) return { appId: q[2], appSecret: q[4] };
  const q2 = t.match(/[?&](appSecret|appsecret|clientSecret|client_secret|secret)=([^&]+)(?:&|.*?&)(appId|appid)=([^&]+)/);
  if (q2) return { appId: q2[4], appSecret: q2[2] };
  return null;
}

/** 解析二维码图片 → 凭证（jsQR 解码后走 parseQqQrText）：拍照或选图均可 */
export async function parseQqQrImage(file: File): Promise<{ appId: string; appSecret: string } | null> {
  const { default: jsQR } = await import('jsqr');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const res = jsQR(data.data, canvas.width, canvas.height);
  bitmap.close?.();
  if (!res || !res.data) return null;
  return parseQqQrText(res.data);
}

// ---------------- QQ 官方扫码绑定（q.qq.com/lite，v6） ----------------

/**
 * QQ 官方「扫码连接」协议（与官方 @tencent-connect 系列插件同源）：
 * ① POST https://q.qq.com/lite/create_bind_task {key: <base64 AES-256 key>} → {retcode:0, data:{task_id}}
 * ② 二维码内容 = https://q.qq.com/qqbot/openclaw/connect.html?task_id=…&_wv=2
 *    （手机 QQ 扫码 → 打开连接页 → 选择你创建的机器人 → 确认绑定）
 * ③ POST https://q.qq.com/lite/poll_bind_result {task_id} →
 *    {status: 0 none / 1 pending / 2 completed / 3 expired； bot_appid； bot_encrypt_secret； user_openid}
 * ④ completed 时 bot_encrypt_secret = base64(AES-256-GCM(AppSecret， nonce=前12B， tag=后16B))，
 *    用 ① 生成的 key 解密即得 AppSecret——全程不碰 bots.qq.com 的 token 验证口
 *    （海外 IP 被 503 拦的老问题彻底绕开）。
 * 网络双路：浏览器直连（用户本机网络，国内 IP 直达 q.qq.com）→ 失败走 /api/qq-bind 代理兑底。
 */

interface LiteBindResp {
  retcode: number;
  msg?: string;
  data?: { task_id?: string; status?: number; bot_appid?: string; bot_encrypt_secret?: string; user_openid?: string };
}

async function qqLiteDirect(path: string, body: Record<string, unknown>): Promise<LiteBindResp | null> {
  try {
    const res = await fetch(`https://q.qq.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as LiteBindResp | null;
  } catch {
    return null; // CORS 拦截 / 网络不通
  }
}

async function qqLiteViaProxy(path: string, body: Record<string, unknown>): Promise<LiteBindResp | null> {
  try {
    const res = await fetch('/api/qq-bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, ...body }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as LiteBindResp | null;
  } catch {
    return null;
  }
}

async function qqLiteCall(path: string, body: Record<string, unknown>): Promise<LiteBindResp | null> {
  return (await qqLiteDirect(path, body)) ?? (await qqLiteViaProxy(path, body));
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

/** 解密 bot_encrypt_secret（AES-256-GCM：nonce=前12B、tag=后16B）→ AppSecret */
async function decryptBotSecret(keyB64: string, encB64: string): Promise<string | null> {
  try {
    const rawKey = b64ToBytes(keyB64);
    const enc = b64ToBytes(encB64);
    if (rawKey.length !== 32 || enc.length < 29) return null;
    const nonce = enc.subarray(0, 12);
    const ctWithTag = enc.subarray(12);
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ctWithTag);
    return new TextDecoder().decode(out);
  } catch {
    return null;
  }
}

/** 绑定二维码内容（手机 QQ 扫码 → 选择你创建的机器人 → 确认绑定） */
export function qqBindConnectUrl(taskId: string): string {
  return `https://q.qq.com/qqbot/openclaw/connect.html?task_id=${encodeURIComponent(taskId)}&_wv=2`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 扫码绑定会话令牌：每次 start/stop 递增，旧轮询循环检测到令牌变化自动退出 */
let qrSession = 0;

// ---------------- 测试连接（双路：浏览器直连 → 服务端代理） ----------------

/** 官方现行取凭证端点（2026-09 文档：海外出口可达；旧端点 /api/v1/* 网关层拦海外 IP 503） */
const QQ_TOKEN_ENDPOINTS = ['https://api.bot.qq.com/app/getAppAccessToken', 'https://bots.qq.com/api/v1/getAppAccessToken'];

async function qqTokenDirect(appId: string, appSecret: string): Promise<string | null> {
  for (const endpoint of QQ_TOKEN_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, clientSecret: appSecret }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue; // 旧端点网关 503 → 换下一端点
      const j = (await res.json().catch(() => null)) as { access_token?: string } | null;
      if (j?.access_token) return j.access_token;
      // 业务错误（HTTP 200 + code，如 100016 凭证不对）：继续下一端点无意义，直接返回 null
      return null;
    } catch {
      // CORS 拦截 / 网络不通 → 换下一端点
    }
  }
  return null;
}

async function qqTokenViaProxy(appId: string, appSecret: string): Promise<string> {
  const res = await fetch('/api/qq-bot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'token', appId, appSecret }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`QQ 平台响应异常（${res.status}）`);
  }
  const rec = j as { access_token?: string; message?: string; error?: string; code?: number };
  if (!res.ok || !rec.access_token) {
    // 官方错误码表（业务错误 HTTP 仍 200 + code）：转成可读提示
    if (rec.code === 100016) throw new Error('AppID 或 AppSecret 不正确（QQ 平台错误码 100016）：请到 q.qq.com 控制台核对凭证');
    if (rec.code === 100007) throw new Error('AppID 无效或机器人状态异常（QQ 平台错误码 100007）');
    if (rec.code === 10004) throw new Error('AppID 对应的机器人不存在（QQ 平台错误码 10004）');
    if (rec.code === 100001) throw new Error('QQ 平台频控（100001）：请求过于频繁，稍后再试');
    if (res.status === 503) throw new Error('QQ 平台拒绝了服务器的出口 IP（503）：请稍后重试');
    throw new Error(rec.message || rec.error || `QQ 平台返回 ${res.status}`);
  }
  return rec.access_token;
}

/** 用 access_token 拉机器人资料（直连失败走代理；拿不到不算失败） */
async function qqBotMe(accessToken: string): Promise<{ id?: string; username?: string; nickname?: string } | null> {
  const tryFetch = async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as { id?: string; username?: string; nickname?: string } | null;
  };
  const auth = { Authorization: `QQBot ${accessToken}` };
  const direct = await tryFetch('https://api.sgroup.qq.com/users/@me', auth).catch(() => null);
  if (direct) return direct;
  try {
    const res = await fetch('/api/qq-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'me', accessToken }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as { id?: string; username?: string; nickname?: string } | null;
  } catch {
    return null;
  }
}

// ---------------- 云端 QQ 聊天记录拉取（合并进 QQ 聊天界面） ----------------

/** 云端 qq-history.json 条目（wx-cloud/sources 的 QQ Webhook 处理器写入） */
export interface QqCloudMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  ts: number;
}

/**
 * 从用户自己的 Supabase 私有桶拉取 qq-history.json，合并进绑定联系人的 QQ 聊天线程。
 * 返回 {ok, msg, added?}。前提：设置 → 云端助手 已完成 Supabase 连接（serviceKey 可用）。
 */
export async function pullQqCloudHistory(): Promise<{ ok: boolean; msg: string; added?: number }> {
  const cloud = wxCloudSnapshot();
  const supa = cloud.supabase;
  const login = memQqBot;
  if (!login) return { ok: false, msg: '还没接入 QQ 机器人' };
  if (!login.boundContactId) return { ok: false, msg: '还没绑定角色：请先选择一个 AI 角色' };
  if (!supa?.ref || !supa.serviceKey) return { ok: false, msg: '云端未就绪：请先到 设置 → 云端助手 完成部署' };
  try {
    // 按类型区分（官方文档）：新式 sb_secret_/sb_publishable_ key 不是 JWT，只能放
    // apikey 头——放 Bearer 会被 Storage 当 JWT 解析报 400 Invalid Compact JWS；eyJ 双带
    const k = supa.serviceKey;
    const isNewStyle = k.startsWith('sb_secret_') || k.startsWith('sb_publishable_');
    const res = await fetch(`https://${supa.ref}.supabase.co/storage/v1/object/wx-cloud/qq-history.json`, {
      headers: isNewStyle ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, msg: '云端还没有 QQ 聊天记录（在 QQ 上和 TA 聊过之后才有）' };
    const j = (await res.json()) as { msgs?: QqCloudMsg[] };
    const list = Array.isArray(j.msgs) ? j.msgs : [];
    const cur = loadMsgs(login.boundContactId);
    const seen = new Set(cur.map((m) => m.id));
    const add = list
      .filter((m) => m && typeof m.id === 'string' && !seen.has(m.id))
      .map((m) => ({ id: m.id, role: m.role, content: String(m.content ?? '').slice(0, 2000), time: m.ts || Date.now() }));
    if (add.length) {
      saveMsgs(login.boundContactId, [...cur, ...add]);
      window.dispatchEvent(new CustomEvent('chat-stream-sysline', { detail: { sessionKey: `qq:${login.boundContactId}` } }));
    }
    return { ok: true, msg: add.length ? `已同步 ${add.length} 条 QQ 聊天记录` : '云端暂无新记录', added: add.length };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------- Store ----------------

interface QqConnectStore {
  ready: boolean;
  login: QqBotLogin | null;
  testing: boolean;
  lastTest: QqBotTestResult | null;
  /** 云端记录拉取状态 */
  pulling: boolean;
  /** 云端验证凭证进行中（verifyViaCloud 的防重入闸） */
  verifying: boolean;
  /** 官方扫码绑定会话（v6） */
  qr: QqQrBindState;

  boot: () => Promise<void>;
  /** 测试连接（成功即保存凭证） */
  test: (appId: string, appSecret: string) => Promise<QqBotTestResult>;
  /** 云端验证凭证：走 func-call 同源代理（v3：存量无 CORS 旧函数也能用） */
  verifyViaCloud: () => Promise<QqBotTestResult>;
  /** 绑定角色（QQ 机器人在 QQ 里就是这个角色） */
  bindContact: (contactId: string, contactName: string) => Promise<void>;
  disconnect: () => Promise<void>;
  pullHistory: () => Promise<void>;
  /** 官方扫码绑定：生成二维码并轮询，用户手机 QQ 确认后自动接入 */
  startQrBind: () => Promise<void>;
  /** 停止扫码绑定轮询（切 tab / 离开页面 / 用户手动取消） */
  stopQrBind: () => void;
}

export const useQqConnect = create<QqConnectStore>((set, get) => ({
  ready: false,
  login: null,
  testing: false,
  lastTest: null,
  pulling: false,
  verifying: false,
  qr: { phase: 'idle' },

  boot: async () => {
    if (qqBotReady) return;
    qqBotReady = true;
    try {
      await ensureKvReady();
      const raw = kvGet<string>(LOGIN_KEY);
      if (raw) {
        const plain = isEncrypted(raw) ? await decryptSecret(raw) : raw;
        const v = JSON.parse(plain) as QqBotLogin;
        memQqBot = v && v.appId ? v : null;
      }
      set({ login: memQqBot, ready: true });
    } catch {
      set({ ready: true });
    }
  },

  test: async (appId, appSecret) => {
    const id = appId.trim();
    const secret = appSecret.trim();
    if (!/^[a-zA-Z0-9]{4,64}$/.test(id)) {
      const r = { ok: false, msg: 'AppID 格式不对（应为数字/字母组合，在 q.qq.com 控制台获取）' };
      set({ lastTest: r });
      return r;
    }
    if (!secret || secret.length < 8) {
      const r = { ok: false, msg: 'AppSecret 不能为空（在 q.qq.com 控制台获取）' };
      set({ lastTest: r });
      return r;
    }
    set({ testing: true });
    try {
      let token = await qqTokenDirect(id, secret);
      if (!token) {
        try {
          token = await qqTokenViaProxy(id, secret);
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          // 新端点（api.bot.qq.com）海外可达：两路都失败多半是业务错（凭证不对）或纯网络问题
          const isBiz = /100016|100007|10004|不正确|不存在|无效/.test(reason);
          const r: QqBotTestResult = isBiz
            ? { ok: false, msg: `连不上 QQ 平台（${reason.slice(0, 100)}）：请到 q.qq.com 控制台核对 AppID/AppSecret 后重试。` }
            : {
                ok: false,
                msg: `两路都连不上 QQ 机器人平台（${reason.slice(0, 80)}）。凭证已保存；部署云端助手后，到本页点「云端验证」也可确认凭证真伪。`,
              };
          // 网络不通 ≠ 凭证错误：保存凭证但不标记成功
          const saved: QqBotLogin = { ...(memQqBot ?? { connectedAt: Date.now() }), appId: id, appSecret: secret, connectedAt: Date.now() };
          memQqBot = saved;
          await persistLogin(saved);
          set({ testing: false, lastTest: r, login: saved });
          cloudAutoSync('QQ 凭证已保存');
          return r;
        }
      }
      const me = token ? await qqBotMe(token) : null;
      const saved: QqBotLogin = {
        ...(memQqBot ?? {}),
        appId: id,
        appSecret: secret,
        botName: me?.username || me?.nickname || memQqBot?.botName || undefined,
        botId: me?.id || memQqBot?.botId || undefined,
        connectedAt: Date.now(),
      };
      memQqBot = saved;
      await persistLogin(saved);
      const r: QqBotTestResult = {
        ok: true,
        msg: saved.botName ? `连接成功：机器人「${saved.botName}」凭证有效` : '连接成功，凭证有效',
      };
      set({ testing: false, lastTest: r, login: saved });
      cloudAutoSync('QQ 接入成功');
      return r;
    } catch (e) {
      const r: QqBotTestResult = { ok: false, msg: e instanceof Error ? e.message : String(e) };
      set({ testing: false, lastTest: r });
      return r;
    }
  },

  /**
   * 云端验证凭证：bots.qq.com 的 token 验证口拦海外 IP（浏览器直连与 /api 代理都拿不到
   * 真伪），交给云端助手 verify-qq 动作代验。
   * v3：改走 /api/cloud-deploy/supabase 的 func-call 同源代理转发——存量已部署的旧版函数
   * 没有 CORS 头，此前浏览器直连函数 URL（带 X-Task-Secret 自定义头）会先发 OPTIONS 预检
   * 被拒 → TypeError: Failed to fetch（「连不上云端助手：请检查网络后重试」的根因）；
   * 服务端到服务端转发无 CORS 限制，存量部署立即修复，无需重新部署。
   * 回包 {ok, error, botName}：成功合并 botName 进凭证持久化（同 test 动作），失败用云端
   * 给出的 error（云端能拿到 QQ 平台的真实报错）截 120 字展示。
   */
  verifyViaCloud: async () => {
    const login = memQqBot;
    if (!login) {
      const r: QqBotTestResult = { ok: false, msg: '还没接入 QQ 机器人' };
      set({ lastTest: r });
      return r;
    }
    const supa = wxCloudSnapshot().supabase;
    if (!supa?.ref || !supa.deployedAt) {
      const r: QqBotTestResult = { ok: false, msg: '云端还没部署：先到 设置 → 云端助手 完成部署' };
      set({ lastTest: r });
      return r;
    }
    if (get().verifying) return { ok: false, msg: '正在验证中，请稍候' };
    set({ verifying: true });
    try {
      // 同源代理转发（服务端无 CORS 限制；旧版无 CORS 头的函数也能调）
      const res = await fetch('/api/cloud-deploy/supabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'func-call',
          ref: supa.ref,
          secret: supa.secret,
          action: 'verify-qq',
          body: { appId: login.appId, appSecret: login.appSecret },
        }),
        signal: AbortSignal.timeout(80_000),
      });
      const text = await res.text();
      let j: { ok?: boolean; error?: string; message?: string; botName?: string } | null = null;
      try {
        j = JSON.parse(text);
      } catch {
        /* 非 JSON */
      }
      if (res.ok && j?.ok) {
        const next: QqBotLogin = { ...login, botName: j.botName || login.botName || undefined };
        memQqBot = next;
        await persistLogin(next);
        const r: QqBotTestResult = {
          ok: true,
          msg: `云端验证通过${j.botName ? `：机器人「${j.botName}」` : ''}，凭证有效`,
        };
        set({ lastTest: r, login: next });
        cloudAutoSync('QQ 云端验证通过');
        return r;
      }
      if (res.status === 401) {
        const r: QqBotTestResult = { ok: false, msg: '任务密钥不匹配：到 设置 → 云端助手 重新点「一键部署」后再试' };
        set({ lastTest: r });
        return r;
      }
      if (res.status === 504) {
        const r: QqBotTestResult = { ok: false, msg: '连不上云端函数：请确认已一键部署（刚部署需 10-30 秒冷启动，稍等再试）' };
        set({ lastTest: r });
        return r;
      }
      const fallback = text ? `云端返回 ${res.status}：${text.slice(0, 60)}` : `云端返回 ${res.status}（云端助手可能还没更新到支持 verify-qq 的版本）`;
      const r: QqBotTestResult = { ok: false, msg: (j?.error || j?.message || fallback).slice(0, 120) };
      set({ lastTest: r });
      return r;
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
      const detail = e instanceof Error ? e.message : String(e);
      const r: QqBotTestResult = timedOut
        ? { ok: false, msg: '云端验证超时（80 秒）：请重试；多次超时请到 设置 → 云端助手 重新部署最新版' }
        : { ok: false, msg: `连不上云端助手（${detail.slice(0, 80)}）：请稍后重试` };
      set({ lastTest: r });
      return r;
    } finally {
      set({ verifying: false });
    }
  },

  bindContact: async (contactId, contactName) => {
    const login = get().login;
    if (!login) return;
    const next: QqBotLogin = { ...login, boundContactId: contactId, boundContactName: contactName };
    memQqBot = next;
    await persistLogin(next);
    set({ login: next });
    // 换绑后云端人设同步更新
    cloudAutoSync('QQ 换绑角色');
  },

  disconnect: async () => {
    memQqBot = null;
    await persistLogin(null);
    set({ login: null, lastTest: null });
    // 断开后自动重推（云端立即停用 QQ 通道）
    cloudAutoSync('QQ 已断开');
  },

  pullHistory: async () => {
    if (get().pulling) return;
    set({ pulling: true });
    const r = await pullQqCloudHistory();
    set({ pulling: false, lastTest: r.ok ? { ok: true, msg: r.msg } : get().lastTest });
  },

  /**
   * 官方扫码绑定：创建任务（二维码 URL）→ 2.5s 轮询 → 用户手机 QQ 确认后解密凭证 →
   * 自动 test() 接入（503 地域拦时 test 内部已兜底保存凭证，提示走云端验证）。
   * 二维码过期自动重建任务刷新；start/stop 用会话令牌互斥，旧循环自动退出。
   */
  startQrBind: async () => {
    const my = ++qrSession;
    set({ qr: { phase: 'starting' } });
    while (qrSession === my) {
      // ① 生成 AES-256 key 并创建绑定任务
      const keyBuf = new Uint8Array(32);
      crypto.getRandomValues(keyBuf);
      const keyB64 = bytesToB64(keyBuf);
      const create = await qqLiteCall('/lite/create_bind_task', { key: keyB64 });
      const taskId = create?.data?.task_id;
      if (qrSession !== my) return;
      if (!taskId || create?.retcode !== 0) {
        set({ qr: { phase: 'failed', reason: create?.msg || '连不上 q.qq.com（创建绑定任务失败）：请稍后重试' } });
        return;
      }
      // ② 显示二维码，等待手机 QQ 扫码确认
      set({ qr: { phase: 'waiting', qrUrl: qqBindConnectUrl(taskId) } });
      let expired = false;
      while (qrSession === my) {
        await sleep(2500);
        if (qrSession !== my) return;
        const r = await qqLiteCall('/lite/poll_bind_result', { task_id: taskId });
        if (!r) continue; // 单次网络失败继续轮询
        const st = r.data?.status ?? 0;
        if (st === 3) {
          expired = true;
          break; // 过期 → 外层重建任务自动刷新二维码
        }
        if (st === 2) {
          // ③ 确认绑定：解密凭证并接入
          set({ qr: { phase: 'saving' } });
          const appId = String(r.data?.bot_appid ?? '');
          const enc = r.data?.bot_encrypt_secret ?? '';
          const appSecret = await decryptBotSecret(keyB64, enc);
          if (qrSession !== my) return;
          if (!appId || !appSecret) {
            set({ qr: { phase: 'failed', reason: '凭证解密失败：请点「重新生成二维码」重试' } });
            return;
          }
          const t = await useQqConnect.getState().test(appId, appSecret);
          if (qrSession !== my) return;
          if (t.ok) {
            set({ qr: { phase: 'idle' }, lastTest: { ok: true, msg: '扫码接入成功：机器人凭证已保存并验证' } });
            cloudAutoSync('QQ 扫码接入成功');
            return;
          }
          // test 报 503（地域拦）：凭证其实已保存（test 内部兜底），引导云端验证
          set({ qr: { phase: 'idle' }, lastTest: { ok: false, msg: t.msg } });
          return;
        }
        // st 0/1：继续等待
      }
      if (expired) continue; // 过期 → 自动重新生成二维码
    }
  },

  stopQrBind: () => {
    qrSession++;
    set({ qr: { phase: 'idle' } });
  },
}));
