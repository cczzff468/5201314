/**
 * 内置 IM 网关（mini-service，端口 3100）—— QQ 官方 WebSocket 长连接 + 微信 iLink 7×24 自动回复。
 *
 * 为什么是它（v7 产品方向：免费 · 免部署 · 免配置）：
 * - QQ：q.qq.com 官方「事件订阅」两种模式之一是 WebSocket（不依赖公网服务器，出站长连接，
 *   连 api.bot.qq.com 网关）——彻底不需要在控制台配置任何回调地址（Webhook 模式才需要，
 *   且 Webhook 回调被 QQ 平台限制境内可达出口，Supabase 境外函数 URL 被拒是用户实测踩过的坑）。
 * - 微信：iLink Bot 通道是 getupdates 长轮询——网关 7×24 挂着循环，网页/浏览器关了 TA 也在线，
 *   聊天历史回写用户自己的 Supabase（手机 App「拉取云端聊天记录」原样可用）。
 * - 配置中心仍是用户自己的 Supabase 私有桶（wx-cloud/config.json 运行包）：手机 App 接入/
 *   换绑/改 API 设置后自动重推运行包，本网关 60 秒内跟上（loadConfig 缓存 60s）。
 *
 * 核心逻辑单一事实来源：src/lib/ios/wx-cloud/sources.ts 的 WX_CLOUD_CORE（与 Supabase Edge
 * Function / Node 容器共用同一份：LLM 人设回复、表情包/语音条、微信游标去重、QQ 历史回写；
 * v16：QQ 语音条标记强制发送 + 主动消息站内驱动（send-active）+ 生图下线）。
 * 启动时把 WX_CLOUD_CORE + 连接变量物化成 core.gen.N.mjs 动态 import（换连接 = 重新物化）。
 *
 * HTTP（经 Caddy 网关：浏览器 fetch /api/im-gateway?XTransformPort=3100）：
 * - POST {op:'start', supaUrl, supaKey, secret} → 启动（幂等：同 ref 已在跑则只刷新）
 * - POST {op:'stop'} → 停止（关 WS + 停微信循环）
 * - GET  → 状态 JSON（QQ WS 会话 / 微信循环 / 回复计数）
 */

import { writeFileSync, readdirSync, unlinkSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WX_CLOUD_CORE } from '../../src/lib/ios/wx-cloud/sources';

// ---------------- v13 本地 TTS（QQ 语音条零配置合成：z-ai SDK，wav） ----------------

/** z-ai 可用音色（不认识的音色名一律回 tongtong——运行包里存的是 OpenAI 音色名时也不报错） */
const ZAI_VOICES = ['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo'];
let zaiInstance: any | null = null;

/** 本地合成语音（POST /tts，OpenAI 兼容形状 {input, voice, speed}）→ wav 二进制。
 *  z-ai-web-dev-sdk 仅后端使用（本 mini-service 是后端）；SDK 缺失/合成失败返回 5xx，
 *  云端核心拿到非 200 自动降级纯文字（不炸收发主流程）——QQ 语音条零配置可用。
 *  v16：真机 QQ 语音条的主力通道（[语音:内容] 标记强制发送 + 对方要语音时直接升级）。 */
async function handleLocalTts(req: Request): Promise<Response> {
  let body: Record<string, any> = {};
  try {
    body = (await req.json()) as Record<string, any>;
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }
  const text = String(body.input || body.text || '').trim().slice(0, 1000);
  if (!text) return Response.json({ error: 'empty text' }, { status: 400 });
  const voiceRaw = String(body.voice || '').trim();
  const voice = ZAI_VOICES.includes(voiceRaw) ? voiceRaw : 'tongtong';
  const speedRaw = Number(body.speed);
  const speed = Number.isFinite(speedRaw) ? Math.min(2, Math.max(0.5, speedRaw)) : 1;
  try {
    if (!zaiInstance) {
      const mod: any = await import('z-ai-web-dev-sdk');
      const ZAI = mod.default ?? mod;
      zaiInstance = await ZAI.create();
    }
    const res = await zaiInstance.audio.tts.create({
      input: text,
      voice,
      speed,
      response_format: 'wav',
      stream: false,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length) return Response.json({ error: 'empty audio' }, { status: 502 });
    return new Response(buf, {
      headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(buf.length) },
    });
  } catch (e) {
    zaiInstance = null; // 失败重置单例（下汰重试）
    return Response.json({ error: 'tts failed: ' + String((e as Error)?.message || e).slice(0, 80) }, { status: 503 });
  }
}

// ---------------- 常量 ----------------

const PORT = 3100;
const QQ_GATEWAY_API = 'https://api.sgroup.qq.com/gateway';
/** C2C 单聊 + 群@ 消息（GROUP_AND_C2C_EVENT = 1<<25；官方事件文档 C2C_MESSAGE_CREATE 同位） */
const QQ_INTENTS = 1 << 25;
/** 已处理事件去重上限（QQ 平台可能重推同一条消息，msg_id+场景去重） */
const QQ_SEEN_MAX = 400;
// ---------------- 类型 ----------------

interface QqWsState {
  state: 'disabled' | 'connecting' | 'ready' | 'error';
  sessionId: string;
  botName: string;
  lastSeq: number;
  lastEventAt: number;
  events: number;
  reconnects: number;
  lastError: string;
  hbOk: boolean;
}

interface WxLoopState {
  lastRunAt: number;
  lastError: string;
  replied: number;
}

interface Runtime {
  gen: number;
  ref: string;
  startedAt: number;
  /** v8：配置读写通道（relay=云端函数中继 / direct=直连 Storage） */
  mode: 'relay' | 'direct';
  core: any;
  qq: QqWsState;
  wx: WxLoopState;
}

let rt: Runtime | null = null;

// ---------------- 核心物化（sources.ts 单一事实来源） ----------------

let coreGen = 0;
const CORE_PREFIX = 'core.gen.';

function pruneGenFiles(keep: number): void {
  try {
    const dir = fileURLToPath(new URL('./', import.meta.url));
    const files = readdirSync(dir)
      .filter((f) => f.startsWith(CORE_PREFIX) && f.endsWith('.mjs'))
      .sort()
      .slice(0, -keep);
    for (const f of files) {
      try {
        unlinkSync(fileURLToPath(new URL('./' + f, import.meta.url)));
      } catch {
        /* 并发删除忽略 */
      }
    }
  } catch {
    /* 目录读取失败忽略 */
  }
}

/** 把 WX_CLOUD_CORE + 连接变量物化成可 import 的模块（换连接重新物化，文件名递增做缓存失效）。
 *  v8：注入中继参数（RELAY_URL/RELAY_SECRET）——无用户项目密钥时配置读写改经云端函数。
 *  v13：注入 TTS_LOCAL_URL——网关本进程的本地语音合成端点（z-ai SDK wav），云端核心的
 *  QQ 语音条优先用它（用户不配 OpenAI 兼容 TTS 也能发语音）。
 *  v15：注入 IMG_LOCAL_URL——网关本进程的本地生图端点（z-ai 生图 + sharp 压 JPEG），
 *  云端核心的 [照片:描述] 标记优先用它（AI 发照片能力；网关在线时真机微信/QQ 都能收图）。 */
async function materializeCore(supaUrl: string, supaKey: string, relayUrl: string, relaySecret: string): Promise<any> {
  const n = ++coreGen;
  const code = [
    '// [im-gateway 生成] 单一事实来源：src/lib/ios/wx-cloud/sources.ts 的 WX_CLOUD_CORE；勿手改本文件',
    'var CODE_SOURCE = "im-gateway";',
    `var SUPA_URL_INJECT = ${JSON.stringify(supaUrl)};`,
    `var SUPA_KEY_INJECT = ${JSON.stringify(supaKey)};`,
    `var RELAY_URL_INJECT = ${JSON.stringify(relayUrl)};`,
    `var RELAY_SECRET_INJECT = ${JSON.stringify(relaySecret)};`,
    `var TTS_LOCAL_URL_INJECT = ${JSON.stringify('http://127.0.0.1:' + PORT + '/tts')};`,
    WX_CLOUD_CORE,
    'export { loadConfig, tick, tickFast, handleQqEvent, qqToken, writeHeartbeat, supaGetJson, supaPutJson, loadQqHistory, appendQqHistory, refreshQqWsLock, cloudSendActive };',
  ].join('\n');
  const path = fileURLToPath(new URL(`./${CORE_PREFIX}${n}.mjs`, import.meta.url));
  writeFileSync(path, code);
  pruneGenFiles(3);
  return import(path);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------- QQ WebSocket 客户端 ----------------

let ws: WebSocket | null = null;
let hbTimer: ReturnType<typeof setInterval> | null = null;
let hbInterval = 41250;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 2000;
let wantClose = false;
/** v9 QQ 连接锁续期器：QQ 在线期间每 15s 刷 state/qq-ws-lock.json——云端函数的
 *  cron-cycle 分支看到本锁新鲜就不另开第二条连接（同一账号两条连接会互踢会话） */
let qqLockTimer: ReturnType<typeof setInterval> | null = null;
/** v12 QQ 凭证看门狗：QQ 在线期间每 30s 重读运行包——手机 App 点了「断开连接」后
 *  运行包里 QQ 段被移除，但旧版长连接不拆（消息照收、照回/照崩），真机 QQ 上 TA
 *  一直「在线」。看门狗发现凭证没了就拆长连接（disableQqChannel），锁停刷、30s 后
 *  自动重查（网页重新接入 → 几十秒内自动点亮）。 */
let qqCfgTimer: ReturnType<typeof setInterval> | null = null;
/** 事件去重（t + msg id → 时间戳；QQ 平台对未确认事件可能重推） */
const qqSeen = new Map<string, number>();
/** v11 连接防抖：connectQq 全程在飞标记——网关启动 / refresh（凭证重推） / 30s 重试
 *  三路并发 connectQq 会同时开两条 WebSocket，QQ 平台互踢会话，杀成「永远正在连接」
 *  + 事件在两条连接间被重复投递（回复两三遍）。拿到凭证后几秒内点亮就靠它：只有
 *  一条连接在连，READY/心跳 ACK 一到立刻 ready。 */
let qqConnecting = false;

function qqState(): QqWsState {
  return rt ? rt.qq : { state: 'disabled', sessionId: '', botName: '', lastSeq: 0, lastEventAt: 0, events: 0, reconnects: 0, lastError: '', hbOk: false };
}

function stopHbTimer(): void {
  if (hbTimer) {
    clearInterval(hbTimer);
    hbTimer = null;
  }
}

function wsSend(obj: unknown): void {
  try {
    ws?.send(JSON.stringify(obj));
  } catch {
    /* 连接已关忽略 */
  }
}

function pruneSeen(): void {
  if (qqSeen.size > QQ_SEEN_MAX) {
    const entries = [...qqSeen.entries()].sort((a, b) => a[1] - b[1]);
    for (const [k] of entries.slice(0, qqSeen.size - QQ_SEEN_MAX)) qqSeen.delete(k);
  }
}

function scheduleReconnect(gen: number): void {
  if (!rt || rt.gen !== gen || wantClose) return;
  rt.qq.state = 'connecting';
  rt.qq.reconnects += 1;
  reconnectDelay = Math.min(Math.round(reconnectDelay * 1.6), 30000);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    void connectQq(gen);
  }, reconnectDelay);
}

async function connectQq(gen: number): Promise<void> {
  if (!rt || rt.gen !== gen || wantClose) return;
  // v11 并发防抖：一轮连接在飞（config→token→网关地址→WS 握手）就不再开第二条
  if (qqConnecting) return;
  // v11 僵尸连接防抖：上一条 socket 还活着/还在握手就不再开新的——旧版会直接把 ws 变量
  // 指到新 socket，旧 socket 依旧收事件但心跳发到死 socket 上，状态永远「connecting」
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  qqConnecting = true;
  try {
  const q = rt.qq;
  try {
    // 凭证来自用户 Supabase 运行包（loadConfig 60s 缓存；换绑/改密钥 60s 内跟上）
    const cfg = await rt.core.loadConfig(true);
    if (!cfg.qq || !cfg.qq.appId) {
      q.state = 'disabled';
      q.lastError = '';
      // v10：没凭证不是终态——手机 App 接入 QQ / 自动同步运行包后这里要自己亮起来。
      // 30 秒后再查一次（fetch 一次 config.json，重活轻）；旧版直接 return，接入后
      // 网关永远不知道，QQ 通道永远「正在连接」，用户实测踩坑。
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        void connectQq(gen);
      }, 30000);
      return;
    }
    q.state = 'connecting';
    const token = await rt.core.qqToken(cfg);
    // 取 WSS 网关地址（官方：GET /gateway，鉴权 QQBot <access_token>）；
    // v10 加超时：原来无超时，QQ 网关挂起时 connectQq 卡死 → QQ 通道永远 connecting
    const gwr = await fetch(QQ_GATEWAY_API, {
      headers: { Authorization: 'QQBot ' + token },
      signal: AbortSignal.timeout(20000),
    });
    if (!gwr.ok) {
      q.state = 'error';
      q.lastError = `QQ 网关地址获取失败 ${gwr.status}`;
      scheduleReconnect(gen);
      return;
    }
    const gwj = (await gwr.json().catch(() => null)) as { url?: string } | null;
    const wssUrl = gwj?.url;
    if (!wssUrl) {
      q.state = 'error';
      q.lastError = 'QQ 网关地址获取失败：回包无 url';
      scheduleReconnect(gen);
      return;
    }
    wantClose = false;
    ws = new WebSocket(wssUrl);
    // v14 握手看门狗：WS 握手挂在网络里（onopen/onclose 都不来）时旧版会永远停在
    // 「connecting」——状态卡死、不重试（onclose 也不会来）——「QQ 接入过一会断开」
    // 的根因之一。20s 内还没进入 ready 就强拆走重连（按 socket 打标，不误伤新一轮尝试）。
    const sock = ws;
    setTimeout(() => {
      if (!rt || rt.gen !== gen || wantClose) return;
      if (ws !== sock) return; // 已被新一轮尝试替换：不管旧连接
      if (rt.qq.state === 'connecting') {
        console.log('[im-gateway] QQ WS 握手看门狗触发（20s 未就绪）→ 强拆重连');
        try {
          ws?.close();
        } catch {
          /* 忽略 */
        }
        scheduleReconnect(gen);
      }
    }, 20000);
    ws.onmessage = (ev: MessageEvent) => {
      if (!rt || rt.gen !== gen || wantClose) return;
      try {
        void handleWsFrame(JSON.parse(String(ev.data)) as Record<string, any>, gen, token);
      } catch {
        /* 非 JSON 帧忽略 */
      }
    };
    ws.onclose = (ev: CloseEvent) => {
      stopHbTimer();
      console.log('[im-gateway] QQ WS close:', ev.code, ev.reason?.slice(0, 80), 'gen', gen);
      if (rt && rt.gen === gen && !wantClose) scheduleReconnect(gen);
    };
    ws.onerror = () => {
      /* onclose 兜底重连；这里只记状态 */
      if (rt && rt.gen === gen) rt.qq.state = rt.qq.sessionId ? 'connecting' : 'error';
    };
  } catch (e) {
    q.state = 'error';
    q.lastError = String((e as Error)?.message || e).slice(0, 160);
    scheduleReconnect(gen);
  }
  } finally {
    qqConnecting = false;
  }
}

async function handleWsFrame(f: Record<string, any>, gen: number, token: string): Promise<void> {
  if (!rt || rt.gen !== gen) return;
  const q = rt.qq;
  const op = Number(f.op);
  if (typeof f.s === 'number' && f.s > 0) q.lastSeq = f.s;

  if (op === 10) {
    // Hello：心跳周期 + 登录鉴权（有会话则 Resume 断点续传，官方补发遗漏事件）
    hbInterval = Number(f.d?.heartbeat_interval) || 41250;
    stopHbTimer();
    q.hbOk = true;
    hbTimer = setInterval(() => {
      if (!rt || rt.gen !== gen || wantClose || !ws || ws.readyState !== 1) {
        stopHbTimer();
        return;
      }
      // 上一轮心跳没收到 ACK → 连接僵死，断开走重连（Resume 续传）
      if (!q.hbOk) {
        try {
          ws.close();
        } catch {
          /* 忽略 */
        }
        return;
      }
      q.hbOk = false;
      wsSend({ op: 1, d: q.lastSeq || null });
    }, hbInterval);
    if (q.sessionId && q.lastSeq) {
      wsSend({ op: 6, d: { token: 'QQBot ' + token, session_id: q.sessionId, seq: q.lastSeq } });
    } else {
      wsSend({
        op: 2,
        d: {
          token: 'QQBot ' + token,
          intents: QQ_INTENTS,
          shard: [0, 1],
          properties: { $os: 'linux', $browser: 'im-gateway', $device: 'im-gateway' },
        },
      });
    }
    return;
  }
  if (op === 11) {
    q.hbOk = true;
    // 心跳 ACK 到达即代表会话已鉴权（Resume 后平台可能不发 RESUMED——心跳在线就是真在线）
    if (q.state === 'connecting') q.state = 'ready';
    return;
  }
  if (op === 7) {
    // 服务端要求重连：立即断开走 Resume
    console.log('[im-gateway] QQ WS op7 reconnect 指令');
    try {
      ws?.close();
    } catch {
      /* 忽略 */
    }
    return;
  }
  if (op === 9) {
    // Identify/Resume 参数错（会话失效等）：重置会话重新鉴权
    q.sessionId = '';
    q.state = 'connecting';
    q.lastError = 'QQ 平台返回会话无效（op9），重新鉴权中';
    console.log('[im-gateway] QQ WS op9 invalid session:', JSON.stringify(f.d || null).slice(0, 120));
    try {
      ws?.close();
    } catch {
      /* 忽略 */
    }
    return;
  }
  if (op === 0) {
    const t = String(f.t || '');
    if (t === 'READY') {
      q.state = 'ready';
      q.sessionId = String(f.d?.session_id || '');
      q.botName = String(f.d?.user?.username || f.d?.user?.nickname || '');
      q.lastError = '';
      reconnectDelay = 2000;
      console.log('[im-gateway] QQ WS READY:', q.botName, 'session', q.sessionId.slice(0, 8));
      return;
    }
    if (t === 'RESUMED') {
      q.state = 'ready';
      q.lastError = '';
      reconnectDelay = 2000;
      console.log('[im-gateway] QQ WS RESUMED: session', q.sessionId.slice(0, 8), 'seq', q.lastSeq);
      return;
    }
    if (t === 'C2C_MESSAGE_CREATE' || t === 'GROUP_AT_MESSAGE_CREATE') {
      q.lastEventAt = Date.now();
      q.events += 1;
      const d = f.d || {};
      console.log('[im-gateway] QQ event:', t, 'id=', String(d.id || '').slice(0, 18));
      const key = t + ':' + String(d.id || '');
      const seenAt = qqSeen.get(key);
      qqSeen.set(key, Date.now());
      pruneSeen();
      if (seenAt) return; // 平台重推的同一条消息：不重复回复
      // 消息代答复用云端核心（人设/表情包/语音条/历史回写 Supabase 全在内）；cfg 走 60s 缓存
      try {
        const cfg = await rt.core.loadConfig(false);
        const handled = await rt.core.handleQqEvent(cfg, t, d);
        console.log('[im-gateway] QQ 处理', handled ? '已回复' : '跳过（无内容）');
      } catch (e) {
        q.lastError = String((e as Error)?.message || e).slice(0, 160);
        console.log('[im-gateway] QQ 处理失败:', q.lastError);
      }
      return;
    }
    return; // 其它事件（好友添加等）忽略
  }
}

function stopQq(): void {
  wantClose = true;
  stopHbTimer();
  qqConnecting = false;
  if (qqLockTimer) {
    clearInterval(qqLockTimer);
    qqLockTimer = null;
  }
  if (qqCfgTimer) {
    clearInterval(qqCfgTimer);
    qqCfgTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    ws?.close();
  } catch {
    /* 忽略 */
  }
  ws = null;
}

/** v12 拆除 QQ 通道（凭证被移除 ≠ 停网关）：关长连接、清会话、置 disabled、停刷锁；
 *  30s 后自动重查凭证（网页重新接入 → 自动点亮）。微信轮询与网关本身不受影响。 */
function disableQqChannel(gen: number): void {
  if (!rt || rt.gen !== gen) return;
  const q = rt.qq;
  stopHbTimer();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  wantClose = true; // 停在飞帧/心跳；30s 后重查前复位
  try {
    ws?.close();
  } catch {
    /* 忽略 */
  }
  ws = null;
  q.sessionId = '';
  q.state = 'disabled';
  q.lastError = '';
  q.hbOk = false;
  reconnectDelay = 2000;
  console.log('[im-gateway] QQ 凭证已从运行包移除（网页断开）→ 长连接已拆除，TA 在真机 QQ 上下线');
  reconnectTimer = setTimeout(() => {
    if (!rt || rt.gen !== gen) return;
    wantClose = false;
    void connectQq(gen);
  }, 30000);
}

// ---------------- 微信长轮询循环 ----------------

async function wxLoop(gen: number): Promise<void> {
  let errs = 0;
  // v16：v15 的定时主动消息（早安/晚安）已按机主定调删除——主动消息改由站内「主动发消息」
  // 引擎驱动（deliverProactiveMsg → 网关 op=send-active → cloudSendActive），本循环只管收发
  while (rt && rt.gen === gen) {
    const wx = rt.wx;
    try {
      const n = (await rt.core.tick()) as number;
      errs = 0;
      wx.lastRunAt = Date.now();
      wx.lastError = '';
      if (n > 0) wx.replied += n;
      await rt.core.writeHeartbeat({ source: 'im-gateway' });
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      wx.lastError = msg.slice(0, 160);
      wx.lastRunAt = Date.now();
      if (msg.indexOf('TOKEN_EXPIRED') >= 0) {
        // 微信 Token 过期：等主人回手机 App 重新扫码（期间静默，5 分钟再探一次）
        await sleep(300000);
      } else if (msg.indexOf('未配置') >= 0 || msg.indexOf('运行包缺失') >= 0) {
        await sleep(60000);
      } else {
        errs++;
        await sleep(Math.min(5000 * errs, 30000));
      }
      continue;
    }
    // 正常周期：getupdates 服务端挂 ~35s；空闲（未接入微信）也 10s 一探，不热转
    await sleep(10000);
  }
}

// ---------------- v14 僵尸自愈看门狗 ----------------

/** 实测根因（用户反馈「QQ 接入过一会会断开 / AI 不回消息 / 断连」）：Bun 的 fetch 在
 *  中继长连接上偶发挂死——AbortSignal.timeout 不触发（Bun 已知坑），wxLoop 卡在 tick()
 *  里、connectQq 卡在取凭证/网关地址里：进程活着、HTTP 状态页活着，但收发全部停摆
 *  （状态页上 lastRunAt / reconnects 永远停在同一秒）。旧拉活机制全部失灵：keeper 只看
 *  端口、页面只看 running 标志、云端被连接锁挡住。
 *  看门狗：每 20s 检查一次活力——①微信循环 lastRunAt 冻结 >150s（正常 ≤60s 一轮；
 *  TOKEN_EXPIRED 的 5 分钟静默重探除外）；②QQ 长时间停在 connecting/error 且重试计数
 *  不再推进（健康重试每 ≤30s 必动）→ 判定僵尸 → process.exit(1)：im-keeper.sh 检测端口
 *  掉线秒级拉起 + gateway-state.json 启动自恢复 → 全量自愈（比永远僵尸强得多）。 */
let gwWatchTimer: ReturnType<typeof setInterval> | null = null;
let gwQqSig = '';
let gwQqSigAt = 0;

function startGwWatchdog(gen: number): void {
  if (gwWatchTimer) clearInterval(gwWatchTimer);
  gwQqSig = '';
  gwQqSigAt = Date.now();
  gwWatchTimer = setInterval(() => {
    if (!rt || rt.gen !== gen) {
      if (gwWatchTimer) clearInterval(gwWatchTimer);
      return;
    }
    // ① 微信循环冻结（含启动宽限 30s：lastRunAt=0 时不判）
    const wxStaleMs = Date.now() - rt.wx.lastRunAt;
    const tokenWait = /TOKEN_EXPIRED|Token 已过期/.test(rt.wx.lastError);
    if (rt.wx.lastRunAt > 0 && wxStaleMs > (tokenWait ? 400_000 : 150_000)) {
      console.log('[im-gateway] 僵尸自愈：微信循环冻结 ' + Math.round(wxStaleMs / 1000) + 's → 重启进程（keeper 拉起 + 自恢复）');
      process.exit(1);
    }
    // ② QQ 卡在 connecting/error 且不再推进（健康重试每 ≤30s 必动 reconnects/lastError）
    const qqSig = [rt.qq.state, rt.qq.reconnects, rt.qq.events, rt.qq.lastError, rt.qq.lastSeq].join('|');
    if (qqSig !== gwQqSig) {
      gwQqSig = qqSig;
      gwQqSigAt = Date.now();
    } else if (
      (rt.qq.state === 'connecting' || rt.qq.state === 'error') &&
      Date.now() - gwQqSigAt > 150_000
    ) {
      console.log('[im-gateway] 僵尸自愈：QQ 连接停摆 ' + rt.qq.state + ' 超过 150s → 重启进程（keeper 拉起 + 自恢复）');
      process.exit(1);
    }
  }, 20_000);
}

// ---------------- 生命周期 ----------------

function statusJson(): Record<string, unknown> {
  if (!rt) {
    return { running: false, qq: { state: 'disabled' }, wx: { running: false } };
  }
  return {
    running: true,
    startedAt: rt.startedAt,
    ref: rt.ref,
    mode: rt.mode,
    qq: { ...rt.qq, hbInterval },
    wx: { running: true, ...rt.wx },
  };
}

// ---------------- v8 自恢复：网关状态落盘（重启/热重载后自动拉起） ----------------

/** 落盘文件（只存中继参数——不含用户项目密钥，密钥仍只在浏览器）：服务重启后读它自动恢复在线。
 *  用户反馈「有时候会断连」的根因之一：网关状态在内存里，mini-service 重启（热重载/进程重启）
 *  就丢，没人打开页面就再也没人拉起，TA 静默下线直到主人发现。落盘 + 启动自恢复后不再依赖有人开着页面。 */
const STATE_FILE = 'gateway-state.json';

function stateFilePath(): string {
  return fileURLToPath(new URL('./' + STATE_FILE, import.meta.url));
}

interface PersistedState {
  v: 1;
  supaUrl: string;
  ref: string;
  relayUrl: string;
  relaySecret: string;
  savedAt: number;
}

function readPersistedState(): PersistedState | null {
  try {
    const raw = readFileSync(stateFilePath(), 'utf8');
    const j = JSON.parse(raw) as PersistedState;
    if (j && j.v === 1 && typeof j.relayUrl === 'string' && typeof j.relaySecret === 'string' && j.relaySecret) return j;
    return null;
  } catch {
    return null;
  }
}

function writePersistedState(s: PersistedState): void {
  try {
    writeFileSync(stateFilePath(), JSON.stringify(s));
  } catch {
    /* 落盘失败不影响本次运行 */
  }
}

function clearPersistedState(): void {
  try {
    unlinkSync(stateFilePath());
  } catch {
    /* 本就不存在 */
  }
}

/** 探测云端函数代际：ping 动作（所有版本都无害）带 ver>=8 才支持 read-file 中继 */
async function probeRelayCapability(relayUrl: string, relaySecret: string): Promise<{ ok: boolean; msg: string }> {
  try {
    const r = await fetch(relayUrl + '?action=ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Task-Secret': relaySecret },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; ver?: number } | null;
    if (r.status === 401) return { ok: false, msg: '任务密钥不匹配：请回手机 App 设置 → 云端助手 重新点「一键部署」升级函数' };
    if (!j || !j.ok) return { ok: false, msg: '云端函数不可达或未部署（HTTP ' + r.status + '）——请确认已完成一键部署' };
    if ((Number(j.ver) || 0) < 8) return { ok: false, msg: '云端函数是旧版（不带中继读能力）——请回手机 App 设置 → 云端助手 再点一次「一键部署」' };
    return { ok: true, msg: '' };
  } catch (e) {
    return { ok: false, msg: '连不上云端函数：' + String((e as Error)?.message || e).slice(0, 80) };
  }
}

async function startGateway(supaUrl: string, supaKey: string, ref: string, relayUrl: string, relaySecret: string): Promise<{ ok: boolean; msg: string }> {
  const url = String(supaUrl || '').replace(/\/+$/, '');
  const key = String(supaKey || '');
  const relay = String(relayUrl || '').replace(/\/+$/, '');
  const rsecret = String(relaySecret || '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) return { ok: false, msg: 'supaUrl 不是有效的 Supabase 项目地址' };
  if (rt && rt.ref === ref) return { ok: true, msg: '网关已在运行' };

  // v8 通道决策：优先中继（任务密钥随部署注入，永远有效；用户 Storage key 可能被轮换全拒），
  // 中继不可用时兑底直连密钥；两样都没有才报错。
  let mode: 'relay' | 'direct' = 'relay';
  if (rsecret && relay) {
    const probe = await probeRelayCapability(relay, rsecret);
    if (!probe.ok) {
      if (key.length >= 20) {
        mode = 'direct'; // 有直连密钥：降级直连，网关仍能跑
        console.log('[im-gateway] 中继不可用，降级直连：', probe.msg);
      } else {
        return { ok: false, msg: '网关无法读云端配置：' + probe.msg };
      }
    }
  } else if (key.length >= 20) {
    mode = 'direct';
  } else {
    return { ok: false, msg: '缺少云端凭证（任务密钥/项目密钥都没有）：请回手机 App 重新一键部署' };
  }

  // 换连接：先停旧会话再立新
  if (rt) await stopGateway();

  // 中继模式落盘（自恢复用；直连模式不落盘——密钥不该进磁盘）
  if (mode === 'relay') {
    writePersistedState({ v: 1, supaUrl: url, ref: ref || url.replace(/^https:\/\//, '').split('.')[0], relayUrl: relay, relaySecret: rsecret, savedAt: Date.now() });
  } else {
    clearPersistedState();
  }

  const core = await materializeCore(url, mode === 'relay' ? '' : key, mode === 'relay' ? relay : '', mode === 'relay' ? rsecret : '');
  // 启动自检：真实读一次运行包（密钥错/包缺失立刻报可读原因，不静默空转）
  try {
    await core.loadConfig(true);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    clearPersistedState();
    return { ok: false, msg: '读取云端运行包失败：' + msg.slice(0, 120) };
  }
  const gen = rt ? rt.gen + 1 : 1;
  rt = {
    gen,
    ref: ref || url.replace(/^https:\/\//, '').split('.')[0],
    startedAt: Date.now(),
    mode,
    core,
    qq: { state: 'connecting', sessionId: '', botName: '', lastSeq: 0, lastEventAt: 0, events: 0, reconnects: 0, lastError: '', hbOk: false },
    wx: { lastRunAt: 0, lastError: '', replied: 0 },
  };
  // qqSeen 跨连接保留无意义：清掉
  qqSeen.clear();
  wantClose = false;
  reconnectDelay = 2000;
  void wxLoop(gen);
  void connectQq(gen);
  // v14 僵尸自愈看门狗（fetch 挂死/循环停摆 → process.exit → keeper 拉起 + 自恢复）
  startGwWatchdog(gen);
  // v9：QQ 连接锁续期（每 15s）——QQ 在线期间云端函数 cron-cycle 看到新鲜锁就不另开
  // 第二条连接（本网关是“本站在线时”的 QQ 持有方；本网关不在线时锁自然过期，云端接手）。
  // v14：只有【真在线（ready）】才占锁——连接挂了（connecting/error）不再刷锁：旧版挂了
  // 也继续刷，40s 内云端骨干永远接不了手 → 网关进程活着但连接死了 = 真机 QQ 全员掉线
  // （「QQ 接入过一会会断开」的另一半根因）。现在连接一挂锁就过期，云端 cron-cycle
  // 接手收发，网关自愈重连成功后（拿回 ready）重新占锁、云端下一轮让位。
  if (qqLockTimer) clearInterval(qqLockTimer);
  qqLockTimer = setInterval(() => {
    if (!rt || rt.gen !== gen) {
      if (qqLockTimer) clearInterval(qqLockTimer);
      return;
    }
    if (rt.qq.state !== 'ready') return; // 没真在线不占锁（disabled 没人需要；connecting/error 让云端骨干接手）
    void rt.core.refreshQqWsLock('gw').catch(() => undefined);
  }, 15000);
  // v12 凭证看门狗（每 30s）：QQ 在线期间重读运行包——手机 App「断开连接」后凭证段
  // 被移除时拆长连接（真机 QQ 上 TA 下线）；网络读失败不打扰在线连接。
  if (qqCfgTimer) clearInterval(qqCfgTimer);
  qqCfgTimer = setInterval(() => {
    if (!rt || rt.gen !== gen) {
      if (qqCfgTimer) clearInterval(qqCfgTimer);
      return;
    }
    if (rt.qq.state === 'disabled') return; // disabled 分支自己的 30s 重查已覆盖
    void rt.core
      .loadConfig(true)
      .then((cfg: { qq?: { appId?: string } } | null) => {
        if (!rt || rt.gen !== gen) return;
        if (!cfg || !cfg.qq || !cfg.qq.appId) disableQqChannel(gen);
      })
      .catch(() => undefined);
  }, 30000);
  return { ok: true, msg: '网关已启动：QQ WebSocket 长连接 + 微信自动回复' + (mode === 'relay' ? '（云端函数中继通道）' : '') };
}

async function stopGateway(): Promise<{ ok: boolean; msg: string }> {
  if (!rt) {
    clearPersistedState();
    return { ok: true, msg: '网关本就未在运行' };
  }
  const cur = rt;
  rt = null;
  stopQq();
  if (gwWatchTimer) {
    clearInterval(gwWatchTimer);
    gwWatchTimer = null;
  }
  clearPersistedState(); // v8：自恢复状态一并清掉（重启后不再自动拉起）
  cur.gen = -1; // 让微信循环自然退出（下一轮 while 判定失败）
  return { ok: true, msg: '网关已停止（QQ 长连接已断开、微信自动回复已停）' };
}

// ---------------- HTTP 服务（Caddy 转发 /api/im-gateway?XTransformPort=3100） ----------------

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    // v13 本地 TTS 合成端点（云端核心 QQ 语音条用；仅本机/本进程访问，不经 Caddy 对外）
    if (url.pathname === '/tts' && req.method === 'POST') {
      return handleLocalTts(req);
    }
    if (url.pathname !== '/api/im-gateway') {
      return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    }
    if (req.method === 'GET') {
      return Response.json(statusJson());
    }
    if (req.method === 'POST') {
      let body: Record<string, any> = {};
      try {
        body = (await req.json()) as Record<string, any>;
      } catch {
        return Response.json({ ok: false, msg: '请求体不是 JSON' }, { status: 400 });
      }
      const op = String(body.op || '');
      if (op === 'start') {
        const r = await startGateway(
          String(body.supaUrl || ''),
          String(body.supaKey || ''),
          String(body.ref || ''),
          String(body.relayUrl || ''),
          String(body.relaySecret || ''),
        );
        return Response.json(r);
      }
      if (op === 'stop') {
        return Response.json(await stopGateway());
      }
      // v16 send-active（站内「主动发消息」引擎触发）：把站内已生成的主动内容发到真机
      // 微信/QQ（cloudSendActive：微信用最近会话上下文、QQ 用活跃消息接口——QQ 每月限 4 条）
      if (op === 'send-active') {
        if (!rt) return Response.json({ ok: false, error: '网关未在运行' }, { status: 200 });
        try {
          const cfg = await rt.core.loadConfig(false);
          const r = await rt.core.cloudSendActive(cfg, String(body.channel || ''), Array.isArray(body.texts) ? body.texts : []);
          return Response.json(r);
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 140) }, { status: 200 });
        }
      }
      // v10 refresh：手机 App 周期性重推运行包后，通知网关立即重查 QQ 凭证（只对
      // disabled 生效——已连接/连接中不动，防双连接）。免去等待 30s 重试周期。
      // v12：先复位 wantClose——disableQqChannel 拆连接后留着 true，connectQq 会
      // 直接早退（重新接入后永远点亮不了的坑）。
      if (op === 'refresh') {
        if (rt && rt.qq.state === 'disabled') {
          wantClose = false;
          void connectQq(rt.gen);
          return Response.json({ ok: true, msg: 'QQ 凭证待重查：已发起重连' });
        }
        return Response.json({ ok: true, msg: rt && rt.qq.state !== 'disabled' ? 'QQ 已在线，无需重连' : '网关未在运行' });
      }
      return Response.json({ ok: false, msg: '未知 op：' + (op || '(空)') }, { status: 400 });
    }
    return Response.json({ ok: false, msg: 'method ' + req.method }, { status: 405 });
  },
});

console.log('[im-gateway] listening on :3100 — QQ WebSocket + 微信 iLink 7x24');

// v8 启动自恢复：落盘状态存在（上次是在线状态）→ 自动拉起网关（中继模式；服务重启/
// 热重载/进程崩溃后不再静默掉线——「有时候会断连」的根因修复）。失败只记日志，等页面拉起兑底。
{
  const ps = readPersistedState();
  if (ps) {
    void startGateway(ps.supaUrl, '', ps.ref, ps.relayUrl, ps.relaySecret)
      .then((r) => console.log('[im-gateway] 自恢复：', r.ok ? '已恢复在线' : '失败 ' + r.msg))
      .catch((e) => console.log('[im-gateway] 自恢复失败：', String((e as Error)?.message || e)));
  }
}
