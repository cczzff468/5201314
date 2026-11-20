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
import { join, dirname } from 'node:path';
import { WX_CLOUD_CORE } from '../../src/lib/ios/wx-cloud/sources';
import { BUILTIN_PACK_STICKERS, stickerPackCdnUrl } from '../../src/lib/ios/sticker-packs';

// ---------------- v18 本地表情包全量注入（真机表情包根修） ----------------
// 用户 Supabase Storage 被 402 受限 / emoticons.json 停在旧版时，网关通道的表情解析
// 不再依赖云端文件：启动时把站内 public/stickers 四套大贴纸包读成 dataUrl 随物化注入
// （LOCAL_EMOTICONS_INJECT），核心 loadWxEmoticons / QQ emo 清单与它合并——本地优先。
// BUILTIN_PACK_STICKERS 是纯静态注册表（id + 意思 + 相对路径），与站内人设清单同源。

let localEmoticonsCache: Array<{ name: string; id: string; dataUrl: string; url: string }> | null = null;

function buildLocalEmoticons(): Array<{ name: string; id: string; dataUrl: string; url: string }> {
  if (localEmoticonsCache) return localEmoticonsCache;
  const out: Array<{ name: string; id: string; dataUrl: string; url: string }> = [];
  const publicRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
  for (const s of BUILTIN_PACK_STICKERS) {
    try {
      const rel = String(s.url || '').replace(/^\/+/, '');
      if (!rel) continue;
      const buf = readFileSync(join(publicRoot, rel));
      const mime = /\.gif$/i.test(rel) ? 'image/gif' : /\.png$/i.test(rel) ? 'image/png' : 'image/webp';
      const name = (s.meaning || '').trim().split(/[，,。.、\s]/)[0].slice(0, 12) || s.id;
      // v19：附带公网 CDN URL（jsdelivr——QQ 官方 v2 files 接口 url 制，内置包直发零托管）
      out.push({ name, id: s.id, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64'), url: stickerPackCdnUrl(s.url) });
    } catch {
      /* 单张读不到跳过（资产变动/清理中）：剩余的照常注入 */
    }
  }
  localEmoticonsCache = out;
  console.log('[im-gateway] 本地表情包注入：', out.length, '张（含 CDN URL，网关通道真机表情不依赖云端 Storage）');
  return out;
}

/** v19 内置大贴纸包 id → 公网 CDN URL 表（物化注入 LOCAL_STICKER_URLS：QQ 富媒体 url 制） */
function buildLocalStickerUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of BUILTIN_PACK_STICKERS) {
    const u = stickerPackCdnUrl(String(s.url || ''));
    if (s.id && u) out[s.id] = u;
  }
  return out;
}

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

// ---------------- v20 本地识图（QQ 入站图片 → VLM 描述：z-ai SDK createVision） ----------------

/** 本地识图端点（POST /vlm {url | b64, prompt} → {desc}）：真机上对方发图（QQ 入站 URL /
 *  微信入站 CDN 密文图解密后的 base64）→ 云端核心调它把图转成文字描述进 LLM 上下文——AI 会识图。
 *  v23：b64 参数新增（微信识图：core describeWxImage 把解密后的图片以 dataURL 传入）；
 *  url / b64 二选一。仅本机访问（不经 Caddy 对外）；SDK 缺失/识别失败返回 5xx，
 *  调用方（云端核心）拿到非 200 自动退占位文案——不炸收发主流程。 */
async function handleLocalVlm(req: Request): Promise<Response> {
  let body: Record<string, any> = {};
  try {
    body = (await req.json()) as Record<string, any>;
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }
  const url = String(body.url || '').trim();
  // v23 微信入站图：base64 dataURL（data:image/...;base64,...）或裸 base64（按 jpeg 兑底）
  let b64 = String(body.b64 || '').trim();
  if (b64 && !b64.startsWith('data:')) b64 = 'data:image/jpeg;base64,' + b64.replace(/^data:[^,]*,/, '');
  const prompt = String(body.prompt || '').trim().slice(0, 500) || '描述这张图片的内容';
  const src = url || b64;
  if (!src) return Response.json({ error: 'bad url' }, { status: 400 });
  if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) return Response.json({ error: 'bad url' }, { status: 400 });
  try {
    if (!zaiInstance) {
      const mod: any = await import('z-ai-web-dev-sdk');
      const ZAI = mod.default ?? mod;
      zaiInstance = await ZAI.create();
    }
    const res = await zaiInstance.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: src } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    });
    const desc = res?.choices?.[0]?.message?.content;
    if (!desc || !String(desc).trim()) return Response.json({ error: 'empty desc' }, { status: 502 });
    return Response.json({ desc: String(desc).trim().slice(0, 1000) });
  } catch (e) {
    zaiInstance = null; // 失败重置单例（下汰重试）
    return Response.json({ error: 'vlm failed: ' + String((e as Error)?.message || e).slice(0, 80) }, { status: 503 });
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
  /** v20：连接参数快照（push-config 热重物化用——网关运行中网站直推运行包后，用同一套
   *  连接参数重新物化核心，本地注入更新，QQ/微信循环不断线） */
  supaUrl: string;
  supaKey: string;
  relayUrl: string;
  relaySecret: string;
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
    // v19：数字序（旧版字典序——gen ≥10 时 'gen.10' < 'gen.9' 排在前面被误删；且上一进程
    // 留下的高序号文件会把本进程刚写的低序号新文件挤进「删除区」→ import 时
    // "Cannot find module core.gen.x.mjs"——网关启动失败的实测根因）
    const files = readdirSync(dir)
      .filter((f) => f.startsWith(CORE_PREFIX) && f.endsWith('.mjs'))
      .map((f) => ({ f, n: Number(f.slice(CORE_PREFIX.length, -4)) || 0 }))
      .sort((a, b) => a.n - b.n);
    for (const { f } of files.slice(0, Math.max(0, files.length - keep))) {
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

// v19 启动清场：上一进程留下的物化文件全部清掉（gen 计数每进程从 1 重来——不清场时旧
// 文件的高序号会把新文件挤进 prune 的删除区，import 必炸 "Cannot find module"）。
try {
  const bootDir = fileURLToPath(new URL('./', import.meta.url));
  for (const f of readdirSync(bootDir)) {
    if (f.startsWith(CORE_PREFIX) && f.endsWith('.mjs')) {
      try {
        unlinkSync(join(bootDir, f));
      } catch {
        /* 忽略 */
      }
    }
  }
} catch {
  /* 目录读取失败忽略 */
}

/** v20 本地直推文件：网站同步运行包时同源直推（op=push-config 落盘）——绕开 Supabase
 *  Storage 402/502 拒收，网关通道的人设/连发指令/表情包清单/语音配置永远新鲜（直推包
 *  落盘持久：网关重启照样读到，不依赖云端文件上传成败）。文件内容与云端 config.json /
 *  emoticons.json 完全同构（网站同一份构建产物）。 */
const LOCAL_CONFIG_FILE = 'local-config.json';
const LOCAL_EMOTICONS_FILE = 'local-emoticons.json';

function localFilePath(name: string): string {
  return fileURLToPath(new URL('./' + name, import.meta.url));
}

/** 读直推的运行包（null = 没直推过/读坏 → 核心退回云端 Storage 读） */
function readLocalConfig(): Record<string, any> | null {
  try {
    const j = JSON.parse(readFileSync(localFilePath(LOCAL_CONFIG_FILE), 'utf8')) as Record<string, any>;
    if (j && typeof j === 'object') return j;
  } catch {
    /* 没直推过/写坏 → null */
  }
  return null;
}

/** 读直推的微信表情包文件（emoticons.json 的 wechat 段；空表 = 没直推过） */
function readLocalEmoticonsFile(): Array<Record<string, any>> {
  try {
    const j = JSON.parse(readFileSync(localFilePath(LOCAL_EMOTICONS_FILE), 'utf8')) as { wechat?: Array<Record<string, any>> } | Array<Record<string, any>>;
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.wechat)) return j.wechat;
  } catch {
    /* 没直推过 → 空表 */
  }
  return [];
}

/** 把 WX_CLOUD_CORE + 连接变量物化成可 import 的模块（换连接重新物化，文件名递增做缓存失效）。
 *  v8：注入中继参数（RELAY_URL/RELAY_SECRET）——无用户项目密钥时配置读写改经云端函数。
 *  v13：注入 TTS_LOCAL_URL——网关本进程的本地语音合成端点（z-ai SDK wav），云端核心的
 *  QQ 语音条优先用它（用户不配 OpenAI 兼容 TTS 也能发语音）。
 *  v15：注入 IMG_LOCAL_URL——网关本进程的本地生图端点（z-ai 生图 + sharp 压 JPEG），
 *  云端核心的 [照片:描述] 标记优先用它（AI 发照片能力；网关在线时真机微信/QQ 都能收图）。
 *  v20：注入 VLM_LOCAL_URL（本地识图端点——QQ 入站图片转描述进 LLM 上下文）+
 *  LOCAL_CONFIG / LOCAL_EMOTICONS_FILE（直推运行包——loadConfig 本地优先、直推表情包
 *  并入清单，Storage 402 期间网关配置不再陈旧）。 */
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
    // v20 本地识图端点：QQ 入站图片（markdown/attachments URL）→ VLM 描述进 LLM 上下文
    `var VLM_LOCAL_URL_INJECT = ${JSON.stringify('http://127.0.0.1:' + PORT + '/vlm')};`,
    // v21 本地历史端点：聊天历史双写（本机磁盘先落，Storage 上传收敛为轮末批量——写放大
    // 从每轮 N 次降为 1 次；网站拉取走网关本地通道，云端只是镜像）
    `var HIST_LOCAL_URL_INJECT = ${JSON.stringify('http://127.0.0.1:' + PORT)};`,
    // v18：本地表情包全量注入（与站内人设清单同源；Storage 受限/旧包时真机照发真图）
    `var LOCAL_EMOTICONS_INJECT = ${JSON.stringify(buildLocalEmoticons())};`,
    // v19：QQ 富媒体 url 制——内置包 CDN URL 表（jsdelivr 直发零托管；语音/用户表情的动态字节
    // 由核心 qqHostMedia 托管到用户 Supabase 公桶——经云端函数 upload-file v19 代写）
    `var LOCAL_STICKER_URLS_INJECT = ${JSON.stringify(buildLocalStickerUrls())};`,
    // v20：直推运行包（local-config.json / local-emoticons.json）——loadConfig 本地优先，
    // 直推表情包并入微信清单（内置包优先、云端旧文件兖底）
    `var LOCAL_CONFIG_INJECT = ${JSON.stringify(readLocalConfig())};`,
    `var LOCAL_EMOTICONS_FILE_INJECT = ${JSON.stringify(readLocalEmoticonsFile())};`,
    WX_CLOUD_CORE,
    'export { loadConfig, tick, tickFast, handleQqEvent, qqToken, qqTokenReset, writeHeartbeat, supaGetJson, supaPutJson, loadQqHistory, appendQqHistory, refreshQqWsLock, cloudSendActive };',
  ].join('\n');
  const path = fileURLToPath(new URL(`./${CORE_PREFIX}${n}.mjs`, import.meta.url));
  writeFileSync(path, code);
  pruneGenFiles(3);
  return import(path);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------- v21 本地聊天历史（Storage 402/502 双向免疫） ----------------

/** 网关本地历史文件：核心 appendQqHistory / saveWxHistory 镜像逐条 POST /hist 落到本机
 *  磁盘（与 Supabase Storage 无关）；网站拉取（op=qq-history / wx-history）优先读这里。
 *  云端 Storage 只是镜像——受限期间真机收发的每条记录都还在本机，网站 QQ/微信聊天
 *  界面照常显示（「真机 QQ 上发的消息网站里看不到」的根修）。 */
const LOCAL_QQ_HIST_FILE = 'local-qq-history.json';
const LOCAL_WX_HIST_FILE = 'local-wx-history.json';

function readLocalHist(file: string): Array<Record<string, any>> {
  try {
    const j = JSON.parse(readFileSync(localFilePath(file), 'utf8')) as { msgs?: Array<Record<string, any>> } | null;
    return (j && Array.isArray(j.msgs)) ? j.msgs : [];
  } catch {
    return []; // 还没写过/写坏 → 空表
  }
}

function writeLocalHist(file: string, msgs: Array<Record<string, any>>): void {
  try {
    writeFileSync(localFilePath(file), JSON.stringify({ msgs, updatedAt: Date.now() }));
  } catch {
    /* 磁盘写失败不影响收发主流程 */
  }
}

/** POST /hist {channel:'qq'|'wx', msgs:[items]} → 逐条并入本地文件（按 id 幂等；无 id
 *  条目按 role+ts+content 摘要去重），窗口与云端同口径（QQ 200 / WX 60）。
 *  仅本机访问（不经 Caddy 对外）。 */
async function handleLocalHist(req: Request): Promise<Response> {
  let body: Record<string, any> = {};
  try {
    body = (await req.json()) as Record<string, any>;
  } catch {
    return Response.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  const channel = String(body.channel || '');
  const msgs = Array.isArray(body.msgs) ? (body.msgs as Array<Record<string, any>>) : [];
  if (channel !== 'qq' && channel !== 'wx') {
    return Response.json({ ok: false, error: 'bad channel' }, { status: 400 });
  }
  const file = channel === 'qq' ? LOCAL_QQ_HIST_FILE : LOCAL_WX_HIST_FILE;
  const cap = channel === 'qq' ? 200 : 60;
  const cur = readLocalHist(file);
  const keyOf = (m: Record<string, any>) =>
    m.id !== undefined ? String(m.id) : JSON.stringify([m.role, m.ts, m.content]);
  const seen = new Set(cur.map(keyOf));
  let added = 0;
  for (const m of msgs) {
    if (!m || typeof m.content !== 'string' || !m.content) continue;
    const key = keyOf(m);
    if (seen.has(key)) continue;
    seen.add(key);
    cur.push({ id: m.id, role: m.role, content: String(m.content).slice(0, 500), ts: Number(m.ts) || Date.now() });
    added++;
  }
  writeLocalHist(file, cur.slice(-cap));
  return Response.json({ ok: true, added });
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
      // v23 token 自愈：400/401/403 多半是平台侧把 token 挤过期（或凭证真失效）——清缓存
      // 重取，下一轮 connectQq 拿新 token；凭证真错时 100016 直接浮出成 lastError（用户在
      // 云端助手页看到「请核对 AppID/AppSecret」，不再永远「正在连接 QQ 平台…」）
      const authish = gwr.status === 400 || gwr.status === 401 || gwr.status === 403;
      if (authish) {
        try { await rt.core.qqTokenReset(); } catch { /* 老核心没导出时忽略 */ }
        q.lastError = `QQ 网关地址获取失败 ${gwr.status}（token 已重置待重试；若持续出现请核对 AppID/AppSecret）`;
      } else {
        q.lastError = `QQ 网关地址获取失败 ${gwr.status}`;
      }
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
  // v21 心跳写节流：旧版每个 10s 轮询轮都写一次 Storage 心跳（一天 8640 次——高频程序化
  // 直写正是触发 Supabase 免费层风控 402 的写放大主源之一）；60s 一次足够表达在线语义
  //（读侧窗口都是分钟级）。
  let lastHbAt = 0;
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
      if (Date.now() - lastHbAt > 60_000) {
        lastHbAt = Date.now();
        await rt.core.writeHeartbeat({ source: 'im-gateway' }).catch(() => undefined);
      }
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

  // v19 级联根修：不再「先探测后停旧」——按候选通道逐个【物化 + 真读一次运行包】，全通过
  // 才停旧换新。旧版流程（探测中继 402 → 降级直连 → 先停旧网关 → 直连 Storage 也 402 →
  // 新网关起不来）会把唯一还在线的网关弄死（用户实测：项目被平台限制（402 restricted）时
  // 网关静默全灭，微信/QQ 全部下线）。现在：中继优先（任务密钥部署时注入、不随 JWT 轮换），
  // 读不成再试直连；两条都读不成 → 报错返回，【不动现有 rt】（秒回加速照常跑，页面看门狗
  // 每 6 秒会再来试——限制解除即自动恢复）。探测（probeRelayCapability）只作日志参考。
  const candidates: Array<'relay' | 'direct'> = [];
  if (relay && rsecret) candidates.push('relay');
  if (key.length >= 20) candidates.push('direct');
  if (!candidates.length) {
    return { ok: false, msg: '缺少云端凭证（任务密钥/项目密钥都没有）：请回手机 App 重新一键部署' };
  }
  let lastFail = '';
  for (const mode of candidates) {
    if (mode === 'relay') {
      const probe = await probeRelayCapability(relay, rsecret);
      if (!probe.ok) console.log('[im-gateway] 中继探测不通过（继续真实试读兜底）：', probe.msg);
    }
    const core = await materializeCore(url, mode === 'relay' ? '' : key, mode === 'relay' ? relay : '', mode === 'relay' ? rsecret : '');
    // 启动自检：真实读一次运行包（密钥错/包缺失立刻换下一候选，不静默空转）
    try {
      await core.loadConfig(true);
    } catch (e) {
      lastFail = lastFail || String((e as Error)?.message || e).slice(0, 120);
      console.log('[im-gateway] ' + mode + '通道读运行包失败：', lastFail);
      continue;
    }
    // 新通道就绪：此刻才停旧换新（级联根修——旧网关一直在线到这一步）
    if (rt) await stopGateway();
    // 中继模式落盘（自恢复用；直连模式不落盘——密钥不该进磁盘）
    if (mode === 'relay') {
      writePersistedState({ v: 1, supaUrl: url, ref: ref || url.replace(/^https:\/\//, '').split('.')[0], relayUrl: relay, relaySecret: rsecret, savedAt: Date.now() });
    } else {
      clearPersistedState();
    }
    // 上面 loadConfig 已通过：组装 rt 并启动全部循环
    const gen = 1;
    rt = {
      gen,
      ref: ref || url.replace(/^https:\/\//, '').split('.')[0],
      startedAt: Date.now(),
      mode,
      // v20 连接参数快照：push-config 热重物化用（同一套参数 + 新本地注入）
      supaUrl: url,
      supaKey: mode === 'relay' ? '' : key,
      relayUrl: mode === 'relay' ? relay : '',
      relaySecret: mode === 'relay' ? rsecret : '',
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
  // 两条通道都读不成运行包：不动现有 rt（若有——秒回加速照常在线），如实报因；
  // 页面看门狗每 6 秒会再试（Supabase 平台限制解除即自动恢复）。
  return {
    ok: false,
    msg:
      '网关读取云端运行包失败（中继/直连两条通道都试过）：' +
      (lastFail || '未知原因') +
      '——多为 Supabase 项目被平台限制（402）或运行包未同步；网站开着时网关会自动重试恢复',
  };
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
    // v20 本地识图端点（云端核心 QQ 入站图片转描述用；同 TTS 仅本机访问）
    if (url.pathname === '/vlm' && req.method === 'POST') {
      return handleLocalVlm(req);
    }
    // v21 本地历史端点（核心 appendQqHistory / saveWxHistory 镜像落盘；仅本机访问）
    if (url.pathname === '/hist' && req.method === 'POST') {
      return handleLocalHist(req);
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
      // v20 push-config：网站同步运行包时同源直推（绕开 Storage 402/502 拒收）：落盘
      // local-config.json / local-emoticons.json；网关运行中即时热重物化（loadConfig 本地
      // 优先 + 直推表情包并入清单，QQ/微信循环不断线——Storage 受限期间网关人设/连发/
      // 表情包/语音配置照样最新）。云端上传成败与此无关（两路并行互不阻断）。
      // pkg=null = 清除本地直推（回退云端 Storage 为配置源——测试清理/排查用）。
      if (op === 'push-config') {
        const pkg = body.pkg && typeof body.pkg === 'object' ? (body.pkg as Record<string, unknown>) : null;
        if (!body.hasOwnProperty?.('pkg') || body.pkg === undefined) {
          return Response.json({ ok: false, msg: '运行包格式不对（缺 pkg 对象）' }, { status: 200 });
        }
        try {
          if (pkg === null) {
            try { unlinkSync(localFilePath(LOCAL_CONFIG_FILE)); } catch { /* 本就不存在 */ }
            try { unlinkSync(localFilePath(LOCAL_EMOTICONS_FILE)); } catch { /* 本就不存在 */ }
          } else {
            writeFileSync(localFilePath(LOCAL_CONFIG_FILE), JSON.stringify(pkg));
            if (Array.isArray(body.emoticons)) {
              writeFileSync(localFilePath(LOCAL_EMOTICONS_FILE), JSON.stringify(body.emoticons));
            } else {
              try { unlinkSync(localFilePath(LOCAL_EMOTICONS_FILE)); } catch { /* 本就不存在 */ }
            }
          }
          if (rt) {
            const core = await materializeCore(rt.supaUrl, rt.supaKey, rt.relayUrl, rt.relaySecret);
            rt.core = core; // 热生效：本轮在飞的旧核心跑完，下一轮 tick/handleQqEvent 自然换新
            console.log('[im-gateway] 运行包直推已热生效（loadConfig 本地优先 + 直推表情包并入）');
          }
          return Response.json({
            ok: true,
            msg: pkg === null
              ? '本地直推已清除（网关回退云端 Storage 配置源）'
              : '运行包已直推本机网关' + (rt ? '（已热生效）' : '（网关未运行：已存盘，启动时自动读取）'),
          });
        } catch (e) {
          return Response.json({ ok: false, msg: '直推落盘失败：' + String((e as Error)?.message || e).slice(0, 100) }, { status: 200 });
        }
      }
      // v21 聊天历史本地通道（网站拉取优先读网关本机文件——Storage 402/502 受限期间
      // 真机收发记录照常显示；网关不在线时网站自己回退云端 Storage 直读/中继）
      if (op === 'qq-history' || op === 'wx-history') {
        const file = op === 'qq-history' ? LOCAL_QQ_HIST_FILE : LOCAL_WX_HIST_FILE;
        const msgs = readLocalHist(file);
        return Response.json({ ok: true, msgs, n: msgs.length });
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
