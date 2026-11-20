/**
 * 云端助手运行时源码 v16（模板字符串，部署时下发）——云端 7×24 骨干版 · 真机同源提示词。
 *
 * 架构（用户自己的 Supabase 项目 = 收发骨干，不依赖本站在线）：
 * - 微信收发（getupdates 长轮询 → 人设回复 → sendmessage）：定时任务 pg_cron（存在用户
 *   数据库里，v9 起部署后自动建立）每分钟打一次 Edge Function 的 cron-cycle；本站网关
 *   （免费加速器）在线时以轮询锁让位互补——两边并发跑也不会双回（v9 认领表）。
 * - QQ：官方 WebSocket 出站长连接（不需要境内回调出口，绕开平台对 Webhook 的地域限制）。
 *   两条持有方互斥（qq-ws-lock）：本站网关在线时由网关长连接；本站不在时由 cron-cycle
 *   分支在 Edge Function 里保持会话（预算 ~135s/轮，会话断点 state/qq-ws-session.json，
 *   下一轮 Resume 续传，平台补发断线期间的事件）。QQ Webhook 回调也仍可用（控制台配函数
 *   URL 即命中，无签名头 plain_token 校验可过）。
 * - v9 双轮询器安全：微信轮询锁（state/wx-lock.json，50s TTL）+ 认领表
 *   （state/wx-claims.json，回复前认领 3 分钟 TTL，失败即释）——网关/定时任务/手动测试
 *   同跑一个桶不再双回；旧版「回复风暴」根因（游标重收）仍由 v5 游标持久化兜底。
 * - v11 QQ 认领表（state/qq-claims.json）：QQ 消息回复前先认领（3 分钟 TTL，失败即释）——
 *   网关长连接/云端 cron WS/Webhook/Resume 补发同一条事件不再「回复两三遍」；
 *   appendQqHistory 同 id 幂等（云端历史不再出现同一条两份）。
 * - 运行包历史种子（v5）：config.wechat.history / config.qq.history 是手机 App 同步时
 *   打包的网站聊天最近 20 条——云端冷启动不再失忆，回复内容与网站聊天同源连续。
 * - v13 真机同源（机主定调「网站上怎么回复的，真机微信/QQ 就怎么回复的」）：
 *   运行包 persona 改由站内组装器产出（人设七要素 + 连发短消息 + 沉浸规则 + 表情清单 +
 *   引用教学 + 注册表用户编辑），另带 worldbook（世界书打包：全局常驻 + 触发词命中）、
 *   stickerMap（微信 [表情包:ID]→经典表情）、multi（连发开关）；核心运行期做：
 *   ①连发分段发送（句界切分，站内 splitReplySegments 同口径）②世界书六位置注入
 *   ③[M数字]编号历史 + [引用:M编号] 转文字引用行 ④[思考]块剥除 ⑤站内动作标记净化
 *   ⑥QQ 表情包 ID 直选（网站表情全量随包上云）⑦QQ 语音条取连发首段（云端 TTS /
 *   网关本地合成任一可用）。
 * - v14（机主定调「让他多发点，3~30，多的可以多发，没话了可以少发，尽量多发」+
 *   「网站里内置的表情包真机微信也要能发」+「我让 AI 引用消息他好像不会」）：
 *   ①连发条数上限 8→30、max_tokens 500→2400（旧值会把长连发半路截断）、上下文窗口
 *   13→16、历史落库 30→60；②微信真表情包：纯 JS AES-128-ECB + MD5（零依赖，WebCrypto
 *   不支持 ECB）→ 官方 getuploadurl 预签名 → CDN 密文上传 → image_item 真图发送
 *   （emoticons.json 的 wechat 段，站内微信面板全量；失败降级经典表情代码）；③表情
 *   标记扫描统一 collectCloudStickers（微信/QQ 共用，三套标记变体）；④QQ 超预算条数
 *   均匀分摊（不再全塞末条）；⑤引用教学（站内 chat-rich v83）新增「对方明确让你引用
 *   时必须用 [引用:编号]」用例，随人设包自动进真机链路。
 * - v15（机主定调「让 AI 在真机微信/QQ 上引用我的消息」「发照片/斗图/语音分段/定时主动」
 *   + 能力清单表）：①入站引用解析 extractInboundQuote——对方在真机上引用旧消息回复时
 *   被引内容（quote/reply 类字段，防御式扫描）注入 LLM 上下文（旧版 AI 看不到被引内容，
 *   「让 TA 引用却说不会」的另一半根因）；②照片生成 [照片:描述] → IMG_LOCAL_URL（网关
 *   z-ai 生图，JPEG）→ 微信官方媒体协议发真图 / QQ 富媒体发图（网关不在线时静默剥除）；
 *   ③QQ 超长语音分段：语音命中轮不再只合成首段——前 3 段逐段合成、>200 字按句界再切、
 *   失败段文字补回；④QQ 斗图模式 cfg.qq.stickerBattle：表情包发送上限 3→5 张；⑤QQ 定时
 *   主动消息 cfg.qq.proactive（早安/晚安，记住最近 C2C openid，月 4 条自限——QQ 平台
 *   主动消息限额）；⑥微信历史落盘 30→60（v14 只改了内存窗口，持久化窗口没跟上）；
 * - v16（机主定调「QQ 语音说发不了 + QQ 表情有问题 + 微信引用/生图删除 + 主动发消息跟随
 *   网站设置、定时发消息删除 + AI 只发一条 + 经典小表情大图之谜 + 云端轮询 10 秒开关」）：
 *   ①QQ 语音条真能力：AI 输出 [语音:想说的话] 标记 → 云端合成真语音条强制发出（不再依赖
 *     语音频率计数器命中）；对方明确要语音时该轮直接升级语音；ttsOk 时运行期动态注入
 *     【语音条能力】教学（旧版 AI 只会说「发不了」——没有任何机制让它主动触发语音）；
 *   ②QQ 出站净化：经典表情文字代码（[流泪][裂开][微笑]…）在真机 QQ 上不渲染（平台机器人
 *     通道不转义）——出站剥离，避免「表情代码当文字」观感问题；
 *   ③微信引用功能下线（机主定调）：微信通道历史不再编号（[M数字] 门牌号撤除）、
 *     [引用:编号] 标记剥离不转引用行；QQ 通道保留引用（未要求移除）；
 *   ④照片生成下线（[照片:描述] 教学与运行链路整体移除——标记照旧静默剥除）；
 *   ⑤QQ 定时主动消息（早安/晚安）下线；主动消息改为「站内引擎驱动」：网站「主动发消息」
 *     设置触发时经 send-active 动作把已生成的内容发到真机（cloudSendActive：微信用最近
 *     会话 context_token、QQ 用活跃消息接口）；云端不再有独立定时器；
 *   ⑥连发兜底 ensureBurstRule：运行包人设里没有连发指令块时（旧包/未绑定）运行期补注入
 *     默认 3~30 连发指令——真机「AI 只发一条」的兑底；
 *   ⑦云端轮询 10 秒化：cron-cycle&fast=1（tickFast——9 秒短窗单轮 getupdates，跳轮询锁，
 *     认领表兑底）由 pg_cron 每 10 秒打一次；cron-cycle&qq=1 只做 QQ WS 会话保持（每分钟）；
 *   ⑧ping ver 16。
 * - v17（机主实测三连反馈「表情包发颜文字或裸标记 [表情包:sunny-02] / QQ 语音还是说发不了 /
 *   AI 经常只发一条」——根因：用户云端还在跑旧代函数，而重新同步只推配置不推代码：旧函数
 *   ping 回包没有 ver 字段 → 升级链判 null 直接跳过重部署，真机永远跑旧行为）：
 *   ①QQ 语音云端开箱兑底 synthesizeQqVoice——没配 TTS 且网关不在线（云端 Deno 无
 *     TTS_LOCAL_URL）时用聊天 API（cfg.llm，OpenAI 兼容 /audio/speech）试合成，服务商
 *     不支持该端点就静默回退文字（ttsOk 判定同步放宽——语音能力教学不再因「没配 TTS」
 *     整个不注入，AI 也就不再只说「发不了语音」）；
 *   ②站内 supabase.ts 升级链收紧：探测不到 ver（旧函数 ping 无 ver / 网络失败）也不再跳过——
 *     ver ≠ 当代就重部署最新函数代码（部署接口幂等，重同步一次真机行为全量对齐）；
 *   ③ping ver 17。
 * - v18（机主实测「真机微信/QQ 还是不会发表情包 / QQ 不会发语音 / 运行包上传 402 受限」
 *   三连反馈——本轮沙箱实测定位三个独立根因）：
 *   ①网关本地表情包注入 LOCAL_EMOTICONS_INJECT——站内 public/stickers 四套大贴纸包
 *     全量随网关物化注入（不依赖 Supabase Storage 的 emoticons.json）：用户项目 Storage
 *     被 402 受限/旧包未同步时，旧运行包的 emoticons 清单解析不到 sunny-02 这类标记 →
 *     标记裸发/被剥。本地注入后网关通道永远有全量表情可解析（本地优先，云端文件补充）；
 *   ②QQ 裸标记泄漏兑底：整条回复只剩解析不到的表情标记时旧版兑底把【未切前的原文】
 *     （含裸 [表情包:sunny-02]）当正文发出——改为发切后干净文本，净空用颜文字兑底；
 *   ③QQ 语音根修（配套 mini-services/im-gateway/silk-wasm.mjs 改纯 JS）：旧适配层带
 *     TS 注解但 .mjs 扩展名 → Bun 拒绝解析 → silk 编码必失败 → 语音全部降级文字；
 *   ④ping ver 18。
 * - v19（机主实测「微信表情包点开『已过期或已被清理』+ QQ 表情包『说发了却什么都没收到』+
 *   QQ 语音仍只回文字」——沙箱实测定位三个独立根因，全部根修）：
 *   ①微信表情包 aes_key 编码：官方 SDK（@tencent-weixin/openclaw-weixin 的
 *     sendImageMessageWeixin）发 base64(hex 字符串)（UploadedFileInfo.aeskey 是 hex 文本，
 *     Buffer.from(hex文本).toString('base64')）——旧版发 base64(原始 16 字节)，上传与消息
 *     全部成功、唯独接收端解不开密文 → 气泡灰块 + 点开「图片已过期或已被清理」。
 *     对齐官方：aes_key = base64(aeskey 的 hex 文本)；
 *   ②QQ 富媒体 url 制根修：官方 v2 files 接口只收 url（QQ 服务器来拉取）——旧版把 base64
 *     塞进 file 字段官方并不支持，必报 40093007「富媒体文件下载失败」→ 表情包/语音
 *     全部静默降级（真机「AI 说发了却什么都没有」的根因）。现在：内置大贴纸包走仓库
 *     jsdelivr CDN URL 直发（LOCAL_STICKER_URLS 注入/运行包 emoticons 带 url）、语音 silk
 *     与用户收藏表情托管成公网 URL（用户 Supabase 公桶——中继经云端函数代写/直连直写
 *     qqHostMedia(qqHostMediaCloud)）逐候选重试；
 *   ③ping ver 19（部署代理的 storage-setup 同步支持 encoding:'base64' 二进制文件——
 *     用户收藏表情上公桶做 QQ 直发 URL）。
 *
 * 配置（用户 Supabase 私有桶 wx-cloud/config.json，v2 形状）：
 * { version:2, secret, wechat:{botToken,botId,persona,history,stickerMap,worldbook,multi},
 *   qq:{appId,appSecret,persona,history,emoticons,tts,voiceEvery,worldbook,multi},
 *   llm:{baseUrl,apiKey,model}, promptTimeZone, syncedAt }
 * 另：emoticons.json = { wechat:[{name,id,dataUrl}] }（v14 微信表情包，独立文件避开
 *   config.json 的 800KB 单文件上传上限；QQ 表情仍走 config.json 的 qq.emoticons）。
 *
 * 注意：模板里内层代码一律用单双引号，不用反引号，避免与外层模板字面量冲突。
 */

// ---------------- 微信 + QQ 共用核心（Node / Deno 通用，纯 fetch） ----------------

/** v17：云端运行时代际号——站内「重新同步运行包」用它判断要不要重部署函数代码
 *  （ping 回的 ver ≠ 它（含 ping 不回 ver 的旧函数）= 真机上还在跑旧函数：只回一两条/
 *  不会表情包/不会语音/发裸标记——重部署最新代码全量对齐）。 */
// v20：识图（QQ 入站图 markdown/附件 URL → VLM 描述进 LLM 上下文，网关本地端点）+ 本地直推
// 运行包（push-config 落盘热生效，loadConfig 本地优先——Storage 402/502 受限期间网关人设/
// 连发/表情包/语音配置照样新鲜）+ QQ 被动回复余量记账（网站回复镜像优先吃被动名额，省
// 每月 4 条主动配额）+ 入站图片占位统一（attachments 无 url 也有可读提示）。
export const CLOUD_RUNTIME_VER = 21;

export const WX_CLOUD_CORE = String.raw`
// ---- 微信云端助手核心（自动生成，勿手工编辑） ----
var ILINK = 'https://ilinkai.weixin.qq.com';
// 可变：loadConfig 读到运行包 wechat.baseUrl（confirmed 回包）后切过去；其余场景回默认
var ILINK_HOST = ILINK;
var QQ_API = 'https://api.sgroup.qq.com';
// QQ 取凭证双端点（官方现行版先行：海外出口可达；旧 /api/v1/* 网关层拦海外 503 作兑底）
var QQ_TOKEN_URLS = ['https://api.bot.qq.com/app/getAppAccessToken', 'https://bots.qq.com/api/v1/getAppAccessToken'];
var BASE_INFO = { channel_version: '2.4.10', bot_agent: 'OpenClaw' };
var SUPA_URL = (typeof SUPA_URL_INJECT !== 'undefined' && SUPA_URL_INJECT) || '';
var SUPA_KEY = (typeof SUPA_KEY_INJECT !== 'undefined' && SUPA_KEY_INJECT) || '';
// v8 中继模式（内置 IM 网关用）：用户 Supabase 项目密钥拿不到/被拒时（代写路径部署后 serviceKey 为空，
// 或 JWT 轮换后旧 key 全拒），读写一律改经已部署的 wx-assistant 函数（read-file / upload-file 动作，
// X-Task-Secret 鉴权，函数用平台注入凭证访问 Storage）——网关只需要项目地址 + 任务密钥即可工作。
var RELAY_URL = (typeof RELAY_URL_INJECT !== 'undefined' && RELAY_URL_INJECT) || '';
var RELAY_SECRET = (typeof RELAY_SECRET_INJECT !== 'undefined' && RELAY_SECRET_INJECT) || '';
// v13 网关本地语音合成端点（im-gateway 注入，z-ai SDK 合成 wav）：配了它时 QQ 语音条
// 不需要用户自配 OpenAI 兼容 TTS；云端（Deno）不注入则用 cfg.qq.tts（用户自配）
var TTS_LOCAL_URL = (typeof TTS_LOCAL_URL_INJECT !== 'undefined' && TTS_LOCAL_URL_INJECT) || '';
// v18 网关本地表情包全量注入（im-gateway 启动时把站内 public/stickers 四套大贴纸包读成
// dataUrl 随物化注入）：用户 Supabase Storage 被 402 受限 / emoticons.json 停在旧版时，
// 网关通道的表情解析不再依赖云端文件——标记本地直接解析成真图。云端（Deno）不注入为空数组。
var LOCAL_EMOTICONS = (typeof LOCAL_EMOTICONS_INJECT !== 'undefined' && LOCAL_EMOTICONS_INJECT) || [];
// v19 QQ 富媒体 url 制（QQ 官方 v2 files 接口只收 url——QQ 服务器来拉取；旧版把 base64 塞
// file 字段官方并不支持，必报 40093007「富媒体文件下载失败」，表情包/语音从未真正发出过）：
// - LOCAL_STICKER_URLS：内置大贴纸包 id → 仓库 CDN URL（jsdelivr，QQ 实测可拉取）——内置包零托管直发。
// - 语音 silk / 用户收藏表情的动态字节 → qqHostMedia 托管成用户 Supabase 公桶里的公网 URL
//   （公桶 QQ 实测可拉取）：网关中继模式经云端函数 upload-file（encoding:'base64'，v19 函数
//   支持，读回验证防旧函数写坏），直连/云端函数模式用 SUPA 凭证直写（qqHostMediaCloud）。
var LOCAL_STICKER_URLS = (typeof LOCAL_STICKER_URLS_INJECT !== 'undefined' && LOCAL_STICKER_URLS_INJECT) || {};
// v20 网关本地识图端点（im-gateway 注入，z-ai SDK createVision）：QQ 入站图片（content 的
// markdown 图 / attachments）先经它转成文字描述进 LLM 上下文——真机 QQ 上「AI 会识图」。
// 云端（Deno）不注入为空 → 退回占位文案旧路径（描述不可用不炸收发主流程）。
var VLM_LOCAL_URL = (typeof VLM_LOCAL_URL_INJECT !== 'undefined' && VLM_LOCAL_URL_INJECT) || '';
// v21 网关本地历史端点（im-gateway 注入 /hist）：聊天历史双写——本机磁盘先落（本机写
// 不受 Supabase 402/502 影响），Storage 上传收敛为轮末单次批量（写放大从每轮 N 次降为
// 1 次——逐条整文件重写正是触发免费层风控的写放大主源）；网站拉取新增网关本地通道
// （op=qq-history / wx-history），云端 Storage 只是镜像而非唯一事实源。云端（Deno）不
// 注入为空 → 行为与旧版一致（仅 Storage，同样享受批量写降频）。
var HIST_LOCAL_URL = (typeof HIST_LOCAL_URL_INJECT !== 'undefined' && HIST_LOCAL_URL_INJECT) || '';
// v20 网关本地运行包直推（push-config op 落盘 local-config.json / local-emoticons.json）：
// 网站每次同步运行包时同源直推本机网关——绕开 Supabase Storage 402/502 拒收：网关通道
// 永远用最新人设/连发指令/表情包清单/语音配置，不依赖云端文件上传成败（Storage 受限期间
// 真机「AI 只发一条」「表情包停在旧包」的根修）。云端（Deno）不注入为 null → 云端照旧读 Storage。
var LOCAL_CONFIG = (typeof LOCAL_CONFIG_INJECT !== 'undefined' && LOCAL_CONFIG_INJECT) || null;
// v20 直推的微信表情包文件（emoticons.json 的 wechat 段：用户收藏 + 站内面板全量）：
// 与 LOCAL_EMOTICONS（内置包）合并——本地直推优先于云端旧文件、内置包优先于两者。
var LOCAL_EMOTICONS_FILE = (typeof LOCAL_EMOTICONS_FILE_INJECT !== 'undefined' && LOCAL_EMOTICONS_FILE_INJECT) || [];
/** v18 表情清单合并：本地注入优先（站内当前资产、永远新鲜），云端文件补充（去重 by id/name）。
 *  两路共用：微信 emoticons.json 的 wechat 段 / QQ config 的 qq.emoticons。
 *  v18 过滤：远端旧包里的 wxb- 与 qqb- 前缀官方经典小表情不并入——v16 政策是经典小表情
 *  在微信走 [微笑] 文字代码（stickerMap→经典转换）、QQ 不发；并回来会把小表情当
 *  大图表情包真发（旧版 emoticons.json 停在 v16 前的「大眼微笑脸之谜」形态）。 */
function mergeEmoticons(local, remote) {
  if (!local || !local.length) {
    var r0 = remote || [];
    var out0 = [];
    for (var z = 0; z < r0.length; z++) if (r0[z] && r0[z].dataUrl && !/^(?:wxb|qqb)-/.test(String(r0[z].id || ''))) out0.push(r0[z]);
    return out0;
  }
  var out = local.slice();
  var seen = {};
  for (var i = 0; i < out.length; i++) {
    var k = String((out[i] && (out[i].id || out[i].name)) || i);
    if (seen[k]) { out.splice(i, 1); i--; continue; }
    seen[k] = 1;
  }
  var r = remote || [];
  for (var j = 0; j < r.length; j++) {
    var e = r[j];
    if (!e || !e.dataUrl) continue;
    if (/^(?:wxb|qqb)-/.test(String(e.id || ''))) continue; // v18：官方经典小表情不并入（见上）
    var rk = String(e.id || e.name || '');
    if (rk && seen[rk]) continue;
    var dup = false;
    for (var q = 0; q < out.length; q++) if (out[q] && out[q].name === e.name && out[q].dataUrl === e.dataUrl) { dup = true; break; }
    if (!dup) out.push(e);
  }
  return out;
}
var BUCKET = 'wx-cloud';
var UPDATES_BUF = '';
var CFG = null;
var CFG_AT = 0;
var QQ_TOKEN = '';
var QQ_TOKEN_AT = 0;
var HIST_WX = null;
var HIST_QQ = null;
var HIST_AT = 0;

function supaHeaders() {
  // 按 key 类型区分（官方文档两套鉴权）：新式 key（sb_secret_/sb_publishable_ 开头）
  // 不是 JWT，只能放 apikey 头——放 Authorization Bearer 会被网关/Storage 当 JWT 解析，
  // 报 400 Invalid Compact JWS；legacy JWT（eyJ 开头）则 apikey + Bearer 双带
  if (/^sb_(secret|publishable)_/.test(SUPA_KEY)) {
    return { apikey: SUPA_KEY, 'Content-Type': 'application/json' };
  }
  return { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json' };
}

async function supaGetJson(path) {
  // v8 中继读：经云端函数（平台凭证读 Storage）；失败按「没有」处理，与直读语义一致
  if (RELAY_URL && RELAY_SECRET) {
    try {
      var rr = await fetch(RELAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Task-Secret': RELAY_SECRET, 'X-Task-Action': 'read-file' },
        body: JSON.stringify({ path: path }),
        signal: AbortSignal.timeout(25000),
      });
      if (!rr.ok) return null;
      var rj = await rr.json();
      return rj && rj.ok && rj.data !== undefined ? rj.data : null;
    } catch (e) { return null; }
  }
  var r = await fetch(SUPA_URL + '/storage/v1/object/' + BUCKET + '/' + path, { headers: supaHeaders() });
  if (!r.ok) return null;
  try { return await r.json(); } catch (e) { return null; }
}

async function supaPutJson(path, obj) {
  // v8 中继写：经云端函数 upload-file 动作（平台凭证写 Storage）
  if (RELAY_URL && RELAY_SECRET) {
    try {
      await fetch(RELAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Task-Secret': RELAY_SECRET, 'X-Task-Action': 'upload-file' },
        body: JSON.stringify({ files: [{ path: path, content: JSON.stringify(obj), bucket: BUCKET, contentType: 'application/json' }] }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) { /* 心跳/历史写失败不致命 */ }
    return;
  }
  try {
    await fetch(SUPA_URL + '/storage/v1/object/' + BUCKET + '/' + path, {
      method: 'POST',
      headers: Object.assign(supaHeaders(), { 'x-upsert': 'true', 'Content-Type': 'application/json' }),
      body: JSON.stringify(obj),
    });
  } catch (e) { /* 心跳/历史写失败不致命 */ }
}

async function loadConfig(force) {
  if (!force && CFG && Date.now() - CFG_AT < 60000) return CFG;
  // v20 本地直推优先：网关物化时注入的 local-config.json（网站每次同步直推——永远比
  // Storage 里的新）。本地有就用本地（Storage 被 402/502 拒收时网关配置不再陈旧）；
  // 没有（云端 Deno 函数 / 未直推过）才读云端 Storage。直推包落盘持久，网关重启照样新鲜。
  if (LOCAL_CONFIG) {
    CFG = LOCAL_CONFIG;
    CFG_AT = Date.now();
    var buL = CFG.wechat && typeof CFG.wechat.baseUrl === 'string' ? CFG.wechat.baseUrl.replace(/\/+$/, '') : '';
    ILINK_HOST = /^https:\/\/[a-z0-9.-]+\.(weixin\.)?qq\.com$/i.test(buL) ? buL : ILINK;
    return CFG;
  }
  var c = await supaGetJson('config.json');
  if (!c) throw new Error('运行包缺失：请回到手机 App「设置 → 云端助手」重新同步');
  CFG = c;
  CFG_AT = Date.now();
  // confirmed 回包的 baseurl：云端 Bot API 跟着走（仅放行 *.weixin.qq.com / *.qq.com，防 SSRF）
  var bu = c && c.wechat && typeof c.wechat.baseUrl === 'string' ? c.wechat.baseUrl.replace(/\/+$/, '') : '';
  ILINK_HOST = /^https:\/\/[a-z0-9.-]+\.(weixin\.)?qq\.com$/i.test(bu) ? bu : ILINK;
  return CFG;
}

/** X-WECHAT-UIN：随机 uint32 十进制串再 base64（协议约定形态，上游不校验具体值；Deno/Node 通用） */
function wxUin() {
  var s = String(Math.floor(Math.random() * 4294967295));
  return (typeof btoa === 'function') ? btoa(s) : Buffer.from(s).toString('base64');
}

async function loadWxHistory(force) {
  if (!force && HIST_WX && Date.now() - HIST_AT < 30000) return HIST_WX;
  var h = await supaGetJson('history.json');
  HIST_WX = h && Array.isArray(h.msgs) ? h.msgs : [];
  HIST_AT = Date.now();
  return HIST_WX;
}

async function saveWxHistory() {
  // v15：30 → 60——与 v14 内存窗口同步（一轮连发就能占二三十条，旧 30 条只剩半轮）
  await supaPutJson('history.json', { msgs: (HIST_WX || []).slice(-60), updatedAt: Date.now() });
}

/** v5 游标持久化：getupdates 游标存进桶（state/wx-updates-buf.json），新实例/冷启动不再
 *  从空游标重收整批积压（旧版「一条消息被回十几次」的回复风暴根因）；已回复的
 *  message_id 另存 state/wx-seen.json 去重兑底（游标回退时只补未回成功的那些）。 */
var WX_SEEN = null;
async function loadWxCursor() {
  try {
    var s = await supaGetJson('state/wx-updates-buf.json');
    if (s && typeof s.buf === 'string' && s.buf) UPDATES_BUF = s.buf;
    var sn = await supaGetJson('state/wx-seen.json');
    WX_SEEN = sn && Array.isArray(sn.ids) ? sn.ids : [];
  } catch (e) { /* 兑底：从空游标开始（首条会重收但 seen 兑底） */ }
}
async function saveWxCursor() {
  if (!UPDATES_BUF) return;
  await supaPutJson('state/wx-updates-buf.json', { buf: UPDATES_BUF, at: Date.now() });
}
/** v9 双轮询器安全（本站网关 / 你的 Supabase 定时任务 / 手动「云端测试」同跑一个桶）：
 *  ① 轮询锁 state/wx-lock.json：别的 owner 50 秒内活跃 → 本轮直接让位（省重复 getupdates；
 *    owner 是进程级随机 id——同进程永不自堵，崩了靠 TTL 自然过期，接管 ≤50s + 下一轮触发）。
 *  ② 认领表 state/wx-claims.json：回复前先认领（3 分钟 TTL）——并发拉到同一批消息也只会回
 *    一次；回复失败立即释放（下一轮重试）；进程崩在半路由 TTL 过期兑底（最多延迟重试）。 */
var POLL_OWNER = (typeof CODE_SOURCE !== 'undefined' ? CODE_SOURCE : 'p') + '-' + String(Math.floor(Math.random() * 1e9)) + '-' + String(Date.now() % 1e6);
var WX_LOCK_TTL = 50000;
var WX_CLAIM_TTL = 180000;
function coreSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var WX_CLAIMS = null;
var WX_CLAIMS_AT = 0;
async function loadWxLock() {
  var l = await supaGetJson('state/wx-lock.json');
  return l && typeof l.at === 'number' && typeof l.owner === 'string' ? l : null;
}
async function writeWxLock() {
  await supaPutJson('state/wx-lock.json', { at: Date.now(), owner: POLL_OWNER });
}
async function loadWxClaims(force) {
  // v12 缓存 TTL 3s：长驻进程（内置网关）旧版一次加载后永不重读——云端定时任务/
  // 手动测试并发认领同一批消息时互相看不见，双回根因之一。3s 内复用，过期重读。
  if (!force && WX_CLAIMS && Date.now() - WX_CLAIMS_AT < 3000) return WX_CLAIMS;
  var c = await supaGetJson('state/wx-claims.json');
  WX_CLAIMS = c && c.ids && typeof c.ids === 'object' ? c.ids : {};
  WX_CLAIMS_AT = Date.now();
  return WX_CLAIMS;
}
async function writeWxClaim(id) {
  var cl = await loadWxClaims();
  cl[id] = Date.now();
  var ids = {};
  for (var k in cl) if (Date.now() - cl[k] < 1800000) ids[k] = cl[k];
  WX_CLAIMS = ids;
  await supaPutJson('state/wx-claims.json', { ids: ids });
}
async function clearWxClaim(id) {
  var cl = await loadWxClaims();
  if (!(id in cl)) return;
  delete cl[id];
  WX_CLAIMS = cl;
  await supaPutJson('state/wx-claims.json', { ids: cl });
}
function wxClaimFresh(id) {
  if (!WX_CLAIMS || !id) return false;
  var t = WX_CLAIMS[id];
  return typeof t === 'number' && Date.now() - t < WX_CLAIM_TTL;
}

async function markWxSeen(id) {
  if (!id) return;
  WX_SEEN = (WX_SEEN || []).concat([String(id)]).slice(-60);
  await supaPutJson('state/wx-seen.json', { ids: WX_SEEN, updatedAt: Date.now() });
}
function wxSeenHas(id) {
  if (!id || !WX_SEEN) return false;
  return WX_SEEN.indexOf(String(id)) >= 0;
}

/** v11 QQ 认领表（state/qq-claims.json）：QQ 消息回复前先认领（3 分钟 TTL，失败即释）。
 *  网关长连接 / 云端 cron-cycle WS / Webhook / 断线 Resume 后平台补发，同一条事件
 *  从几条路都能再进一次——只有认领到的那一方回复，其余跳过（旧版「回复两三遍」根因）。
 *  与微信 wx-claims 同构：进程崩在半路由 TTL 过期兑底（最多延迟重试一次）。 */
var QQ_CLAIM_TTL = 180000;
var QQ_CLAIMS = null;
var QQ_CLAIMS_AT = 0;
async function loadQqClaims(force) {
  // v12 缓存 TTL 3s（同 loadWxClaims）：长驻网关/云端函数并发持有同一条 QQ 事件时，
  // 认领表必须近实时互通——旧版永不重读，网关与云端各认各的 → 同一条消息两边都回。
  if (!force && QQ_CLAIMS && Date.now() - QQ_CLAIMS_AT < 3000) return QQ_CLAIMS;
  var c = await supaGetJson('state/qq-claims.json');
  QQ_CLAIMS = c && c.ids && typeof c.ids === 'object' ? c.ids : {};
  QQ_CLAIMS_AT = Date.now();
  return QQ_CLAIMS;
}
async function writeQqClaim(id) {
  var ts = Date.now();
  var cl = await loadQqClaims(false);
  cl[id] = ts;
  var ids = {};
  for (var k in cl) if (Date.now() - cl[k] < 1800000) ids[k] = cl[k];
  QQ_CLAIMS = ids;
  QQ_CLAIMS_AT = Date.now();
  await supaPutJson('state/qq-claims.json', { ids: ids });
  return ts;
}
async function clearQqClaim(id) {
  var cl = await loadQqClaims();
  if (!(id in cl)) return;
  delete cl[id];
  QQ_CLAIMS = cl;
  await supaPutJson('state/qq-claims.json', { ids: cl });
}
function qqClaimFresh(id) {
  if (!QQ_CLAIMS || !id) return false;
  var t = QQ_CLAIMS[id];
  return typeof t === 'number' && Date.now() - t < QQ_CLAIM_TTL;
}

async function ilinkCall(path, botToken, body, timeoutMs) {
  var r = await fetch(ILINK_HOST + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + botToken,
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': wxUin(),
      'iLink-App-Id': 'bot',
      'iLink-App-ClientVersion': String(132106),
    },
    body: JSON.stringify(body || {}),
    // v8：原来没有超时——上游挂起会把整条微信轮询循环卡死（后续消息全不回，「AI 不回信息」根因之一）。
    // getupdates 服务端长轮询挂 ~35s，窗口留到 50s；其余短调用同窗不影响。
    // v16：timeoutMs 可选参数——tickFast 传 9s（10 秒轮询档的短窗，超窗=本轮空手，认领表兑底）。
    signal: AbortSignal.timeout(Number(timeoutMs) || 50000),
  });
  var j = null;
  try { j = await r.json(); } catch (e) { /* 保留 null */ }
  if (!r.ok || (j && typeof j.error_code === 'number' && j.error_code !== 0 && j.error_code !== -1 && path.indexOf('getupdates') < 0)) {
    throw new Error('iLink ' + path + ' 失败 ' + r.status);
  }
  return j || {};
}

/** LLM：OpenAI 兼容 chat/completions（非流式），跟随手机 App「API 设置」 */
function llmCandidates(baseUrl) {
  var b = String(baseUrl || '').replace(/\/+$/, '');
  if (!b) return [];
  if (/\/chat\/completions$/.test(b)) return [b];
  if (/\/v\d+$/.test(b)) return [b + '/chat/completions'];
  return [b + '/v1/chat/completions', b + '/chat/completions'];
}

async function callLlm(cfg, messages) {
  var llm = cfg.llm || {};
  var cands = llmCandidates(llm.baseUrl);
  var lastErr = '未配置模型 API（在手机 App 设置 → API 设置里填写后重新同步）';
  for (var i = 0; i < cands.length; i++) {
    try {
      var r = await fetch(cands[i], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: llm.apiKey ? 'Bearer ' + llm.apiKey : '',
        },
        // v14：500 → 2400——机主定调连发 3~30 条后，旧 500 token 上限会把长连发在半路截断
        // （真机上「只回一两条就停」的原因之一）；30 条短消息 + 深度思考块约需 1500~2000 token。
        body: JSON.stringify({ model: llm.model || 'gpt-4o-mini', messages: messages, max_tokens: 2400 }),
        // v8：原来没有超时——模型 API 挂起时整条收发循环被拖死（消息永远不回）；75s 与
        // /api/chat 的非流式窗口对齐，超时进 lastErr，外层 handleWxMsg 的重试链路接着兑
        signal: AbortSignal.timeout(75000),
      });
      if (!r.ok) { lastErr = 'LLM ' + r.status; continue; }
      var j = await r.json();
      var text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (typeof text === 'string' && text.trim()) return text.trim();
      lastErr = 'LLM 空回复';
    } catch (e) { lastErr = String(e); }
  }
  throw new Error(lastErr);
}

function extractText(msg) {
  var list = (msg && msg.item_list) || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].type === 1 && list[i].text_item && typeof list[i].text_item.text === 'string') {
      return list[i].text_item.text.trim();
    }
  }
  // v23 入站语音：iLink 语音消息自带官方转写文本（voice_item.text）——直接当正文用，
  // AI 真正听懂真机语音；没带转写的退占位（与图片占位同口径）。
  for (var v3 = 0; v3 < list.length; v3++) {
    if (list[v3] && list[v3].type === 3 && list[v3].voice_item) {
      var vt = String(list[v3].voice_item.text || '').trim();
      if (vt) return vt;
      return '（对方发了一条语音，没有转写文本）';
    }
  }
  // 入站图片/表情包（type 2，CDN 加密）：v23 起网关在线时会真下载解密识图（见 handleWxMsg），
  // 拿不到描述时退占位让 AI 按语境回应（不整条丢弃）
  for (var k = 0; k < list.length; k++) {
    if (list[k] && list[k].type === 2) return '（对方发了一个表情包/图片，内容看不到）';
  }
  return '';
}

/** v23 入站图片项提取（item_list type 2 → image_item；微信一条消息一个 item）。
 *  返回 image_item（含 media/aeskey/url 等）或 null。 */
function extractWxImage(msg) {
  try {
    var list = (msg && msg.item_list) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].type === 2 && list[i].image_item) return list[i].image_item;
    }
  } catch (e) { /* 防御式 */ }
  return null;
}

// ---- 真机微信出站净化（iLink 通道只能发文字；v4：大表情标记 → 经典表情代码） ----
// 根因（用户实拍）：云端人设沿用了站内微信的 [表情包:ID] 习惯（历史/人设教学带进去的），
// iLink 通道发不了图 → 标记以裸文字出现在真机微信上。提示词拦不住，发送边界确定性转换。
// 转换规则：去 ID 前缀后名字在经典表情清单内 → [名字]（真机微信客户端把该文本渲染成真
// 表情，AI 等于真会发表情）；不在清单 → 剩除；净空 → 颜文字兑底（不空消息）。
var WX_CLASSIC = ('微笑,撇嘴,色,发呆,得意,流泪,害羞,闭嘴,睡,大哭,尴尬,发怒,调皮,呲牙,惊讶,难过,囧,抓狂,吐,偷笑,愉快,白眼,傲慢,困,惊恐,憨笑,悠闲,咒骂,疑问,嘘,晕,衰,骷髅,敲打,再见,擦汗,抠鼻,鼓掌,坏笑,右哼哼,鄙视,委屈,快哭了,阴险,亲亲,可怜,笑脸,生病,脸红,破涕为笑,恐惧,失望,无语,嘿哈,捂脸,奸笑,机智,皱眉,耶,吃瓜,加油,汗,天啊,Emm,社会社会,旺柴,好的,打脸,哇,翻白眼,666,让我看看,叹气,苦涩,裂开,嘴唇,爱心,心碎,拥抱,强,弱,握手,胜利,抱拳,勾引,拳头,OK,合十,猪头,便便,月亮,太阳,庆祝,红包,發,福,烟花,爆竹,礼物,跳跳,发抖,转圈,啤酒,咖啡,蛋糕,玫瑰,凋谢,菜刀,炸弹').split(',');
var WX_CLASSIC_SET = {};
for (var wci = 0; wci < WX_CLASSIC.length; wci++) WX_CLASSIC_SET[WX_CLASSIC[wci]] = 1;
var WX_EMOJI_FALLBACKS = ['(¬‿¬)', '(๑•̀ㅂ•́)و✧', '٩(˃ᴗ˂)۶', '(っ˘ω˘ς)'];
var WX_MSG_ERR = '';
var WX_MSG_ERR_AT = 0;
/** 表情/媒体标记 → 经典表情代码：名字直选；v13 ID 解析（站内清单教 [表情包:ID]——运行包
 *  带 stickerMap: ID→意思，命中意思再映射经典表情；都不在清单 → 剥除（这条通道发不了图）） */
function wxStickerToClassic(cfg, rawName) {
  var name = String(rawName || '').trim().replace(/^(?:wwb|wxb|qqb|wx|qq|mt|wb)-/i, '').trim();
  if (WX_CLASSIC_SET[name]) return '[' + name + ']';
  var map = (cfg && cfg.wechat && cfg.wechat.stickerMap) || {};
  var byId = map[String(rawName || '').trim()] || map[name];
  if (byId) {
    byId = String(byId).split(/[，,。.、\s]/)[0].slice(0, 12);
    if (WX_CLASSIC_SET[byId]) return '[' + byId + ']';
  }
  return '';
}
function sanitizeWxOutText(cfg, text) {
  var tagRe = /[\[【]\s*(?:发送了|发出了)?\s*(?:表情包|表情|图片|照片|语音|贴纸|Sticker)\s*[:：]\s*([^\]】]{1,24})\s*[\]】]/g;
  var out = String(text || '').replace(tagRe, function (_all, rawName) { return wxStickerToClassic(cfg, rawName); });
  out = stripRichMarkers(out);
  out = out.replace(/\n{3,}/g, '\n\n').replace(/^[\s\n]+|[\s\n]+$/g, '').replace(/^[，,。.\s]+/, '');
  if (out) return out;
  return WX_EMOJI_FALLBACKS[Math.floor(Math.random() * WX_EMOJI_FALLBACKS.length)];
}

// ---- v14 真机微信发真表情包（官方 iLink 媒体协议：AES-128-ECB 加密 → getuploadurl
//      预签名 → CDN 上传 → image_item 发送；字段与 @tencent-weixin/openclaw-weixin SDK 对齐） ----
// 机主定调「网站里内置的表情包真机微信也要能发」。iLink 通道除了文字还支持图片消息
// （item_list type 2），站内表情面板全量随包上云（emoticons.json 的 wechat 段），
// AI 输出 [表情包:ID/名字] → 云端把那张图真发出去；任一步失败降级经典表情代码文字。

/** 微信表情包运行包（emoticons.json：{ wechat: [{name, id, dataUrl}] }，站内微信面板全量）。
 *  与 config.json 分文件存：config.json 有 800KB 上传单文件上限，表情图单独一份不挤占；
 *  旧运行包没有这个文件 → 空表（[表情包:ID] 走 stickerMap→经典表情的旧降级路径）。
 *  v18：网关运行时本地全量注入（LOCAL_EMOTICONS）与云端文件合并——本地优先、云端补充，
 *  Storage 受限/旧包时网关通道不再受影响。 */
var WX_EMOTI = null;
var WX_EMOTI_AT = 0;
async function loadWxEmoticons() {
  if (WX_EMOTI && Date.now() - WX_EMOTI_AT < 60000) return WX_EMOTI;
  var j = null;
  try { j = await supaGetJson('emoticons.json'); } catch (e) { j = null; }
  var remote = (j && Array.isArray(j.wechat)) ? j.wechat : [];
  // v20：本地直推的表情包文件（用户收藏 + 站内面板全量）并入云端远端源——内置包
  // （LOCAL_EMOTICONS，带 CDN url）优先，直推文件补用户收藏，云端旧文件兖底。
  var remoteAll = (LOCAL_EMOTICONS_FILE || []).concat(remote);
  WX_EMOTI = mergeEmoticons(LOCAL_EMOTICONS, remoteAll);
  if (!WX_EMOTI.length && !remoteAll.length) WX_EMOTI = [];
  WX_EMOTI_AT = Date.now();
  return WX_EMOTI;
}

/** 纯 JS MD5（getuploadurl 需要 rawfilemd5；Deno/Node/Bun 三端零依赖通用） */
function md5Hex(u8) {
  function rl(x, c) { return (x << c) | (x >>> (32 - c)); }
  function addx(a, b) {
    var l = (a & 0xffff) + (b & 0xffff);
    var m = (a >> 16) + (b >> 16) + (l >> 16);
    return (m << 16) | (l & 0xffff);
  }
  var S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  var K = [];
  for (var ki = 0; ki < 64; ki++) K[ki] = Math.floor(Math.abs(Math.sin(ki + 1)) * 4294967296);
  var len = u8.length;
  var buf = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  buf.set(u8);
  buf[len] = 0x80;
  var bitLen = len * 8;
  buf[buf.length - 8] = bitLen & 0xff;
  buf[buf.length - 7] = (bitLen >>> 8) & 0xff;
  buf[buf.length - 6] = (bitLen >>> 16) & 0xff;
  buf[buf.length - 5] = (bitLen >>> 24) & 0xff;
  var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476;
  for (var off = 0; off < buf.length; off += 64) {
    var M = [];
    for (var w = 0; w < 16; w++) {
      var p = off + w * 4;
      M[w] = (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) | 0;
    }
    var a = h0, b = h1, c = h2, d = h3;
    for (var i2 = 0; i2 < 64; i2++) {
      var F, g;
      if (i2 < 16) { F = (b & c) | (~b & d); g = i2; }
      else if (i2 < 32) { F = (d & b) | (~d & c); g = (5 * i2 + 1) % 16; }
      else if (i2 < 48) { F = b ^ c ^ d; g = (3 * i2 + 5) % 16; }
      else { F = c ^ (b | ~d); g = (7 * i2) % 16; }
      var nB = addx(b, rl(addx(addx(addx(a, F), K[i2]), M[g]), S[i2]));
      a = d; d = c; c = b; b = nB;
    }
    h0 = addx(h0, a); h1 = addx(h1, b); h2 = addx(h2, c); h3 = addx(h3, d);
  }
  function hexLE(n) {
    var s = '';
    for (var bt = 0; bt < 4; bt++) {
      var by = (n >>> (bt * 8)) & 0xff;
      s += (by < 16 ? '0' : '') + by.toString(16);
    }
    return s;
  }
  return hexLE(h0) + hexLE(h1) + hexLE(h2) + hexLE(h3);
}

/** 纯 JS AES-128（CDN 上传用 AES-128-ECB + PKCS7；WebCrypto 不支持 ECB，三端零依赖实现） */
var AES_SBOX = (function () {
  function gfMul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p & 0xff;
  }
  var box = new Uint8Array(256);
  for (var x = 0; x < 256; x++) {
    var inv = 0;
    if (x !== 0) {
      inv = 1;
      var base = x, e = 254;
      while (e > 0) {
        if (e & 1) inv = gfMul(inv, base);
        base = gfMul(base, base);
        e >>= 1;
      }
    }
    var rot = function (v, n) { return ((v << n) | (v >>> (8 - n))) & 0xff; };
    box[x] = (inv ^ rot(inv, 1) ^ rot(inv, 2) ^ rot(inv, 3) ^ rot(inv, 4) ^ 0x63) & 0xff;
  }
  return box;
})();
function gfMul2(a, b) {
  var p = 0;
  for (var i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    var hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p & 0xff;
}
function aes128ExpandKey(key) {
  var rk = new Uint8Array(176);
  for (var i = 0; i < 16; i++) rk[i] = key[i];
  var rcon = 1;
  for (var w = 4; w < 44; w++) {
    var b0 = rk[4 * (w - 1)], b1 = rk[4 * (w - 1) + 1], b2 = rk[4 * (w - 1) + 2], b3 = rk[4 * (w - 1) + 3];
    if (w % 4 === 0) {
      var tmp = b0;
      b0 = AES_SBOX[b1];
      b1 = AES_SBOX[b2];
      b2 = AES_SBOX[b3];
      b3 = AES_SBOX[tmp];
      b0 ^= rcon;
      rcon = gfMul2(rcon, 2);
    }
    rk[4 * w] = rk[4 * (w - 4)] ^ b0;
    rk[4 * w + 1] = rk[4 * (w - 4) + 1] ^ b1;
    rk[4 * w + 2] = rk[4 * (w - 4) + 2] ^ b2;
    rk[4 * w + 3] = rk[4 * (w - 4) + 3] ^ b3;
  }
  return rk;
}
function aes128EncryptBlock(block, rk) {
  var s = new Uint8Array(16);
  for (var i = 0; i < 16; i++) s[i] = block[i] ^ rk[i];
  for (var rnd = 1; rnd <= 10; rnd++) {
    for (var i2 = 0; i2 < 16; i2++) s[i2] = AES_SBOX[s[i2]];
    var t = new Uint8Array(16);
    for (var r = 0; r < 4; r++) {
      for (var cc = 0; cc < 4; cc++) t[r + 4 * cc] = s[r + 4 * ((cc + r) % 4)];
    }
    s = t;
    if (rnd < 10) {
      var u = new Uint8Array(16);
      for (var c2 = 0; c2 < 4; c2++) {
        var a0 = s[4 * c2], a1 = s[4 * c2 + 1], a2 = s[4 * c2 + 2], a3 = s[4 * c2 + 3];
        u[4 * c2] = gfMul2(a0, 2) ^ gfMul2(a1, 3) ^ a2 ^ a3;
        u[4 * c2 + 1] = a0 ^ gfMul2(a1, 2) ^ gfMul2(a2, 3) ^ a3;
        u[4 * c2 + 2] = a0 ^ a1 ^ gfMul2(a2, 2) ^ gfMul2(a3, 3);
        u[4 * c2 + 3] = gfMul2(a0, 3) ^ a1 ^ a2 ^ gfMul2(a3, 2);
      }
      s = u;
    }
    for (var i3 = 0; i3 < 16; i3++) s[i3] ^= rk[rnd * 16 + i3];
  }
  return s;
}
function aesEcbEncrypt(u8, key) {
  var padLen = 16 - (u8.length % 16);
  var padded = new Uint8Array(u8.length + padLen);
  padded.set(u8);
  for (var i = u8.length; i < padded.length; i++) padded[i] = padLen;
  var rk = aes128ExpandKey(key);
  var out = new Uint8Array(padded.length);
  for (var off = 0; off < padded.length; off += 16) {
    out.set(aes128EncryptBlock(padded.subarray(off, off + 16), rk), off);
  }
  return out;
}

/** v23 AES-128-ECB 解密（入站图片：CDN 下载的密文 → 明文；PKCS7 剥除）。
 *  逆变换与上方加密器同字节序（index = row + 4*col）：AddRoundKey(10) → [InvShiftRows →
 *  InvSubBytes → AddRoundKey(rnd) → InvMixColumns]×rnd9..1 → InvShiftRows → InvSubBytes → AddRoundKey(0) */
var AES_INV_SBOX = (function () {
  var t = new Uint8Array(256);
  for (var i = 0; i < 256; i++) t[AES_SBOX[i]] = i;
  return t;
})();
function aes128DecryptBlock(block, rk) {
  var s = new Uint8Array(16);
  for (var i0 = 0; i0 < 16; i0++) s[i0] = block[i0] ^ rk[160 + i0];
  for (var rnd = 9; rnd >= 1; rnd--) {
    // InvShiftRows：行 r 右移 r（逆于加密的左移）
    var t = new Uint8Array(16);
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) t[r + 4 * c] = s[r + 4 * ((c - r + 4) % 4)];
    }
    s = t;
    // InvSubBytes
    for (var j = 0; j < 16; j++) s[j] = AES_INV_SBOX[s[j]];
    // AddRoundKey(rnd)
    for (var k = 0; k < 16; k++) s[k] ^= rk[rnd * 16 + k];
    // InvMixColumns（矩阵 [14,11,13,9; 9,14,11,13; 13,9,14,11; 11,13,9,14]）
    var u = new Uint8Array(16);
    for (var c2 = 0; c2 < 4; c2++) {
      var a0 = s[4 * c2], a1 = s[4 * c2 + 1], a2 = s[4 * c2 + 2], a3 = s[4 * c2 + 3];
      u[4 * c2] = gfMul2(a0, 14) ^ gfMul2(a1, 11) ^ gfMul2(a2, 13) ^ gfMul2(a3, 9);
      u[4 * c2 + 1] = gfMul2(a0, 9) ^ gfMul2(a1, 14) ^ gfMul2(a2, 11) ^ gfMul2(a3, 13);
      u[4 * c2 + 2] = gfMul2(a0, 13) ^ gfMul2(a1, 9) ^ gfMul2(a2, 14) ^ gfMul2(a3, 11);
      u[4 * c2 + 3] = gfMul2(a0, 11) ^ gfMul2(a1, 13) ^ gfMul2(a2, 9) ^ gfMul2(a3, 14);
    }
    s = u;
  }
  var t2 = new Uint8Array(16);
  for (var r2 = 0; r2 < 4; r2++) {
    for (var c3 = 0; c3 < 4; c3++) t2[r2 + 4 * c3] = s[r2 + 4 * ((c3 - r2 + 4) % 4)];
  }
  s = t2;
  for (var j2 = 0; j2 < 16; j2++) s[j2] = AES_INV_SBOX[s[j2]];
  for (var k2 = 0; k2 < 16; k2++) s[k2] ^= rk[k2];
  return s;
}
function aesEcbDecrypt(u8, key) {
  if (!u8 || !u8.length || u8.length % 16 !== 0 || u8.length > 16 * 1024 * 1024) return null;
  try {
    var rk = aes128ExpandKey(key);
    var out = new Uint8Array(u8.length);
    for (var off = 0; off < u8.length; off += 16) {
      out.set(aes128DecryptBlock(u8.subarray(off, off + 16), rk), off);
    }
    var pad = out[out.length - 1];
    if (pad > 0 && pad <= 16 && out.length >= pad) {
      var ok = true;
      for (var p = out.length - pad; p < out.length; p++) if (out[p] !== pad) { ok = false; break; }
      if (ok) return out.subarray(0, out.length - pad);
    }
    return out;
  } catch (e) { return null; }
}
function cloudRandomBytes(n) {
  var u8 = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(u8);
  else for (var i = 0; i < n; i++) u8[i] = Math.floor(Math.random() * 256);
  return u8;
}
function cloudBytesToHex(u8) {
  var s = '';
  for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
  return s;
}
function cloudBytesToB64(u8) {
  var bin = '';
  for (var i = 0; i < u8.length; i += 32768) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
  return (typeof btoa === 'function') ? btoa(bin) : Buffer.from(u8).toString('base64');
}
function cloudB64ToBytes(b64) {
  var bin = (typeof atob === 'function') ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  var u8 = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 0xff;
  return u8;
}

/** 官方 CDN 域名（SDK 常量：novac2c.cdn.weixin.qq.com/c2c） */
var WX_CDN_BASE = 'https://novac2c.cdn.weixin.qq.com/c2c';

/** v14 上传一张表情图：AES-128-ECB 加密 → getuploadurl 预签名 → POST 密文到 CDN →
 *  读响应头 x-encrypted-param（下载参数）。任一步失败返回 null（调用方降级经典表情）。 */
async function wxUploadStickerImage(cfg, toUserId, dataUrl) {
  try {
    var b64 = String(dataUrl || '').split(',')[1] || '';
    if (!b64) return null;
    var bytes = cloudB64ToBytes(b64);
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) return null;
    var rawfilemd5 = md5Hex(bytes);
    var filekey = cloudBytesToHex(cloudRandomBytes(16));
    var aesKey = cloudRandomBytes(16);
    var ciphertext = aesEcbEncrypt(bytes, aesKey);
    var up = await ilinkCall('/ilink/bot/getuploadurl', cfg.wechat.botToken, {
      filekey: filekey,
      media_type: 1,
      to_user_id: toUserId,
      rawsize: bytes.length,
      rawfilemd5: rawfilemd5,
      filesize: ciphertext.length,
      no_need_thumb: true,
      aeskey: cloudBytesToHex(aesKey),
      base_info: BASE_INFO,
    });
    var full = String((up && up.upload_full_url) || '').trim();
    var param = String((up && up.upload_param) || '').trim();
    if (!full && !param) return null;
    var cdnUrl = full || (WX_CDN_BASE + '/upload?encrypted_query_param=' + encodeURIComponent(param) + '&filekey=' + encodeURIComponent(filekey));
    var r = await fetch(cdnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: ciphertext,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return null;
    var dl = r.headers.get('x-encrypted-param');
    if (!dl) return null;
    // v19 aes_key 编码根修：官方 SDK（@tencent-weixin/openclaw-weixin sendImageMessageWeixin）
    // 发的是 base64(hex 字符串)（UploadedFileInfo.aeskey 是 hex 文本，Buffer.from(hex文本)
    // .toString('base64')）——旧版发 base64(原始 16 字节)，上传与消息全部成功、唯独接收端解
    // 不开密文 → 气泡灰块 + 点开「图片已过期或已被清理」（用户实测根因）。对齐官方。
    var hexKey = cloudBytesToHex(aesKey);
    var aesB64 = (typeof btoa === 'function') ? btoa(hexKey) : Buffer.from(hexKey).toString('base64');
    return { dl: dl, midSize: ciphertext.length, aesB64: aesB64 };
  } catch (e) { return null; }
}

/** v14 发一条图片消息（item_list type 2 image_item，字段与官方 SDK sendImageMessageWeixin 对齐：
 *  media.encrypt_query_param + media.aes_key(base64) + media.encrypt_type 1 + mid_size 密文大小） */
async function wxSendSticker(cfg, toUserId, contextToken, dataUrl) {
  var up = await wxUploadStickerImage(cfg, toUserId, dataUrl);
  if (!up) return false;
  await ilinkCall('/ilink/bot/sendmessage', cfg.wechat.botToken, {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: Date.now() + '-' + Math.random().toString(36).slice(2),
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{ type: 2, image_item: { media: { encrypt_query_param: up.dl, aes_key: up.aesB64, encrypt_type: 1 }, mid_size: up.midSize } }],
    },
    base_info: BASE_INFO,
  });
  return true;
}

/** v23 上传一个语音文件（silk 字节；getuploadurl media_type=4=VOICE，同图片加密链）。
 *  返回 { dl, midSize, aesB64 } 或 null（任一步失败调用方降级文字）。 */
async function wxUploadVoiceFile(cfg, toUserId, silkBytes) {
  try {
    if (!silkBytes || !silkBytes.length || silkBytes.length > 2 * 1024 * 1024) return null;
    var rawfilemd5 = md5Hex(silkBytes);
    var filekey = cloudBytesToHex(cloudRandomBytes(16));
    var aesKey = cloudRandomBytes(16);
    var ciphertext = aesEcbEncrypt(silkBytes, aesKey);
    var up = await ilinkCall('/ilink/bot/getuploadurl', cfg.wechat.botToken, {
      filekey: filekey,
      media_type: 4,
      to_user_id: toUserId,
      rawsize: silkBytes.length,
      rawfilemd5: rawfilemd5,
      filesize: ciphertext.length,
      no_need_thumb: true,
      aeskey: cloudBytesToHex(aesKey),
      base_info: BASE_INFO,
    });
    var full = String((up && up.upload_full_url) || '').trim();
    var param = String((up && up.upload_param) || '').trim();
    if (!full && !param) return null;
    var cdnUrl = full || (WX_CDN_BASE + '/upload?encrypted_query_param=' + encodeURIComponent(param) + '&filekey=' + encodeURIComponent(filekey));
    var r = await fetch(cdnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: ciphertext,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return null;
    var dl = r.headers.get('x-encrypted-param');
    if (!dl) return null;
    var hexKey = cloudBytesToHex(aesKey);
    var aesB64 = (typeof btoa === 'function') ? btoa(hexKey) : Buffer.from(hexKey).toString('base64');
    return { dl: dl, midSize: ciphertext.length, aesB64: aesB64 };
  } catch (e) { return null; }
}

/** v23 发一条语音消息（item_list type 3 voice_item：encode_type 6=silk + playtime +
 *  sample_rate；media 同图片加密链）。失败返回 false（调用方降级文字）。 */
async function wxSendVoice(cfg, toUserId, contextToken, silk, playtimeMs, sampleRate) {
  var up = await wxUploadVoiceFile(cfg, toUserId, silk);
  if (!up) return false;
  await ilinkCall('/ilink/bot/sendmessage', cfg.wechat.botToken, {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: Date.now() + '-' + Math.random().toString(36).slice(2),
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{
        type: 3,
        voice_item: {
          media: { encrypt_query_param: up.dl, aes_key: up.aesB64, encrypt_type: 1 },
          encode_type: 6,
          playtime: Math.max(500, Math.round(playtimeMs || 1000)),
          sample_rate: Number(sampleRate) || 24000,
          bits_per_sample: 16,
        },
      }],
    },
    base_info: BASE_INFO,
  });
  return true;
}

// ---- v13 连发/世界书/引用/深度思考（真机回复与网站同源：机主定调「网站上怎么回复的，
//      真机微信/QQ 就怎么回复的」） ----

/** 深度思考块剥除（[思考]…[/思考]）：站内开启深度思考时模型先输出思考链，真机只发正文 */
function stripThinkBlocks(text) {
  var t = String(text || '');
  t = t.replace(/\[思考\][\s\S]*?\[\/思考\]/g, '');
  t = t.replace(/【思考】[\s\S]*?【\/思考】/g, '');
  t = t.replace(/\[(?:\/)?思考\]/g, '').replace(/【(?:\/)?思考】/g, '');
  return t;
}

/** 首尾空白 + 不可见占位字符剥除（与站内 trimBlank 同口径） */
var CLOUD_BLANK_RE_H = /^[\s\u200B\u200C\u200D\u200E\u200F\u2060\u2800\u3164\uFFA0]+/;
var CLOUD_BLANK_RE_T = /[\s\u200B\u200C\u200D\u200E\u200F\u2060\u2800\u3164\uFFA0]+$/;
function cloudTrim(s) {
  return String(s || '').replace(CLOUD_BLANK_RE_H, '').replace(CLOUD_BLANK_RE_T, '');
}

/** 站内富媒体动作标记（真机通道兑现不了的指令）剥除：红包/转账/亲属卡/位置/歌曲/通话/照片/头像/朋友圈/手机操作…
 *  剥除后空掉的行由连发切分自然滤掉（不会发空消息）；[表情包:ID] 两通道各自在前置环节解析；
 *  v16：语音词仍保留——[语音:内容] 已在 collectVoiceMarkers 先行切走，这里只兜漏网的残标 */
var CLOUD_MARK_RE = /[\[【]\s*(?:领取红包|收款转账|生成新头像|发朋友圈|手机操作|选图发送|语音通话|视频通话|分享歌曲|亲属卡|红包|转账|位置|拍一拍|点播|歌曲|照片|图片|语音|回忆提示)\s*[:：][^\]】]{0,160}[\]】]/g;
function stripRichMarkers(text) {
  return String(text || '').replace(CLOUD_MARK_RE, '');
}

/** v16 QQ 出站净化：经典表情文字代码（[流泪][裂开][微笑]…）在真机 QQ 的机器人通道上
 *  不会渲染成表情（用户实测：以裸文字出现）。QQ 侧出站一律剥掉这些代码，句子其余部分照发；
 *  想发图就按表情包清单走 [表情包:ID]。微信通道不剥（微信客户端会把这些代码渲染成真表情）。 */
function qqStripClassicCodes(text) {
  var t = String(text || '');
  if (t.indexOf('[') < 0 && t.indexOf('【') < 0) return t;
  return t.replace(/[\[【]\s*([^\]】]{1,12})\s*[\]】]/g, function (_all, name) {
    return WX_CLASSIC_SET[String(name || '').trim()] ? '' : _all;
  });
}

/** v16 QQ 语音条标记：AI 输出 [语音:想说的话]（单独占一行）→ 云端合成真语音条发出。
 *  旧版唯一的语音机制是「每 N 条命中一次」的静默升级——对方明确要语音时 AI 只能口头答应
 *  （「我给你发条语音」）却没有任何动作可做，说「卡在发送那一步」就是这么来的。
 *  返回 { text:剩余正文, clips:[语音内容] }（最多 2 条，超长内容发送侧再按句界切）。 */
var CLOUD_VOICE_RE = /[\[【]\s*(?:语音|发语音|发条语音|语音条|语音说|说)\s*[:：]\s*([^\]】]{1,300})\s*[\]】]/g;
function collectVoiceMarkers(text) {
  var t = String(text || '');
  var clips = [];
  CLOUD_VOICE_RE.lastIndex = 0;
  var out = t.replace(CLOUD_VOICE_RE, function (_all, c) {
    var s = String(c || '').trim();
    if (s && clips.length < 2) clips.push(s);
    return '\n';
  });
  return { text: out, clips: clips };
}

/** v16 对方明确要语音（QQ）：「发条语音/来条语音/说给我听/用语音回/语音说」——命中时该轮
 *  强制升级语音条（不再依赖每 N 条的计数器；合成不可用时维持文字兑底）。 */
var CLOUD_VOICE_ASK_RE = /(发|来|给我|想|要|用|能不能|可以)?\s*(一?条|个)?\s*(语音|声音|录音)|(语音|声音)\s*(回复|说|回)|说给我听|听你声音|语音一下/;
function isVoiceRequested(text) {
  return CLOUD_VOICE_ASK_RE.test(String(text || '').slice(0, 400));
}

/** v16 连发兜底：运行包人设里没有连发指令块（旧包 / 未绑定角色的兑底人设）时，运行期补注入
 *  站内同款默认连发指令（机主定调 3~30 尽量多发）——真机「AI 只发一条」的兜底修复。 */
function ensureBurstRule(system, multi) {
  if (!multi) return system;
  if (String(system || '').indexOf('连发') >= 0) return system;
  return system + '\n【连发短消息】把你这次想说的话拆成一条一条的短消息连发，像真人一样一句一条：本次发 3~30 条（正常至少 3 条起步、目标尽量往多了发，只发一两条就停是不合格的），话少时可以少发但不要硬凑；每条只写一句口语化的短话，消息之间要有递进（回应→补充→追问），不要原地重复。';
}


/** 连发切分（站内 splitReplySegments(multi=true) 同口径）：&&& 标记 / 换行 / 句末标点为界；
 *  动作描写（*...*）独立成段（真机不显示星号）；连续重复丢弃；全员 ≤4 字碎句并成一条 */
var CLOUD_TINY_EXCLUDE = /[\[\]{}()（）【】*「」『』“”"']/;
function cloudIsTiny(s) {
  return s.length > 0 && !CLOUD_TINY_EXCLUDE.test(s) && s.length <= 4;
}
function cloudJoinTiny(a, b) {
  return /[。！？!?～〜]$/.test(a) ? a + b : a + '，' + b;
}
function cloudPushSeg(arr, raw) {
  var s = cloudTrim(String(raw || '').replace(/^[，,、；;：:]+/, '').replace(/[，,、；;：:]+$/, ''));
  if (s) arr.push(s);
}
function cloudBurstSegments(text) {
  var t = String(text || '');
  var pieces = [];
  var re = /\*([^*\n]{1,120})\*/g;
  var last = 0;
  var m = null;
  while ((m = re.exec(t)) !== null) {
    if (m.index > last) pieces.push({ act: false, text: t.slice(last, m.index) });
    pieces.push({ act: true, text: m[1] });
    last = m.index + m[0].length;
  }
  pieces.push({ act: false, text: t.slice(last) });
  var out = [];
  for (var ci = 0; ci < pieces.length; ci++) {
    var p = pieces[ci];
    if (p.act) {
      var act = cloudTrim(p.text);
      if (act) out.push(act);
      continue;
    }
    var bRe = /&{3,}|\n|[。！？!?～〜]+[”’"』」）)\]]*/g;
    var last2 = 0;
    var mm = null;
    while ((mm = bRe.exec(p.text)) !== null) {
      var end = mm.index + mm[0].length;
      var isSentence = mm[0] !== '\n' && mm[0].charAt(0) !== '&';
      cloudPushSeg(out, p.text.slice(last2, isSentence ? end : mm.index));
      last2 = end;
    }
    cloudPushSeg(out, p.text.slice(last2));
  }
  // 连续重复丢弃（不重复）
  var dedup = [];
  for (var di = 0; di < out.length; di++) {
    if (di === 0 || out[di] !== out[di - 1]) dedup.push(out[di]);
  }
  out = dedup;
  // 全员碎句合并（话少不拆）
  if (out.length > 1) {
    var allTiny = true;
    for (var ti = 0; ti < out.length; ti++) { if (!cloudIsTiny(out[ti])) { allTiny = false; break; } }
    if (allTiny) {
      var joined = out[0];
      for (var ji = 1; ji < out.length; ji++) joined = cloudJoinTiny(joined, out[ji]);
      out = [joined];
    }
  }
  return out;
}

/** 完整回复 → 连发消息段。multi（站内回复条数 > 1，运行包 multi 标志）按句界连发切分；
 *  单条模式（条数=1）只按 &&& 标记切（站内 splitReplySegments 同口径） */
function cloudReplySegments(text, multi) {
  var raw = String(text || '');
  if (!multi) {
    var out = [];
    var parts = raw.split(/&{3,}/);
    for (var i = 0; i < parts.length; i++) cloudPushSeg(out, parts[i]);
    return out;
  }
  return cloudBurstSegments(raw);
}

/** [引用:M编号] → 引用内容（站内 Task 30 引用机制的真机版：quoteMap 由编号历史构建）。
 *  编号命中 → 返回被引内容（截断 40 字），标记剥除；未命中 → 标记剥除；裸 [M数字] 一并剥掉 */
function extractQuote(reply, quoteMap) {
  var found = null;
  var out = String(reply || '').replace(/[\[【]\s*引用\s*[:：]\s*M\s*(\d{1,5})\s*[\]】]/g, function (_all, num) {
    var q = quoteMap ? quoteMap[String(num)] : null;
    if (q && !found) found = q;
    return '';
  });
  out = out.replace(/\[\s*M\s*\d{1,5}\s*\]/g, '');
  return { text: out, quote: found };
}

/** 世界书（运行包 cfg.<ch>.worldbook：[{name, g, entries:[{kw, c, p, pr, ic}]}]）→ 六位置块。
 *  与站内 collectWbBlocks 同口径：全局书常驻、局部/专属按触发词命中（扫描口径 = 来消息 + 最近历史）；
 *  按位置分组、同书内优先级降序；每本书独立包裹【世界设定开始/结束】；总预算内尽量保留 */
var CLOUD_WB_BUDGET = 6000;
var CLOUD_WB_RULES = '【世界设定使用规则】对话中【世界设定开始】与【世界设定结束】标记之间的内容是本次对话的世界设定，请遵守：1. 根据这些设定理解当前世界观、角色背景和关系；2. 设定与记忆、聊天记录冲突时以世界设定为准；3. 不要直接背诵设定内容，要自然地融入回复；4. 不要把设定当成对方说过的话；5. 不要在回复里暴露「这是设定」；6. 设定没提到的内容不要凭空编造。信息优先级：系统规则 > 世界书 > 人设 > 记忆 > 聊天记录 > 新消息，但对方的新消息永远第一时间回应。';
function collectCloudWb(wbList, scanText) {
  var buckets = { before_system: [], after_system: [], before_char: [], after_char: [], before_user: [], after_user: [] };
  if (!wbList || !wbList.length) return { bs: '', as: '', bc: '', ac: '', bu: '', au: '', rules: '' };
  var lower = String(scanText || '').toLowerCase();
  for (var bi = 0; bi < wbList.length; bi++) {
    var book = wbList[bi];
    if (!book || !book.entries || !book.entries.length) continue;
    var inBook = {};
    for (var ei = 0; ei < book.entries.length; ei++) {
      var e = book.entries[ei];
      if (!e || !e.c) continue;
      var hit = !!book.g;
      if (!hit && e.kw && e.kw.length) {
        for (var ki = 0; ki < e.kw.length; ki++) {
          var kw = String(e.kw[ki] || '');
          if (!kw) continue;
          if (lower.indexOf(e.ic ? kw.toLowerCase() : kw) >= 0) { hit = true; break; }
        }
      }
      if (!hit) continue;
      var pos = buckets[e.p] ? e.p : 'after_char';
      (inBook[pos] = inBook[pos] || []).push(e);
    }
    for (var pos in inBook) {
      if (!inBook[pos] || !inBook[pos].length) continue;
      inBook[pos].sort(function (a, b) { return (b.pr || 0) - (a.pr || 0); });
      var body = [];
      for (var ci = 0; ci < inBook[pos].length; ci++) body.push(String(inBook[pos][ci].c).trim());
      buckets[pos].push('【世界设定开始】\n《' + (book.name || '未命名世界书') + '》\n' + body.join('\n\n') + '\n【世界设定结束】');
    }
  }
  var out = { bs: '', as: '', bc: '', ac: '', bu: '', au: '', rules: '' };
  var order = ['before_system', 'after_system', 'before_char', 'after_char', 'before_user', 'after_user'];
  var keyOf = { before_system: 'bs', after_system: 'as', before_char: 'bc', after_char: 'ac', before_user: 'bu', after_user: 'au' };
  var used = 0;
  var any = false;
  for (var oi = 0; oi < order.length; oi++) {
    var list = buckets[order[oi]];
    if (!list || !list.length) continue;
    var joined = list.join('\n\n');
    if (used + joined.length > CLOUD_WB_BUDGET) continue;
    used += joined.length;
    out[keyOf[order[oi]]] = out[keyOf[order[oi]]] ? out[keyOf[order[oi]]] + '\n\n' + joined : joined;
    any = true;
  }
  if (any) out.rules = CLOUD_WB_RULES;
  return out;
}

/** 组装最终 system（站内 systemFull 的世界书部分同构：beforeSystem → [beforeChar 人设 afterChar] → afterSystem → 规则） */
function buildCloudSystem(base, wb) {
  var parts = [];
  if (wb.bs) parts.push(wb.bs);
  parts.push([wb.bc, base, wb.ac].filter(Boolean).join('\n\n'));
  if (wb.as) parts.push(wb.as);
  if (wb.rules) parts.push(wb.rules);
  return parts.filter(Boolean).join('\n\n');
}

/** 编号历史 + 包裹本轮用户消息（站内 [M数字] 门牌号同款）：AI 用 [引用:编号] 引用指定消息 */
function cloudNumbered(hist, content, wb) {
  var msgs = [];
  var quoteMap = {};
  for (var i = 0; i < hist.length; i++) {
    var c = String((hist[i] && hist[i].content) || '');
    if (!c) continue;
    quoteMap[String(i + 1)] = c.slice(0, 40);
    msgs.push({ role: hist[i].role, content: '[M' + (i + 1) + '] ' + c });
  }
  var userNo = msgs.length + 1;
  quoteMap[String(userNo)] = String(content || '').slice(0, 40);
  var wrapped = (wb && wb.bu ? wb.bu + '\n' : '') + '[M' + userNo + '] ' + String(content || '');
  if (wb && wb.au) wrapped += '\n' + wb.au;
  msgs.push({ role: 'user', content: wrapped });
  return { msgs: msgs, quoteMap: quoteMap };
}

async function sendWxText(cfg, toUserId, contextToken, text) {
  await ilinkCall('/ilink/bot/sendmessage', cfg.wechat.botToken, {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: Date.now() + '-' + Math.random().toString(36).slice(2),
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{ type: 1, text_item: { text: text.slice(0, 2000) } }],
    },
    base_info: BASE_INFO,
  });
}

/** 微信：处理一条来消息，返回是否成功回复。
 *  v4：①LLM 失败重试一次（原来一次失败消息就被静默丢弃，主人看到「ai不回信息」）；
 *  ②出站文本经 sanitizeWxOutText 净化（大表情标记→经典表情代码/剥除）；
 *  ③失败原因记入 WX_MSG_ERR（心跳/ping 可见——原来逐条失败完全不可见，无法排查） */
async function handleWxMsg(cfg, msg) {
  var text = extractText(msg);
  if (!text || !msg.from_user_id || !msg.context_token) return false;
  if (msg.from_user_id === cfg.wechat.botId) return false;
  // v23 入站图片识图（机主定调「真机收图 → base64 → vision 多模态 → 带图理解回复」）：
  // 网关在线（VLM_LOCAL_URL）时把 CDN 密文图下载解密 → base64 → z-ai 多模态转描述，
  // 占位盲区换成真内容（AI 真正看得到图）；失败/纯云端模式退占位（收发不受影响）
  if (text === '（对方发了一个表情包/图片，内容看不到）') {
    var wimg = extractWxImage(msg);
    if (wimg) {
      var wdesc = await describeWxImage(wimg);
      if (wdesc) text = '（对方发的图片内容：' + wdesc + '）';
    }
  }
  // v16 主动消息收件凭据：记住最近一次会话的 from_user_id + context_token（站内「主动发消息」
  // 引擎触发 send-active 时用；iLink 主动发送没有独立接口，只能复用会话上下文——新鲜度自管）
  noteWxLastCtx(msg.from_user_id, msg.context_token);
  // v12 真机微信「对方正在输入中…」：官方协议 status 1=开始输入（长操作每 5s 续一次保活）、
  // 2=结束输入。旧版用反了（回复前发 2=结束、回复后又不收尾）——真机微信上从来
  // 看不到「正在输入」。现在：取 ticket → 发 1 → LLM 期间每 5s 续 1 → 回复发完发 2 收尾。
  var typingTicket = '';
  var typingTimer = null;
  try {
    var c = await ilinkCall('/ilink/bot/getconfig', cfg.wechat.botToken, {
      ilink_user_id: msg.from_user_id, context_token: msg.context_token, base_info: BASE_INFO,
    });
    if (c && c.typing_ticket) typingTicket = String(c.typing_ticket);
  } catch (e) { /* 可选 */ }
  var sendTyping = function (st) {
    if (!typingTicket) return;
    ilinkCall('/ilink/bot/sendtyping', cfg.wechat.botToken, {
      ilink_user_id: msg.from_user_id, typing_ticket: typingTicket, status: st, base_info: BASE_INFO,
    }).catch(function () {});
  };
  var stopTypingLight = function () {
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
    sendTyping(2);
  };
  if (typingTicket) {
    sendTyping(1);
    typingTimer = setInterval(function () { sendTyping(1); }, 5000);
  }
  try {
    var hist = await loadWxHistory(false);
    // v5 历史种子：云端还没存过历史时用运行包里打包的网站聊天最近 20 条（云端冷启动
    // 不失忆——回复内容与手机 App 聊天同源连续，用户反馈「网站上怎么回复的微信就怎么回」）
    if ((!hist || !hist.length) && cfg.wechat && Array.isArray(cfg.wechat.history) && cfg.wechat.history.length) {
      hist = cfg.wechat.history.slice(-20);
      HIST_WX = hist;
    }
    // v15 入站引用：对方在真机上「引用」旧消息回复时被引内容进 LLM 上下文（历史仍存原文）
    var inQuote = extractInboundQuote(msg);
    var llmText = inQuote ? text + '\n（系统提示：对方这条消息是引用回复——被TA引用的原消息是：「' + inQuote + '」，结合被引内容理解TA的意思）' : text;
    // v13 世界书（运行包打包的挂载书：全局常驻 + 触发词命中，扫描口径 = 来消息 + 最近 8 条历史）
    var scanParts = [text];
    for (var wsi = Math.max(0, hist.length - 8); wsi < hist.length; wsi++) {
      if (hist[wsi] && hist[wsi].content) scanParts.push(hist[wsi].content);
    }
    var wb = collectCloudWb(cfg.wechat.worldbook, scanParts.join('\n'));
    // v16 连发兑底：旧运行包/未绑定人设里没有连发指令块时运行期补注入（真机「只发一条」的兑底）
    var system = buildCloudSystem(ensureBurstRule((cfg.wechat.persona && cfg.wechat.persona.system) || '你和主人在真实微信上聊天，回复简短自然，绝不透露自己是AI。', cfg.wechat.multi !== false), wb);
    // v14 兑底表情包清单：站内组装器人设自带【表情包清单】时不再重复注入——只有兑底人设
    // （没绑角色/旧运行包）才给这份精简清单教学（现在微信也能发真图，与 QQ 同款「必须发」约束）
    var wxEmoList = await loadWxEmoticons();
    if (wxEmoList.length && system.indexOf('表情包清单') < 0) {
      var wxNames = [];
      for (var wei = 0; wei < wxEmoList.length; wei++) if (wxEmoList[wei] && wxEmoList[wei].name) wxNames.push(wxEmoList[wei].name);
      if (wxNames.length) {
        system += '\n【表情包】你可以发表情包：在回复里单独一行输出 [表情包:名字]。可用名字：' +
          wxNames.join('、') +
          '。主人让你发表情包、要抱抱蹭蹭逗TA开心时【必须发】——明确点名要表情包的那条回复里一定要带 [表情包:名字] 标记（可以先回一句文字再跟标记），不许只回文字、不许装傻；平时正常聊天不必每次都发。';
      }
    }
    // v23 微信语音条能力（机主定调「AI 回复直接合成语音条发到真机微信」）：合成可用
    //（网关本地 TTS 零配置 / 用户自配 TTS / 聊天 API 兑底任一路）时教学 [语音:] 标记
    //（与 QQ 同款）；对方明确要语音时该轮也会直接升级语音条（见下方发送段）。
    var wxTtsOk = !!(TTS_LOCAL_URL || (cfg.wechat && cfg.wechat.tts && cfg.wechat.tts.baseUrl && cfg.wechat.tts.apiKey) || (cfg.llm && cfg.llm.baseUrl && cfg.llm.apiKey));
    if (wxTtsOk) {
      system += '\n【语音条能力】你可以发语音：对方让你发语音/说给TA听/用语音回复时，把要说的话写进标记 [语音:想说的话]（单独占一行，可以多条多个标记），系统会把它们合成真正的语音条发给对方——想发语音就带标记，不要只口头答应「我给你发条语音」却什么都不做，更不要说「发不了语音」。';
    }
    // v16 微信引用功能下线（机主定调）：历史不再加 [M数字] 门牌号、[引用:编号] 标记直接剥除不转引用行；
    // 上下文用纯 user/assistant 消息（QQ 通道保留引用，未受影响）。世界书 user 位仍包裹本轮消息
    // （v15：用带被引内容的 llmText——对方引用着旧消息提问时 AI 看得到被引的那句）
    var msgs = [{ role: 'system', content: system }];
    // v14 上下文窗口 13 → 16（连发 3~30 条后一轮就能占二三十条，旧窗口连半轮都装不下）
    for (var i = Math.max(0, hist.length - 16); i < hist.length; i++) {
      if (!hist[i] || !hist[i].content) continue;
      msgs.push({ role: hist[i].role === 'assistant' ? 'assistant' : 'user', content: String(hist[i].content).slice(0, 500) });
    }
    msgs.push({ role: 'user', content: (wb && wb.bu ? wb.bu + '\n' : '') + llmText + (wb && wb.au ? '\n' + wb.au : '') });
    var reply = '';
    var lastLlmErr = null;
    for (var att = 0; att < 2 && !reply; att++) {
      try {
        reply = await callLlm(cfg, msgs);
      } catch (le) { lastLlmErr = le; }
    }
    if (!reply) {
      WX_MSG_ERR = ('LLM 回复失败：' + String((lastLlmErr && lastLlmErr.message) || lastLlmErr)).slice(0, 160);
      WX_MSG_ERR_AT = Date.now();
      throw new Error(WX_MSG_ERR);
    }
    // v13 连发 + 深度思考剥除 + 富媒体标记净化（与网站同源：一句一条逐条发）。
    // v14 真表情包：[表情包:ID/名字] 解析到运行包表情 → 官方媒体协议发真图（≤3 张，
    // 逐张失败降级经典表情代码文字）；解析不到的标记维持 stickerMap→经典表情的旧路径。
    // v16：引用功能下线——[引用:编号] 裸正剥除不转引用行；[照片:描述] 等标记照旧静默剥除。
    var wxNoQuote = String(stripThinkBlocks(reply)).replace(/[\[【]\s*引用\s*[:：]\s*M?\s*\d{1,5}\s*[\]】]/g, '');
    var wxEmoScan = collectCloudStickers(wxNoQuote, wxEmoList, false);
    // v23 语音标记先行切走（同 QQ：[语音:内容] → 合成真语音条强制发）；对方明确要语音
    //（无标记时）首段直接升级；合成失败的段文字补回（保底不丢）
    var wxVoiceScan = collectVoiceMarkers(wxEmoScan.text);
    var cleaned = stripRichMarkers(wxVoiceScan.text);
    var segs = cloudReplySegments(cleaned, cfg.wechat.multi !== false);
    if (!segs.length && !wxEmoScan.hits.length && !wxVoiceScan.clips.length) segs = [WX_EMOJI_FALLBACKS[Math.floor(Math.random() * WX_EMOJI_FALLBACKS.length)]];
    // v23 微信语音条合成（≤2 条；TTS→wav→silk，成功后经 iLink type 3 voice_item 发真语音）
    var wxVoiceClips = [];
    if (wxTtsOk && wxVoiceScan.clips.length > 0) {
      for (var wvi = 0; wvi < wxVoiceScan.clips.length && wxVoiceClips.length < 2; wvi++) {
        var wvp = splitVoicePieces(wxVoiceScan.clips[wvi]);
        if (wvp.rest) segs.push(wvp.rest);
        for (var wvj = 0; wvj < wvp.pieces.length && wxVoiceClips.length < 2; wvj++) {
          var wPiece = wvp.pieces[wvj];
          if (!wPiece) continue;
          var wvs = await synthesizeVoiceSilk(cfg, wPiece, cfg.wechat && cfg.wechat.tts);
          if (wvs) wxVoiceClips.push({ silk: wvs.silk, durMs: wvs.durMs, rate: wvs.rate, text: wPiece, sent: false });
          else segs.push(wPiece); // 合成失败：文字补回（保底不丢）
        }
      }
    } else if (wxTtsOk && wxVoiceScan.clips.length === 0 && isVoiceRequested(text) && segs.length) {
      // 对方明确要语音（无标记）：首段直接升级语音条（合成失败维持文字）
      var wSeg = segs[0];
      segs = segs.slice(1);
      var wvs2 = await synthesizeVoiceSilk(cfg, wSeg, cfg.wechat && cfg.wechat.tts);
      if (wvs2) wxVoiceClips.push({ silk: wvs2.silk, durMs: wvs2.durMs, rate: wvs2.rate, text: wSeg, sent: false });
      else segs.unshift(wSeg);
    }
    for (var ssi = 0; ssi < segs.length; ssi++) segs[ssi] = sanitizeWxOutText(cfg, segs[ssi]);
    // v14 条数上限 8 → 30（机主定调「3~30 尽量多发」）：超出并入末条（不丢内容）；
    // 逐条连发 + 真人节奏间隔（正在输入保活持续到发完）
    if (segs.length > 30) {
      var head = segs.slice(0, 29);
      head.push(segs.slice(29).join('\n'));
      segs = head;
    }
    // v23 发送顺序：语音条先行（失败该条文字补回）→ 文字连发 → 表情图（与 QQ 同构）
    for (var wsi2 = 0; wsi2 < wxVoiceClips.length; wsi2++) {
      try {
        var wSent = await wxSendVoice(cfg, msg.from_user_id, msg.context_token, wxVoiceClips[wsi2].silk, wxVoiceClips[wsi2].durMs, wxVoiceClips[wsi2].rate);
        if (wSent) {
          wxVoiceClips[wsi2].sent = true;
          await coreSleep(400 + Math.floor(Math.random() * 300));
        } else {
          segs.push(wxVoiceClips[wsi2].text); // 发送失败：文字补回
        }
      } catch (wve) {
        segs.push(wxVoiceClips[wsi2].text);
      }
    }
    for (var gi = 0; gi < segs.length; gi++) {
      await sendWxText(cfg, msg.from_user_id, msg.context_token, segs[gi]);
      if (gi < segs.length - 1) await coreSleep(280 + Math.floor(Math.random() * 420));
    }
    // v14 表情包真图（正文发完后逐张发；单张发不出→经典表情代码文字兑底，再不行跳过不炸主流程）
    var sentEmoNames = [];
    var emoTried = 0;
    for (var wi = 0; wi < wxEmoScan.hits.length && emoTried < 3; wi++) {
      var wst = wxEmoScan.hits[wi];
      emoTried++;
      var sentOk = false;
      try { sentOk = await wxSendSticker(cfg, msg.from_user_id, msg.context_token, wst.dataUrl); } catch (we) { sentOk = false; }
      if (sentOk) {
        sentEmoNames.push(wst.name || '表情');
        await coreSleep(400 + Math.floor(Math.random() * 300));
      } else {
        var classicWx = wxStickerToClassic(cfg, wst.id || wst.name);
        if (classicWx) {
          try { await sendWxText(cfg, msg.from_user_id, msg.context_token, classicWx); } catch (we2) { /* 跳过 */ }
        }
      }
    }
    if (WX_MSG_ERR_AT && Date.now() - WX_MSG_ERR_AT > 600000) WX_MSG_ERR = '';
    // v13 历史逐段落库（网站拉取展示 = 连发多条气泡，与站内聊天页一致）；v14 表情包存档行；
    // v23 语音条 [语音] 摘要行（与 QQ 同构）
    var histAdd = [{ role: 'user', content: text.slice(0, 500), ts: Date.now() }];
    for (var wvx = 0; wvx < wxVoiceClips.length; wvx++) {
      if (!wxVoiceClips[wvx].sent) continue;
      histAdd.push({ role: 'assistant', content: ('[语音] ' + wxVoiceClips[wvx].text).slice(0, 500), ts: Date.now() });
    }
    for (var hi = 0; hi < segs.length; hi++) {
      histAdd.push({ role: 'assistant', content: segs[hi].slice(0, 500), ts: Date.now() });
    }
    for (var emi = 0; emi < sentEmoNames.length; emi++) {
      histAdd.push({ role: 'assistant', content: ('[表情:' + sentEmoNames[emi] + ']').slice(0, 500), ts: Date.now() });
    }
    // v14 落库窗口 30 → 60（一轮连发就能占二三十条，旧 30 条只剩半轮，上下文断得快）
    HIST_WX = (HIST_WX || []).concat(histAdd).slice(-60);
    // v21 本地镜像（网关 /hist 落本机文件——Storage 402/502 受限期间网站拉取走网关本地通道）
    localHistPost('wx', histAdd);
    await saveWxHistory();
    return true;
  } catch (e) {
    if (!WX_MSG_ERR) {
      WX_MSG_ERR = ('微信回复失败：' + String(e && e.message)).slice(0, 160);
      WX_MSG_ERR_AT = Date.now();
    }
    throw e;
  } finally {
    // 回复成功/失败都收尾：停保活定时器 + 发 status 2 结束输入
    stopTypingLight();
  }
}

/** 微信：轮询一轮，返回本轮处理了几条消息；TOKEN_EXPIRED 抛错。
 *  v9：①开轮询锁（别的 owner 50s 内活跃 → 让位返回 0）；②游标恢复 → 收一批 →
 *  逐条「认领→回→销认领→记已回」（别人已认领的跳过——并发双轮询器不再双回）；
 *  全部成功才落游标（中途失败保持旧游标：下轮重收整批，已回的靠 seen 跳过、只重试没回成功的）。 */
async function tick() {
  var cfg = await loadConfig(false);
  if (!cfg.wechat || !cfg.wechat.botToken) return 0;
  // v9 轮询锁：让位不改正确性（认领表兑底），只是省一次重复 getupdates
  try {
    var lk = await loadWxLock();
    if (lk && lk.owner !== POLL_OWNER && Date.now() - lk.at < WX_LOCK_TTL) return 0;
    await writeWxLock();
  } catch (e) { /* 锁读写失败照常轮询（认领表兑底并发安全） */ }
  await loadWxCursor();
  await loadWxClaims();
  var d = await ilinkCall('/ilink/bot/getupdates', cfg.wechat.botToken, {
    get_updates_buf: UPDATES_BUF, base_info: BASE_INFO,
  });
  if (d && d.error_code === -14) throw new Error('TOKEN_EXPIRED');
  return await consumeUpdateBatch(cfg, d);
}

/** v16 10 秒轮询档：短窗单轮 getupdates（9s 客户端超窗——服务端长轮持有间有消息会提前回，
 *  超窗=本轮空手不报错）+ 复用认领表/seen 兑底并发安全；【跳过轮询锁】——10s 高频下 50s TTL
 *  的锁会让大半轮询空让位（锁语义是给 1 分钟档省重复 getupdates 的，高频档反而有害）。
 *  供 cron-cycle&fast=1（pg_cron 每 10 秒打一次）使用；超窗 Abort 按本轮 0 条处理。 */
async function tickFast() {
  var cfg = await loadConfig(false);
  if (!cfg.wechat || !cfg.wechat.botToken) return 0;
  await loadWxCursor();
  await loadWxClaims();
  var d = null;
  try {
    d = await ilinkCall('/ilink/bot/getupdates', cfg.wechat.botToken, {
      get_updates_buf: UPDATES_BUF, base_info: BASE_INFO,
    }, 9000);
  } catch (te) {
    var m = String(te && te.message || te);
    if (m.indexOf('TOKEN_EXPIRED') >= 0) throw te;
    return 0; // 9s 超窗 / 网络抖动：本轮空手（认领表兑底，下一轮 10s 后再来）
  }
  if (d && d.error_code === -14) throw new Error('TOKEN_EXPIRED');
  return await consumeUpdateBatch(cfg, d);
}

/** tick / tickFast 共用：一批 getupdates 回包 → 逐条「认领→回→销认领→记已回」（别人已认领
 *  的跳过——并发双轮询器不再双回）；全部成功才落游标（中途失败保持旧游标：下轮重收整批，
 *  已回的靠 seen 跳过、只重试没回成功的）。 */
async function consumeUpdateBatch(cfg, d) {
  if (d && typeof d.get_updates_buf === 'string' && d.get_updates_buf) UPDATES_BUF = d.get_updates_buf;
  var n = 0;
  var pending = 0;
  var msgs = (d && d.msgs) || [];
  for (var i = 0; i < msgs.length; i++) {
    var mid = msgs[i] && msgs[i].message_id != null ? String(msgs[i].message_id) : '';
    if (wxSeenHas(mid)) continue;
    pending++;
    if (wxClaimFresh(mid)) continue; // 别的轮询器正在回这条：跳过（它回完会记 seen/落游标）
    if (mid) await writeWxClaim(mid);
    try {
      if (await handleWxMsg(cfg, msgs[i])) {
        n++;
        if (mid) { await markWxSeen(mid); await clearWxClaim(mid); }
      } else if (mid) {
        await clearWxClaim(mid); // 空消息/自发消息等：销认领，不占重试位
      }
    } catch (e) {
      if (mid) await clearWxClaim(mid); // 失败立即释放：下一轮重试
      if (String(e && e.message).indexOf('TOKEN_EXPIRED') >= 0) throw e;
      /* 单条失败继续下一条；原因已记入 WX_MSG_ERR（心跳/ping 可见） */
    }
  }
  if (pending === 0 || n >= pending) await saveWxCursor();
  return n;
}

// ---- QQ：access_token（2h 有效，110 分钟刷新缓存；双端点降级：新端点海外可达，旧端点网关拦 503） ----
async function qqToken(cfg) {
  if (QQ_TOKEN && Date.now() - QQ_TOKEN_AT < 110 * 60 * 1000) return QQ_TOKEN;
  var qq = cfg.qq || {};
  var lastErr = '';
  var lastStatus = 0;
  for (var ti = 0; ti < QQ_TOKEN_URLS.length; ti++) {
    try {
      var r = await fetch(QQ_TOKEN_URLS[ti], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: qq.appId, clientSecret: qq.appSecret }),
        // v8：原来没有超时——QQ 取凭证挂起会卡住 WS 连接与消息回复
        signal: AbortSignal.timeout(20000),
      });
      lastStatus = r.status;
      var j = await r.json().catch(function () { return {}; });
      if (j && j.access_token) {
        QQ_TOKEN = j.access_token;
        QQ_TOKEN_AT = Date.now();
        return QQ_TOKEN;
      }
      // 业务错误（官方约定 HTTP 200 + code）：换端点无意义，直接报可读错（code 兼容数字/字符串）
      var bizCode = Number(j && j.code) || 0;
      if (bizCode) {
        if (bizCode === 100016) throw new Error('QQ 凭证不正确（100016）：请核对 AppID/AppSecret');
        if (bizCode === 100007) throw new Error('QQ AppID 无效或机器人状态异常（100007）');
        if (bizCode === 10004) throw new Error('QQ 机器人不存在（10004）');
        if (bizCode === 100001) throw new Error('QQ 平台频控（100001）：稍后再试');
        throw new Error('QQ token 获取失败 code ' + bizCode);
      }
      lastErr = 'HTTP ' + r.status;
    } catch (te) {
      if (String(te && te.message).indexOf('QQ ') === 0) throw te; // 业务错不再降级
      lastErr = String(te && te.message);
    }
  }
  throw new Error('QQ token 获取失败 ' + (lastStatus || '') + ' ' + lastErr.slice(0, 80));
}

/** v23 QQ token 缓存强制失效（网关导出）：网关取 QQ 网关地址收到 400/401/403（多半是
 *  平台侧把 token 滚动挤过期）时清缓存重取——下一轮 connectQq 拿到新 token（凭证真失效
 *  时 100016 会如实浮出成 lastError，用户在云端助手页直接看到「请核对 AppID/AppSecret」，
 *  不再永远「正在连接 QQ 平台」）。 */
function qqTokenReset() {
  QQ_TOKEN = '';
  QQ_TOKEN_AT = 0;
}

/** v19 QQ token 失效自愈：多个持有方（本网关 / 云端函数 / 手动测试脚本）各自调
 *  getAppAccessToken，平台侧 token 滚动会把先取的挤过期——110 分钟缓存里挂着死 token
 *  时发送/上传全部 401（11244/40011027），表现为「TA 突然一条都不回了」。遇到 401/403
 *  且带 AccessToken 过期标记 → 清缓存重取一次再试。 */
async function qqTokenCall(cfg, doCall) {
  var token = await qqToken(cfg);
  var r = await doCall(token);
  if (r.status === 401 || r.status === 403) {
    var tb = await r.text().catch(function () { return ''; });
    if (/AccessToken|11244|40011027/i.test(tb)) {
      QQ_TOKEN = '';
      QQ_TOKEN_AT = 0;
      token = await qqToken(cfg);
      r = await doCall(token);
      if (r.status === 401 || r.status === 403) {
        tb = await r.text().catch(function () { return ''; });
      }
    }
  }
  return r;
}

/** QQ：Ed25519 种子（Bot Secret 重复到 32 字节；官方文档算法） */
function qqSeed(botSecret) {
  var s = String(botSecret || '');
  if (!s) return null;
  while (s.length < 32) s += s;
  return s.slice(0, 32);
}

async function loadQqHistory(force) {
  if (!force && HIST_QQ && Date.now() - HIST_AT < 30000) return HIST_QQ;
  var h = await supaGetJson('qq-history.json');
  HIST_QQ = h && Array.isArray(h.msgs) ? h.msgs : [];
  HIST_AT = Date.now();
  return HIST_QQ;
}

async function appendQqHistory(item) {
  // v11 幂等：同 id 已在历史里就不再追加（认领表拦不住的边角：旧版双写存量、并发竞态）。
  // 不去重的话云端 qq-history.json 会出现同 id 两份，手机 App 拉回合入本地后
  // 同一条消息渲染两遍（React key 报错 + 界面里「回复两三遍」的直接推手）。
  for (var ai = 0; ai < (HIST_QQ || []).length; ai++) {
    if (HIST_QQ[ai] && HIST_QQ[ai].id === item.id) return;
  }
  HIST_QQ = (HIST_QQ || []).concat([item]).slice(-200);
  QQ_HIST_DIRTY = true;
  // v21 本地先落（不依赖 Storage，402/502 受限期间记录不丢）；云端攒到轮末一次批量写
  localHistPost('qq', [item]);
}

/** v21 本地历史落盘（网关 /hist 端点，仅网关注入）：QQ/微信历史逐条即时写本机文件。
 *  本地失败不影响收发主流程。 */
function localHistPost(channel, items) {
  if (!(HIST_LOCAL_URL && items && items.length)) return;
  try {
    fetch(HIST_LOCAL_URL + '/hist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channel, msgs: items }),
      signal: AbortSignal.timeout(4000),
    }).catch(function () { /* 尽力而为 */ });
  } catch (e) { /* 本地写失败不影响收发主流程 */ }
}

/** v21 云端批量落库：一轮回复全部 append 完后一次写（旧版每条 append 都整文件重写
 *  Storage——一轮 3~7 次、叠加高频心跳/认领写正是触发 Supabase 免费层风控 402 的写放大
 *  主源之一）。写失败静默（supaPutJson 自吞错；本地文件已有完整记录，网站拉取走网关
 *  本地通道）。 */
var QQ_HIST_DIRTY = false;
async function flushQqHistory() {
  if (!QQ_HIST_DIRTY) return;
  QQ_HIST_DIRTY = false;
  await supaPutJson('qq-history.json', { msgs: HIST_QQ, updatedAt: Date.now() });
}

/** QQ：被动回复（v2 接口，60 分钟内有效、每条消息最多回 5 次；seq 递增防同 msg_id 撞号） */
var QQ_SEQ = 1;
async function qqReply(cfg, openid, msgId, content, isGroup, groupOpenid) {
  var url = isGroup ? QQ_API + '/v2/groups/' + groupOpenid + '/messages' : QQ_API + '/v2/users/' + openid + '/messages';
  var r = await qqTokenCall(cfg, function (token) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
      body: JSON.stringify({ msg_type: 0, content: content.slice(0, 1500), msg_id: msgId, msg_seq: QQ_SEQ++ }),
      signal: AbortSignal.timeout(25000),
    });
  });
  if (!r.ok) {
    var t = await r.text().catch(function () { return ''; });
    throw new Error('QQ 回复失败 ' + r.status + ' ' + t.slice(0, 100));
  }
}

/** QQ：上传富媒体文件（file_type 1=图片 2=视频 3=语音 silk；≤2MB），返回 file_info 句柄。
 *  v19 url 制根修：官方 v2 接口只收 url（QQ 服务器来拉取该 URL）——旧版把 base64 塞进
 *  file 字段官方并不支持，必报 40093007「富媒体文件下载失败」→ 表情包/语音全部静默降级
 *  （真机「AI 说发了却什么都没收到」的根因）。现在收 mediaUrl：内置包走仓库 CDN URL、
 *  语音 silk/用户收藏表情走网关媒体托管或云端函数公桶直写。 */
async function qqUploadMedia(cfg, openid, isGroup, groupOpenid, fileType, mediaUrl) {
  var url = isGroup ? QQ_API + '/v2/groups/' + groupOpenid + '/files' : QQ_API + '/v2/users/' + openid + '/files';
  var r = await qqTokenCall(cfg, function (token) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
      body: JSON.stringify({ file_type: fileType, url: String(mediaUrl || ''), srv_send_msg: false }),
      signal: AbortSignal.timeout(30000),
    });
  });
  var t = await r.text().catch(function () { return ''; });
  if (!r.ok) throw new Error('QQ 富媒体上传失败 ' + r.status + ' ' + t.slice(0, 100));
  var j = null;
  try { j = JSON.parse(t); } catch (e) { j = null; }
  var fi = j && (j.file_info || (j.file_infos && j.file_infos[0] && j.file_infos[0].file_info)) || '';
  if (!fi) throw new Error('QQ 富媒体上传失败：无 file_info' + (t ? '（' + t.slice(0, 80) + '）' : ''));
  return fi;
}

/** v19 QQ 媒体托管（网关中继模式）：媒体字节（base64）经云端函数 upload-file（encoding:
 *  'base64'，v19 函数解码回字节写入；旧版函数会把 base64 当文本写坏——读回验证字节长度
 *  对得上才认）→ 用户 Supabase 公桶公网 URL（QQ 实测可拉取）。函数旧/写失败返回 ''。 */
async function qqHostMedia(dataB64, ext) {
  try {
    if (!(RELAY_URL && RELAY_SECRET && SUPA_URL)) return '';
    var safeExt = String(ext || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
    var path = 'media/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.' + safeExt;
    var r = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Task-Secret': RELAY_SECRET, 'X-Task-Action': 'upload-file' },
      body: JSON.stringify({ files: [{ path: path, content: String(dataB64 || ''), encoding: 'base64', bucket: 'wx-cloud-public', contentType: 'application/octet-stream' }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return '';
    var j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!(j && j.ok && Array.isArray(j.uploaded) && j.uploaded.length)) return '';
    var pubUrl = SUPA_URL + '/storage/v1/object/public/wx-cloud-public/' + path;
    // 读回验证：旧版函数把 base64 当文本写入 → 文件长度 ≈ 4/3 倍——长度对不上就当没写上
    // （不把坏 URL 交给 QQ 拉取）；公桶对象公网可读，直读即可。
    var rawLen = Math.floor((String(dataB64 || '').replace(/[^A-Za-z0-9+/]/g, '').length * 3) / 4);
    var back = await fetch(pubUrl, { signal: AbortSignal.timeout(15000) }).catch(function () { return null; });
    if (!(back && back.ok)) return '';
    var gotLen = Number(back.headers.get('content-length')) || 0;
    if (rawLen > 0 && Math.abs(gotLen - rawLen) > 2) return '';
    return pubUrl;
  } catch (e) { return ''; }
}

/** v19 QQ 媒体托管（云端函数/直连模式）：字节直写用户 Supabase 公桶（Deno 平台注入凭证，
 *  或网关直连模式的用户 serviceKey）→ 公网 URL（QQ 实测可拉取）。网关中继模式（SUPA_KEY
 *  空）返回 ''——中继走 qqHostMedia（云端函数代写）。 */
async function qqHostMediaCloud(dataB64, ext) {
  try {
    if (!SUPA_URL || !SUPA_KEY) return '';
    var bytes = cloudB64ToBytes(String(dataB64 || ''));
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) return '';
    var path = 'media/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.' + String(ext || 'bin').replace(/[^a-z0-9]/gi, '');
    var r = await fetch(SUPA_URL + '/storage/v1/object/wx-cloud-public/' + path, {
      method: 'POST',
      headers: Object.assign(supaHeaders(), { 'x-upsert': 'true', 'Content-Type': 'application/octet-stream' }),
      body: bytes,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return '';
    return SUPA_URL + '/storage/v1/object/public/wx-cloud-public/' + path;
  } catch (e) { return ''; }
}

/** v19 dataUrl 后缀（QQ 托管上传时决定扩展名） */
function cloudDataUrlExt(dataUrl) {
  var m = /^data:image\/(webp|png|gif|jpeg)/i.exec(String(dataUrl || ''));
  return m ? m[1].toLowerCase() : 'png';
}

/** v19 表情包图片发送（url 候选逐个试）：① 内置包 CDN URL（jsdelivr——QQ 实测可拉取，
 *  偶发超时自动换候选重试；st.url 来自运行包/网关注入，附 fastly 备用）② 网关托管
 *  （用户收藏的 dataUrl 字节）③ 云端函数公桶直写（SUPA 凭证模式）。全失败返回 false
 *  （调用方跳过该张，主流程不炸）。 */
async function qqSendStickerImage(cfg, openid, msgId, isGroup, groupOpenid, st) {
  var b64 = String((st && st.dataUrl) || '').split(',')[1] || '';
  var ext = cloudDataUrlExt(st && st.dataUrl);
  var candidates = [];
  if (st && st.url) candidates.push(String(st.url));
  if (st && st.id && LOCAL_STICKER_URLS && LOCAL_STICKER_URLS[String(st.id)]) {
    var cdn = String(LOCAL_STICKER_URLS[String(st.id)]);
    candidates.push(cdn);
    if (/\.webp$/i.test(cdn)) candidates.push(cdn.replace('https://cdn.jsdelivr.net', 'https://fastly.jsdelivr.net'));
  }
  if (b64) {
    var hosted = await qqHostMedia(b64, ext);
    if (hosted) candidates.push(hosted);
    var cloud = await qqHostMediaCloud(b64, ext);
    if (cloud) candidates.push(cloud);
  }
  var uniq = [];
  for (var ci = 0; ci < candidates.length; ci++) if (candidates[ci] && uniq.indexOf(candidates[ci]) < 0) uniq.push(candidates[ci]);
  for (var ui = 0; ui < uniq.length; ui++) {
    try {
      var fi = await qqUploadMedia(cfg, openid, isGroup, groupOpenid, 1, uniq[ui]);
      await qqReplyMedia(cfg, openid, msgId, fi, isGroup, groupOpenid);
      return true;
    } catch (e) { /* 该候选失败：换下一个（CDN 波动/托管不可用） */ }
  }
  return false;
}

/** QQ：发富媒体消息（v2 官方接口 msg_type=7 富媒体——旧版写 2 是 markdown 的编号，
 *  服务器把 media 消息当 markdown 解析报「无效 markdown content」40034011，表情包/语音条
 *  从未真正发出过——真机「AI 说发了却什么都没有」的另一半根因；实测 msg_type=7 + media
 *  {file_info} 被动回复 200 成功送达） */
async function qqReplyMedia(cfg, openid, msgId, fileInfo, isGroup, groupOpenid) {
  var url = isGroup ? QQ_API + '/v2/groups/' + groupOpenid + '/messages' : QQ_API + '/v2/users/' + openid + '/messages';
  var r = await qqTokenCall(cfg, function (token) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
      body: JSON.stringify({ msg_type: 7, media: { file_info: fileInfo }, msg_id: msgId, msg_seq: QQ_SEQ++ }),
      signal: AbortSignal.timeout(25000),
    });
  });
  if (!r.ok) {
    var t = await r.text().catch(function () { return ''; });
    throw new Error('QQ 富媒体发送失败 ' + r.status + ' ' + t.slice(0, 100));
  }
}

/** silk 编码器（QQ 原生语音条）：Deno 用 npm:silk-wasm，Node 用运行包同目录 ./silk-wasm.mjs + silk.wasm。
 *  加载失败缓存 10 分钟（文件没带上/网络问题时不每条消息都重试）；失败返回 null 降级文字 */
var SILK_MOD = null;
var SILK_FAIL_AT = 0;
async function silkEncode(u8) {
  if (SILK_FAIL_AT && Date.now() - SILK_FAIL_AT < 600000) return null;
  try {
    if (!SILK_MOD) {
      SILK_MOD = (typeof Deno !== 'undefined')
        ? await import('npm:silk-wasm@3')
        : await import('./silk-wasm.mjs');
    }
    var r = await SILK_MOD.encode(u8, 0);
    return r && r.data && r.data.length ? r.data : null;
  } catch (e) {
    SILK_MOD = null;
    SILK_FAIL_AT = Date.now();
    return null;
  }
}

/** v23 TTS → wav → silk（微信/QQ 共用核心）：三路合成源——网关本地端点（TTS_LOCAL_URL，
 *  z-ai SDK 零配置）→ 用户自配 TTS（OpenAI 兼容 /audio/speech）→ 聊天 API 兜底（v17）。
 *  返回 { silk, rate, durMs } 或 null（任一步失败调用方降级文字）。 */
async function synthesizeVoiceSilk(cfg, text, tts) {
  var localUrl = TTS_LOCAL_URL;
  var llm = cfg.llm || {};
  var viaLlm = !localUrl && !(tts && tts.baseUrl && tts.apiKey) && !!(llm.baseUrl && llm.apiKey);
  if (!localUrl && !(tts && tts.baseUrl && tts.apiKey) && !viaLlm) return null;
  try {
    var r = null;
    if (localUrl) {
      r = await fetch(localUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text.slice(0, 200), voice: (tts && tts.voice) || 'tongtong', speed: 1, response_format: 'wav' }),
        signal: AbortSignal.timeout(30000),
      });
    } else if (viaLlm) {
      var lb = String(llm.baseUrl).replace(/\/+$/, '');
      var lurl = /\/audio\/speech$/.test(lb) ? lb : lb + '/audio/speech';
      r = await fetch(lurl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + llm.apiKey },
        body: JSON.stringify({ model: (tts && tts.model) || 'tts-1', voice: (tts && tts.voice) || 'alloy', input: text.slice(0, 200), response_format: 'wav', speed: 1 }),
        signal: AbortSignal.timeout(30000),
      });
    } else {
      var b = String(tts.baseUrl).replace(/\/+$/, '');
      var url = /\/audio\/speech$/.test(b) ? b : b + '/audio/speech';
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tts.apiKey },
        body: JSON.stringify({ model: tts.model || 'tts-1', voice: tts.voice || 'alloy', input: text.slice(0, 200), response_format: 'wav', speed: 1 }),
        signal: AbortSignal.timeout(30000),
      });
    }
    if (!r.ok) return null;
    var buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 44 || String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'RIFF') return null;
    // WAV 头解析真实采样率（voice_item.sample_rate 要声明真实值——报错率会变速变调）
    var rate = 24000;
    try {
      if (buf.length > 44) {
        var wv = buf[24] | (buf[25] << 8) | (buf[26] << 16) | (buf[27] << 24);
        if (wv > 4000 && wv < 100000) rate = wv;
      }
    } catch (e2) { /* 头解析失败按默认 */ }
    var silk = await silkEncode(buf);
    if (!silk) return null;
    var durMs = Math.max(800, text.length * 250);
    return { silk: silk, rate: rate, durMs: durMs };
  } catch (e) { return null; }
}

/** 云端 TTS（OpenAI 兼容 /audio/speech，只要 wav）→ silk → QQ 原生语音条。失败返回 null（降级文字）。
 *  v17 开箱兑底：没配 TTS 且网关不在线（TTS_LOCAL_URL 只在 im-gateway 注入）时，用聊天
 *  API（cfg.llm，OpenAI 兼容 /audio/speech）试一次合成——服务商不支持该端点就 404/400
 *  静默回退文字；零配置用户在云端的 QQ 语音从「永远发不了」变成「API 支持 TTS 就能发」。
 *  v19 url 制：silk 字节不再塞 base64（官方接口必拒）——托管成公网 URL（网关媒体端点 /
 *  云端函数公桶直写）后交给 QQ 拉取；托管不可用返回 null（降级文字，行为与旧版一致）。
 *  v23：合成核心拆到 synthesizeVoiceSilk（与微信语音共用），本函数只做 QQ 的 url 托管。 */
async function synthesizeQqVoice(cfg, text) {
  var s = await synthesizeVoiceSilk(cfg, text, cfg.qq && cfg.qq.tts);
  if (!s) return null;
  var bin = '';
  for (var i = 0; i < s.silk.length; i += 32768) bin += String.fromCharCode.apply(null, s.silk.subarray(i, i + 32768));
  var b64 = (typeof btoa === 'function') ? btoa(bin) : Buffer.from(s.silk).toString('base64');
  var mediaUrl = await qqHostMedia(b64, 'silk');
  if (!mediaUrl) mediaUrl = await qqHostMediaCloud(b64, 'silk');
  if (!mediaUrl) return null;
  var dur = Math.max(1, Math.round(text.length / 4));
  return { url: mediaUrl, dur: dur };
}

// ---- v15 真机同源增强：入站引用 / 语音分段 / 照片生成 / QQ 定时主动消息 ----

/** v15 入站引用解析（微信消息对象 / QQ 事件 d）：对方在真机上「引用」某条旧消息回复时，
 *  被引内容通常挂在 quote/reply/refer 一类字段（各端形状不一）——深度受限地防御式扫描
 *  取出文本；取不到返回 ''（无引用场景零开销）。只读不改，异常吞掉。
 *  （旧版只把 AI 输出侧的 [引用:M编号] 转成文字引用行——对方「引用着旧消息提问」时
 *  AI 根本看不到被引内容，是「让 TA 引用 TA 却说不会」的另一半根因。） */
function extractInboundQuote(obj) {
  try {
    var found = '';
    var hits = 0;
    function walk(v, depth) {
      if (!v || typeof v !== 'object' || depth > 5 || hits > 2) return;
      if (Array.isArray(v)) { for (var i = 0; i < v.length && i < 12; i++) walk(v[i], depth + 1); return; }
      for (var k in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
        var lk = String(k).toLowerCase();
        var q = v[k];
        if (lk === 'quote' || lk === 'reply' || lk === 'refer' || lk === 'reference' || lk === 'quote_content' || lk === 'quotecontent' || lk === 'reply_content') {
          if (typeof q === 'string' && q.trim()) { if (!found) found = q.trim().slice(0, 80); hits++; continue; }
          if (q && typeof q === 'object') { walk(q, depth + 1); hits++; continue; }
        }
        if (q && typeof q === 'object') walk(q, depth + 1);
      }
    }
    walk(obj, 0);
    return found;
  } catch (e) { return ''; }
}

/** v15 超长语音分段：一段文字 → {pieces:[≤200 字的语音片, 最多 2 片], rest:放不下退回文字的部分}。
 *  优先在句末标点处切（找 120~200 字间最后一个句界），找不到才硬切。 */
function splitVoicePieces(t) {
  var s = String(t || '');
  var pieces = [];
  while (s.length > 200 && pieces.length < 2) {
    var cut = -1;
    for (var ci = 200; ci >= 120; ci--) {
      var ch = s.charAt(ci);
      if ('。！？!?～\n，,；;'.indexOf(ch) >= 0) { cut = ci + 1; break; }
    }
    if (cut < 0) cut = 200;
    pieces.push(s.slice(0, cut));
    s = s.slice(cut);
  }
  if (s.length <= 200) { pieces.push(s); s = ''; }
  return { pieces: pieces, rest: s };
}

/** v16 QQ 主动消息（不带 msg_id = 主动发送；QQ 平台限每个用户每自然月 4 条——超出会被
 *  平台拒，站内引擎按自己的节奏触发，发送结果带成败原因回给调用方）。
 *  旧版 v15 的「早安/晚安定时器」（maybeQqProactive）已按机主定调删除——主动消息现在完全
 *  由站内「主动发消息」设置驱动（deliverProactiveMsg → send-active 动作 → 本函数）。 */
async function qqReplyActive(cfg, openid, content) {
  var r = await qqTokenCall(cfg, function (token) {
    return fetch(QQ_API + '/v2/users/' + openid + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
      body: JSON.stringify({ msg_type: 0, content: content.slice(0, 1500), msg_seq: QQ_SEQ++ }),
      signal: AbortSignal.timeout(25000),
    });
  });
  if (!r.ok) {
    var t = await r.text().catch(function () { return ''; });
    throw new Error('QQ 主动消息失败 ' + r.status + ' ' + t.slice(0, 100));
  }
}

/** v16 记住最近一次微信会话上下文（from_user_id + context_token；state/wx-lastctx.json）。
 *  站内「主动发消息」引擎 send-active 时用它代发——iLink 没有独立主动接口，只能复用
 *  最近会话上下文（新鲜度由读取方自判：默认 24h 内可用，失败即报「上下文过期需先在真机上
 *  给 TA 发条消息」）。进程内缓存去重：同 token 不重复落盘。 */
var WX_LASTCTX_MEM = '';
function noteWxLastCtx(fromUserId, contextToken) {
  var key = String(fromUserId || '') + '|' + String(contextToken || '');
  if (!fromUserId || !contextToken || key === WX_LASTCTX_MEM) return;
  WX_LASTCTX_MEM = key;
  supaPutJson('state/wx-lastctx.json', { fromUserId: String(fromUserId), contextToken: String(contextToken), at: Date.now() }).catch(function () {});
}

/** v16 记住最近和机器人说过话的 C2C 用户 openid（站内主动消息的 QQ 收件人；state/qq-active.json，
 *  14 天新鲜） */
var QQ_ACTIVE_MEM = '';
function noteQqActiveOpenid(openid) {
  var k = String(openid || '');
  if (!k || k === QQ_ACTIVE_MEM) return;
  QQ_ACTIVE_MEM = k;
  supaPutJson('state/qq-active.json', { openid: k, at: Date.now() }).catch(function () {});
}

/** v16 站内主动消息代发（send-active 动作）：把网站「主动发消息」引擎已生成的内容发到真机。
 *  - 微信：state/wx-lastctx.json（最近会话上下文，24h 内）→ sendWxText 逐条发（连发节奏 300ms）；
 *    失败原因（上下文过期 / token 失效）原样带回站内。
 *  - QQ：state/qq-active.json（14 天内说过话的 openid）→ qqReplyActive（平台限每月 4 条，
 *    超限报错带回站内展示）。
 *  返回 { ok, sent, error }。 */
async function cloudSendActive(cfg, channel, texts) {
  var list = [];
  for (var i = 0; i < (texts || []).length && list.length < 10; i++) {
    var one = String((texts || [])[i] || '').trim().slice(0, 800);
    if (one) list.push(one);
  }
  if (!list.length) return { ok: false, sent: 0, error: '没有可发送的内容' };
  if (channel === 'wx') {
    if (!cfg.wechat || !cfg.wechat.botToken) return { ok: false, sent: 0, error: '微信未接入（运行包里没有凭证）' };
    var st = await supaGetJson('state/wx-lastctx.json');
    if (!st || !st.fromUserId || !st.contextToken || !st.at || Date.now() - Number(st.at) > 24 * 3600 * 1000) {
      return { ok: false, sent: 0, error: '微信主动发送需要最近 24 小时内的会话——先在真机微信上给 TA 发一条消息再试' };
    }
    var sent = 0;
    for (var wi = 0; wi < list.length; wi++) {
      try {
        await sendWxText(cfg, st.fromUserId, st.contextToken, sanitizeWxOutText(cfg, list[wi]));
        sent++;
        if (wi < list.length - 1) await coreSleep(300);
      } catch (we) {
        if (!sent) return { ok: false, sent: 0, error: ('微信主动发送失败：' + String(we && we.message)).slice(0, 140) };
        break;
      }
    }
    return { ok: true, sent: sent };
  }
  if (channel === 'qq') {
    if (!cfg.qq || !cfg.qq.appId) return { ok: false, sent: 0, error: 'QQ 未接入（运行包里没有凭证）' };
    var qa = await supaGetJson('state/qq-active.json');
    if (!qa || !qa.openid || !qa.at || Date.now() - Number(qa.at) > 14 * 24 * 3600 * 1000) {
      return { ok: false, sent: 0, error: 'QQ 主动发送需要最近 14 天内和 TA 说过话——先在真机 QQ 上给 TA 发一条消息再试' };
    }
    var sent2 = 0;
    // v20 被动回复优先：5 分钟内对方刚在真机 QQ 发过消息（state/qq-lastmsg.json 记的
    // msg_id + 已用名额）且名额没耗尽（v22：QQ 被动回复无硬性 5 次限制——余量上限放宽到 30，
    // 保守防止单轮刷爆接口）→ 先用被动接口发（不吃 QQ 平台每月 4 条主动消息限额）；
    // 用完/没有才走主动接口。网站回复同步真机（站内镜像）在对方手机上刚发过消息的
    // 窗口里零配额送达。
    var lm = null;
    try { lm = await supaGetJson('state/qq-lastmsg.json'); } catch (le2) {}
    var lmOk = lm && lm.msgid && String(lm.openid) === String(qa.openid) && !lm.isGroup &&
      typeof lm.used === 'number' && Date.now() - Number(lm.at || 0) < 300000;
    var lmRoom = lmOk ? Math.max(0, 30 - Number(lm.used)) : 0;
    if (lmRoom > 0) {
      var lmPass = Math.min(lmRoom, list.length);
      for (var pi = 0; pi < lmPass; pi++) {
        try {
          await qqReply(cfg, qa.openid, String(lm.msgid), qqStripClassicCodes(list[pi]), false, '');
          sent2++;
          if (pi < lmPass - 1) await coreSleep(400);
        } catch (pe) { break; }
      }
      try {
        await supaPutJson('state/qq-lastmsg.json', {
          msgid: lm.msgid, openid: lm.openid, isGroup: lm.isGroup || 0, groupOpenid: lm.groupOpenid || '',
          at: lm.at, used: Number(lm.used) + sent2,
        });
      } catch (le3) { /* 记账失败不阻断 */ }
    }
    for (var qi = sent2; qi < list.length; qi++) {
      try {
        await qqReplyActive(cfg, qa.openid, qqStripClassicCodes(list[qi]));
        sent2++;
        if (qi < list.length - 1) await coreSleep(500);
      } catch (qe) {
        if (!sent2) return { ok: false, sent: 0, error: ('QQ 主动发送失败（QQ 平台主动消息每月限 4 条，超限即报错）：' + String(qe && qe.message)).slice(0, 160) };
        break;
      }
    }
    // 主动消息入云端历史（站内拉取时同看；v21 本地先落 + 轮末批量上云）
    if (sent2 > 0) {
      await appendQqHistory({ id: 'qa-' + Date.now(), role: 'assistant', content: ('[主动] ' + list.join(' ')).slice(0, 500), ts: Date.now() }).catch(function () {});
      await flushQqHistory().catch(function () {});
    }
    return { ok: true, sent: sent2 };
  }
  return { ok: false, sent: 0, error: '未知通道 ' + String(channel || '') };
}

/** 回复里的表情标记（[表情包:名字/ID] / [表情:名字] / [发送了表情:名字]）
 *  v13 token 上限 20→48：贴纸 ID（stk-xxxxxxxx-xxxx）比名字长，20 字符会把 ID 截断导致解析失败 */
var QQ_STICKER_RE = /[【\[]\s*(?:表情包|表情|贴纸|发送了表情包|发送了表情|发送表情)\s*[:：]\s*([^】\]]{1,48})\s*[】\]]/g;

/** 自然语句变体（[发送了一个"抱抱"表情包]：AI 不按标记写，而是写一句「发送了+词+表情包」） */
var QQ_STICKER_NATURAL_RE =
  /[【\[]\s*(?:发送|发)\s*(?:了|出)?\s*(?:一?个)?\s*["\u201c\u300c\u300e']?\s*([^"'\u201d\u2019\u300d\u300f【\[\]】\s:：，。！!]{1,16}?)\s*["'\u201d\u2019\u300d\u300f]?\s*(?:表情包|表情|贴纸)\s*[】\]]/g;

/** 图片描述变体（[图片: 一只圆滚滚的柴犬…]：AI 把发表情包理解成发图片，用画面描述当标记） */
var QQ_STICKER_IMAGE_RE = /[【\[]\s*图片\s*[:：]\s*([^】\]]{2,60})\s*[】\]]/g;

/** [图片:描述] 变体匹配：描述含表情名 → 该名字；再按动作/动物情感词兑底（名字在清单里才返回，找不到 null）。
 *  v14 参数化：微信/微信共用（list = 对应通道的表情清单） */
function resolveCloudEmoticonFromDesc(list, desc) {
  var d = String(desc || '').trim();
  if (!d) return null;
  for (var i = 0; i < list.length; i++) {
    var n = list[i] && list[i].name;
    if (n && n.length >= 2 && d.indexOf(n) >= 0) return list[i];
  }
  var FEEL = [
    [/抱|搂/, '抱'], [/蹭|贴|粘/, '蹭'], [/摸|揉/, '摸'], [/亲|吻/, '亲'],
    [/哭|流泪|呜/, '哭'], [/笑|开心|高兴/, '笑'], [/怒|气鼓|哼/, '怒'],
    [/睡|晚安|困/, '睡'], [/得意|哼哼|骄傲/, '得意'],
    [/柴犬|小狗|狗狗|汪/, '抱'], [/猫|喵/, '贴'],
  ];
  for (var f = 0; f < FEEL.length; f++) {
    if (FEEL[f][0].test(d)) {
      for (var j = 0; j < list.length; j++) {
        var nj = list[j] && list[j].name;
        if (nj && nj.indexOf(FEEL[f][1]) >= 0) return list[j];
      }
    }
  }
  return null;
}

/** 内置表情清单（[{name, id, dataUrl}]，微信 cfg.qq.emoticons / 微信 emoticons.json 的 wechat 段）
 *  匹配：名字精确 → ID 直选 → 互相包含。v14 参数化：微信/微信共用 */
function resolveCloudEmoticon(list, token) {
  var t = String(token || '').trim();
  if (!t) return null;
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === t) return list[i];
  // v13 ID 直选：站内人设清单教的是 [表情包:ID]（运行包 emoticons 带打包时同源 sticker id）
  for (var i2 = 0; i2 < list.length; i2++) if (list[i2] && list[i2].id && list[i2].id === t) return list[i2];
  for (var j = 0; j < list.length; j++) {
    var n = list[j] && list[j].name;
    if (n && (n.indexOf(t) >= 0 || t.indexOf(n) >= 0)) return list[j];
  }
  return null;
}

/** v14 表情标记扫描（微信/微信共用）：三套标记一起扫（标准 [表情包:ID/名字] / 自然语句
 *  [发送了一个"抱抱"表情包] / 图片描述 [图片: 一只柴犬…]）→ 命中的从正文里切出、返回
 *  { text:剩余正文, hits:[表情对象] }。cutUnresolved=true（QQ 旧行为）：标准标记解析不到
 *  也从正文切掉（发送段跳过）；false（微信）：解析不到留在正文里走经典表情转换/剥除的旧路径。
 *  变体标记（自然语句/图片描述）两通道都只切解析得到的那部分（解析不到保留原文当普通文字发）。 */
function collectCloudStickers(text, list, cutUnresolved) {
  var t = String(text || '');
  var hits = [];
  function collect(re, resolver) {
    re.lastIndex = 0;
    var m = null;
    while ((m = re.exec(t)) !== null) {
      var emo = resolver(m[1]);
      if (emo || cutUnresolved) hits.push({ s: m.index, e: m.index + m[0].length, emo: emo });
    }
  }
  collect(QQ_STICKER_RE, function (tok) { return resolveCloudEmoticon(list, String(tok || '').trim()); });
  collect(QQ_STICKER_NATURAL_RE, function (tok) { return resolveCloudEmoticon(list, String(tok || '').trim()); });
  collect(QQ_STICKER_IMAGE_RE, function (tok) { return resolveCloudEmoticonFromDesc(list, tok); });
  hits.sort(function (a, b) { return a.s - b.s; });
  var out = '';
  var cursor = 0;
  for (var hi = 0; hi < hits.length; hi++) {
    var h = hits[hi];
    if (h.s < cursor) continue;
    out += t.slice(cursor, h.s);
    cursor = h.e;
  }
  out += t.slice(cursor);
  var emos = [];
  for (var e2 = 0; e2 < hits.length; e2++) if (hits[e2].emo) emos.push(hits[e2].emo);
  return { text: out, hits: emos };
}

/** 云端验证 QQ 凭证（部署后从云端出口连 QQ 平台；新端点 api.bot.qq.com 海外出口可达，503 地域拦已成历史） */
async function verifyQqCreds(appId, appSecret) {
  var lastErr = '';
  var lastStatus = 0;
  for (var vi = 0; vi < QQ_TOKEN_URLS.length; vi++) {
    try {
      var r = await fetch(QQ_TOKEN_URLS[vi], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: String(appId || ''), clientSecret: String(appSecret || '') }),
        signal: AbortSignal.timeout(15000),
      });
      lastStatus = r.status;
      var j = null;
      try { j = await r.json(); } catch (e) { j = null; }
      if (j && j.access_token) {
        var botName = '';
        try {
          var me = await fetch(QQ_API + '/users/@me', { headers: { Authorization: 'QQBot ' + j.access_token }, signal: AbortSignal.timeout(10000) });
          var mj = null;
          try { mj = await me.json(); } catch (e2) { mj = null; }
          botName = (mj && (mj.username || mj.nickname)) || '';
        } catch (e3) { /* 拿不到名字不算失败 */ }
        return { ok: true, botName: botName };
      }
      // 业务错误（HTTP 200 + code）：换端点无意义，直接给可读提示（code 兼容数字/字符串）
      var code = Number(j && j.code) || 0;
      var why = code === 100016 ? 'AppID 或 AppSecret 不正确（100016）'
        : code === 100007 ? 'AppID 无效或机器人状态异常（100007）'
        : code === 10004 ? 'AppID 对应的机器人不存在（10004）'
        : code === 100001 ? '请求过于频繁（100001），稍后再试'
        : '请检查 AppID/AppSecret 是否正确';
      if (code) return { ok: false, error: 'QQ 平台返回 code ' + code + '：' + why + (j && j.message ? '（' + j.message + '）' : '') };
      lastErr = (j && j.message) || ('HTTP ' + r.status);
    } catch (e) {
      lastErr = String(e && e.message).slice(0, 120);
    }
  }
  // 双端点都没拿到业务回包：典型是网络不通/被网关拦——QQ 收发消息走内置网关的
  // WebSocket 长连接（设置 → 云端助手 →「自动在线」），不依赖这台云服务器的出口
  var geo = lastStatus === 503 ? '（503：QQ 网关拒绝了这台云服务器的出口 IP）——QQ 收发消息走「自动在线」内置网关（WebSocket 长连接，不受此限制）' : '';
  return { ok: false, error: '云端连不上 QQ 平台：' + (lastErr || 'HTTP ' + lastStatus).slice(0, 120) + geo };
}

/** QQ：入站富媒体 content 里的 markdown 图（![动画表情](…)/![图片](…)）转可读占位，不把裸链接堆给 LLM */
function qqMediaToPlaceholder(t) {
  return String(t || '').replace(/!\[([^\]]*)\]\([^)]*\)/g, function (_, alt) {
    var a = String(alt || '').trim();
    return a && a !== '图片' && a !== '动画表情'
      ? '（对方发了一个表情包/图片：' + a + '）'
      : '（对方发了一个表情包/图片，内容看不到）';
  });
}

/** v20 QQ 入站图片 URL 提取：content 的 markdown 图（![…](url)）+ attachments（url 字段，
 *  兼容 image_url/宽高字段名）——QQ 官方把用户发的图以 markdown 或附件形式下发给机器人，
 *  URL 是 QQ 服务器直链（临时有效），拿到就能拿去识图。返回去重后的 URL 数组（≤3 张）。 */
function qqExtractImageUrls(d) {
  var urls = [];
  var seen = {};
  var raw = String((d && d.content) || '') || '';
  var re = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
  var m = null;
  while ((m = re.exec(raw)) !== null) {
    if (!seen[m[1]]) { seen[m[1]] = 1; urls.push(m[1]); }
  }
  var atts = (d && d.attachments) || [];
  for (var i = 0; i < atts.length; i++) {
    var a = atts[i] || {};
    var u = String(a.url || a.image_url || '');
    if (u && /^https?:\/\//.test(u) && !seen[u]) { seen[u] = 1; urls.push(u); }
  }
  return urls.slice(0, 3);
}

/** v20 QQ 入站图片识图：URL → 网关本地 VLM 端点（z-ai SDK createVision）转文字描述。
 *  端点未注入（云端 Deno） / 网关不在线 / 合成失败 → null（调用方退回占位文案，不影响收发）。 */
async function describeQqImage(url) {
  if (!VLM_LOCAL_URL || !url) return null;
  try {
    var r = await fetch(VLM_LOCAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: String(url),
        prompt: '用一到两句中文描述这张图片：有什么人/物/动作/场景/情绪，图里若有文字也读出来。给聊天对方看懂用，不要客套。',
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) return null;
    var j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    var desc = j && typeof j.desc === 'string' ? j.desc.trim() : '';
    return desc ? desc.slice(0, 300) : null;
  } catch (e) { return null; }
}

/** v23 入站图片媒体密钥解析（两种编码都可能出现，官方文档口径）：
 *  - image_item.aeskey：32 个 hex 字符（入站解密优先用它）→ hex 解码 16 字节
 *  - media.aes_key：base64 —— 解出 16 字节直接用；解出 32 个 hex 字符再 hex 解码（官方 SDK
 *    对齐编码：base64(hex 文本)） */
function wxParseAesKey(imageItem) {
  try {
    var it = imageItem || {};
    var hexRe = /^[0-9a-fA-F]{32}$/;
    if (it.aeskey && hexRe.test(String(it.aeskey))) {
      var hx = String(it.aeskey);
      var out = new Uint8Array(16);
      for (var i = 0; i < 16; i++) out[i] = parseInt(hx.substr(i * 2, 2), 16);
      return out;
    }
    var media = it.media || {};
    if (media.aes_key) {
      var raw = cloudB64ToBytes(String(media.aes_key));
      if (raw.length === 16) return raw;
      if (raw.length === 32) {
        var s = '';
        for (var b = 0; b < 32; b++) s += (raw[b] < 16 ? '0' : '') + raw[b].toString(16);
        if (hexRe.test(s)) {
          var out2 = new Uint8Array(16);
          for (var i2 = 0; i2 < 16; i2++) out2[i2] = parseInt(s.substr(i2 * 2, 2), 16);
          return out2;
        }
      }
    }
  } catch (e) { /* 密钥解析失败 → 无密钥路径 */ }
  return null;
}

/** v23 入站图片识图（微信）：image_item → CDN 下载（full_url 优先 / download 拼 URL）→
 *  AES-128-ECB 解密（无密钥按协议直接下明文）→ base64 → 网关本地 VLM（z-ai 多模态）转描述。
 *  任一步失败返回 null（调用方退占位文案，不影响收发主流程）。 */
async function describeWxImage(imageItem) {
  if (!VLM_LOCAL_URL || !imageItem) return null;
  try {
    var media = imageItem.media || {};
    var param = String(media.encrypt_query_param || imageItem.encrypt_query_param || '');
    var full = String(media.full_url || imageItem.full_url || imageItem.url || '');
    if (!param && !full) return null;
    var dl = (/^https?:\/\//i.test(full) && !full.match(/\/download\?/))
      ? full
      : (WX_CDN_BASE + '/download?encrypted_query_param=' + encodeURIComponent(param));
    var r = await fetch(dl, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    var buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length || buf.length > 8 * 1024 * 1024) return null;
    var key = wxParseAesKey(imageItem);
    var plain = key ? (aesEcbDecrypt(buf, key) || buf) : buf;
    // 图片魔数嗅探（jpg/png/gif/webp）：解密结果不是图（密钥/格式不符）时换原始字节再试一次
    function isImg(u8) {
      if (u8.length < 12) return false;
      if (u8[0] === 0xff && u8[1] === 0xd8) return true; // jpg
      if (u8[0] === 0x89 && u8[1] === 0x50) return true; // png
      if (u8[0] === 0x47 && u8[1] === 0x49) return true; // gif
      if (u8[8] === 0x57 && u8[9] === 0x45) return true; // webp（RIFF....WEBP）
      return false;
    }
    if (!isImg(plain) && isImg(buf)) plain = buf;
    if (!isImg(plain)) return null;
    var b64 = cloudBytesToB64(plain);
    var rr = await fetch(VLM_LOCAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        b64: 'data:image/jpeg;base64,' + b64,
        prompt: '用一到两句中文描述这张图片：有什么人/物/动作/场景/情绪，图里若有文字也读出来。给聊天对方看懂用，不要客套。',
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!rr.ok) return null;
    var j = null;
    try { j = await rr.json(); } catch (e) { j = null; }
    var desc = j && typeof j.desc === 'string' ? j.desc.trim() : '';
    return desc ? desc.slice(0, 300) : null;
  } catch (e) { return null; }
}

/** QQ：处理 C2C / 群@ 消息事件（d），返回是否回复成功。
 *  回复分流：文字（msg_type 0）/ 语音条（TTS→silk，file_type 3）/ 表情包（运行包内置表情图，file_type 1）。
 *  语音条频率：cfg.qq.voiceEvery（每 N 条 1 条，0=关），计数器存云端 state/qq-voice-counter.json。 */
async function handleQqEvent(cfg, t, d) {
  // v12 断开守卫：运行包里已没有 QQ 凭证（手机 App 点了「断开连接」→ 运行包重推、
  // 长连接拆除前的窗口期）——不回复、不写历史、不认领。旧版这里直接空指针崩在
  // cfg.qq.persona，且 WS 未拆时消息照收照回（网页显示已断开、真机 QQ 上 TA 还在线
  // 还在回的根因）。
  if (!cfg.qq || !cfg.qq.appId) return false;
  var content = qqMediaToPlaceholder(String((d && d.content) || '').trim());
  var authorId = d && d.author && d.author.id ? String(d.author.id) : '';
  var msgId = d && d.id ? String(d.id) : '';
  if (!authorId || !msgId) return false;
  // v20 入站图片 URL 先提取（识图用）：markdown 图 + attachments 链接（认领门之后才真调 VLM——
  // 平台重推的同一条事件不浪费识图调用）
  var imgUrls = qqExtractImageUrls(d);
  // 空正文 + 带附件 = 富媒体消息（部分事件 content 为空只挂 attachments）：同样给占位
  if (!content && d && d.attachments && d.attachments.length) {
    var at = d.attachments[0] && d.attachments[0].content_type;
    content = at && String(at).indexOf('image') >= 0 ? '（对方发了一个表情包/图片，内容看不到）' : '（对方发了一个媒体消息）';
  }
  if (!content && !imgUrls.length) return false;
  var isGroup = t === 'GROUP_AT_MESSAGE_CREATE';
  if (isGroup) content = content.replace(/^<at[^>]*>[^<]*<\/at>\s*/, '').trim();
  if (!content) return false;
  // v11 认领门：网关长连接 / 云端 cron-cycle WS / Webhook / 断线 Resume 后平台补发，
  // 同一条事件从几条路都能再进一次——先认领（3 分钟 TTL），认领不到的直接跳过不回
  // （「回复两三遍」根因修复，与微信 wx-claims 同构）。
  // v12 双检：两路几乎同时认领时，Storage 无事务、后写覆盖先写——认领后等 600ms
  // 重读，存下来的时间戳不是自己写的那份 → 对方后到覆盖了我们 → 让位（保证只回一遍）。
  var qcl = await loadQqClaims(true);
  if (qqClaimFresh(msgId)) return false;
  var myClaimTs = await writeQqClaim(msgId);
  try {
  await coreSleep(600);
  var recheck = await loadQqClaims(true);
  if (recheck && typeof recheck[msgId] === 'number' && recheck[msgId] !== myClaimTs) return false;
  // v20 入站图片识图：有图 URL 且本地 VLM 端点可用 → 逐张转描述，占位盲区替换成真内容
  //（AI 真正看得到图——真机 QQ 上「会识图」；描述失败/端点不在退占位不影响收发主流程）
  if (imgUrls.length && VLM_LOCAL_URL) {
    var imgDescs = [];
    for (var idi = 0; idi < imgUrls.length && imgDescs.length < 2; idi++) {
      var dd = await describeQqImage(imgUrls[idi]);
      if (dd) imgDescs.push(dd);
    }
    if (imgDescs.length) {
      var imgNote = '（对方发的图片内容：' + imgDescs.join('；另一张是：') + '）';
      if (content.indexOf('（对方发了一个表情包/图片，内容看不到）') >= 0) {
        content = content.replace('（对方发了一个表情包/图片，内容看不到）', imgNote);
      } else {
        content = (content ? content + '\n' : '') + imgNote;
      }
    }
  }
  if (!content) content = '（对方发了一个媒体消息）';
  // v21 对方这条先入历史（内存 + 本地文件；轮末批量上云）：旧版只在整轮回完后落库，
  // 中途 LLM 失败/接口失败时这条消息就凭空消失（网站 QQ 聊天界面看不到对方在真机上发的
  // 消息的直接推手）。幂等 id（q-msgid）——重推/重试不会重复入列。
  await appendQqHistory({ id: 'q-' + msgId, role: 'user', content: content.slice(0, 500), ts: Date.now() });
  // v16 主动消息收件人：记住最近和机器人说过话的 C2C openid（站内「主动发消息」引擎用；14 天内有效）
  if (!isGroup) noteQqActiveOpenid(authorId);
  var hist = await loadQqHistory(false);
  // v5 历史种子：同微信——云端还没有 QQ 历史时用运行包打包的网站聊天续上下文
  if ((!hist || !hist.length) && cfg.qq && Array.isArray(cfg.qq.history) && cfg.qq.history.length) {
    hist = cfg.qq.history.slice(-20);
    HIST_QQ = hist;
  }
  // v16 语音可用性先算（能力教学 + 语音升级判定共用；v17 加 LLM 兜底——没配 TTS 但聊天
  // API 在就是「能试」，教学照注、合成失败自动回退文字；v19 url 制再加托管门槛：语音要
  // 托管成公网 URL 才发得出去——网关媒体端点或 SUPA 凭证（云端函数/直连）至少有一个）：
  var ttsOk = ((cfg.qq && cfg.qq.tts && cfg.qq.tts.baseUrl && cfg.qq.tts.apiKey) || TTS_LOCAL_URL || (cfg.llm && cfg.llm.baseUrl && cfg.llm.apiKey)) && !!((RELAY_URL && RELAY_SECRET && SUPA_URL) || (SUPA_URL && SUPA_KEY));
  var system = (cfg.qq.persona && cfg.qq.persona.system) || '你和主人在真实QQ上聊天，回复简短自然，绝不透露自己是AI。';
  // v16 连发兑底：旧运行包/未绑定人设里没有连发指令块时运行期补注入（真机「只发一条」的兑底）
  system = ensureBurstRule(system, cfg.qq.multi !== false);
  // 表情包指令：v13 运行包人设（站内组装器产出）自带【表情包清单】时不再重复注入——
  // 只有兑底人设（没绑角色/旧运行包）才给这份精简清单教学（ID/名字都可解析）。
  // v18：本地全量注入与云端 qq.emoticons 合并（网关运行时不再受 Storage 受限/旧包影响）
  var emo = mergeEmoticons(LOCAL_EMOTICONS, (cfg.qq && cfg.qq.emoticons) || []);
  if (emo.length && system.indexOf('表情包清单') < 0) {
    var names = [];
    for (var ei = 0; ei < emo.length; ei++) if (emo[ei] && emo[ei].name) names.push(emo[ei].name);
    system +=
      '\n【表情包】你可以发表情包：在回复里单独一行输出 [表情包:名字或ID]。可用名字：' +
      names.join('、') +
      '。主人让你发表情包、要抱抱蹭蹭逗TA开心时【必须发】——明确点名要表情包的那条回复里一定要带 [表情包:名字] 标记（可以先回一句文字再跟标记），不许只回文字、不许装傻；平时正常聊天不必每次都发。';
  }
  // v16 QQ 语音条能力教学（ttsOk 时动态注入——旧版 AI 只能口头答应「发语音」却没有任何
  // 机制可触发，用户实测「AI 说发不了/卡在发送那一步」的根因）+ 文字表情代码负规则
  // （QQ 机器人通道不渲染 [微笑] 文字代码，站内人设带的代码约定在本通道无效）
  if (ttsOk) {
    system += '\n【语音条能力】你可以发语音：对方让你发语音/说给TA听/用语音回复时，把要说的话写进标记 [语音:想说的话]（单独占一行，可以多条多个标记），系统会把它们合成真正的语音条发给对方——想发语音就带标记，不要只口头答应「我给你发条语音」却什么都不做，更不要说「发不了语音」；普通文字消息偶尔也会自动以语音条送达，属正常送达方式。';
  }
  system += '\n（本通道不支持 [微笑] 这类文字表情代码——想发表情就按表情包清单输出 [表情包:ID/名字] 标记，其余情况用文字自然聊。）';
  // v10 QQ 历史角色归一：qq-history.json 里新旧两种格式并存（旧 me/peer、新 user/assistant）——
  // 归一成 LLM 的 user/assistant（旧版写 me/peer 但过滤只认 user/assistant，云端 QQ 上下文
  // 一直是空的——回复不连贯的根因之一）。me=真机 QQ 上发消息的人（主人）→ user，peer=TA → assistant。
  var recent = [];
  for (var ri = 0; ri < hist.length; ri++) {
    var rm = hist[ri];
    if (!rm || typeof rm.content !== 'string' || !rm.content) continue;
    // v21 早入列的当前消息不进上下文（本轮消息由 cloudNumbered 以 user 位包裹追加——
    // 不排除的话当前消息在上下文里出现两遍：历史一遍 + user 位一遍）
    if (rm.id === 'q-' + msgId) continue;
    var rrole = (rm.role === 'user' || rm.role === 'me') ? 'user' : (rm.role === 'assistant' || rm.role === 'peer') ? 'assistant' : '';
    if (!rrole) continue;
    recent.push({ role: rrole, content: rm.content });
  }
  // v15 入站引用（同微信）：对方在 QQ 里引用旧消息回复——被引内容进 LLM 上下文（历史仍存原文）
  var inQuote2 = extractInboundQuote(d);
  var llmContent = inQuote2
    ? content + '\n（系统提示：对方这条消息是引用回复——被TA引用的原消息是：「' + inQuote2 + '」，结合被引内容理解TA的意思）'
    : content;
  // v13 世界书 + 编号历史（同微信：[M数字] 门牌号 + 六位置注入 + user 位包裹本轮消息）；
  // v16：QQ 通道保留引用功能（机主只要求移除微信侧）
  var scanParts2 = [content];
  for (var wq = Math.max(0, recent.length - 8); wq < recent.length; wq++) scanParts2.push(recent[wq].content);
  var wb = collectCloudWb(cfg.qq.worldbook, scanParts2.join('\n'));
  system = buildCloudSystem(system, wb);
  var numbered = cloudNumbered(recent, llmContent, wb);
  var msgs = [{ role: 'system', content: system }];
  // v14 上下文窗口 13 → 16（连发 3~30 条后一轮就能占二三十条，与微信同口径）
  for (var i = Math.max(0, numbered.msgs.length - 16); i < numbered.msgs.length - 1; i++) msgs.push(numbered.msgs[i]);
  msgs.push(numbered.msgs[numbered.msgs.length - 1]);
  var reply = await callLlm(cfg, msgs);
  // v13 深度思考剥除 + 引用提取（[引用:M编号] 转文字引用行，挂第一条正文前）
  var q = extractQuote(stripThinkBlocks(reply), numbered.quoteMap);
  // 拆表情标记：文字段保留、标记转图片发送（最多 3 张防刷屏）。
  // v14 三套标记统一走 collectCloudStickers（微信/QQ 共用）：标准 [表情包:ID/名字] /
  // 自然语句 [发送了一个"抱抱"表情包] / 图片描述 [图片: 一只柴犬…]——标准标记命中即切出
  // （解析不到的在发送段跳过），两个变体能解析到才切出（匹配不到保留原文当普通文字发）。
  var emoScan = collectCloudStickers(q.text, emo, true);
  var emoHits = emoScan.hits;
  // v16 QQ 语音条标记：[语音:想说的话] 切出 → 强制合成语音条（不依赖频率计数器命中）
  var voiceScan = collectVoiceMarkers(emoScan.text);
  // v13 连发切分（站内回复条数 > 1：句界一条条发）+ 站内动作标记净化 + 引用行；
  // v16：照片标记已下线（stripRichMarkers 静默剥除），语音标记已先行切走
  var cleaned = stripRichMarkers(voiceScan.text);
  var segs = cloudReplySegments(cleaned, cfg.qq.multi !== false);
  // v18 裸标记泄漏兑底：整条回复只剩解析不到的表情标记时，旧版把【未切前的原文】
  // （含裸 [表情包:sunny-02]）当正文发出（实测裸标记泄漏的根因）——改为：清单可用时挑
  // 一张默认表情图发出（AI 想发表情没发成时的兜底，不空轮）；清单也为空才用颜文字兑底。
  if (!segs.length && emoHits.length === 0 && voiceScan.clips.length === 0) {
    if (emo.length) {
      emoHits.push(emo[Math.floor(Math.random() * emo.length)]);
    } else {
      segs = [WX_EMOJI_FALLBACKS[Math.floor(Math.random() * WX_EMOJI_FALLBACKS.length)]];
    }
  }
  if (q.quote && segs.length) segs[0] = '「' + q.quote + '」\n' + segs[0];
  // v16 语音条三分法（QQ「AI 说发不了语音」的修复主体）：
  // ① AI 明确输出 [语音:内容] 标记 → 逐条合成强制发（标记即指令）；
  // ② 对方明确要语音（isVoiceRequested）且 TTS 可用 → 该轮前几段直接升级语音条；
  // ③ 频率计数器（cfg.qq.voiceEvery 每 N 条 1 条）照旧静默升级。
  // 合成失败的段文字补回（保底不丢）；斗图轮（带表情图）不掺语音。
  var voiceClips = [];
  var forcedVoice = ttsOk && (voiceScan.clips.length > 0 || isVoiceRequested(content));
  if (ttsOk && voiceScan.clips.length > 0) {
    for (var vmk = 0; vmk < voiceScan.clips.length && voiceClips.length < 3; vmk++) {
      var vmParts = splitVoicePieces(voiceScan.clips[vmk]);
      if (vmParts.rest) segs.push(vmParts.rest);
      for (var vmi = 0; vmi < vmParts.pieces.length && voiceClips.length < 3; vmi++) {
        var vmPiece = vmParts.pieces[vmi];
        if (!vmPiece) continue;
        var vmClip = await synthesizeQqVoice(cfg, vmPiece);
        if (vmClip) voiceClips.push({ clip: vmClip, text: vmPiece, sent: false });
        else segs.push(vmPiece); // 该片合成失败：文字补回（保底不丢）
      }
    }
  }
  if (!forcedVoice && ttsOk) {
    var every = Number(cfg.qq.voiceEvery || 0);
    if (every > 0 && segs.length && emoHits.length === 0) {
      var counter = 0;
      try { var cst = await supaGetJson('state/qq-voice-counter.json'); counter = (cst && cst.n) || 0; } catch (ce) {}
      var vhit = counter % every === 0;
      counter = vhit ? 1 : counter + 1;
      try { await supaPutJson('state/qq-voice-counter.json', { n: counter, updatedAt: Date.now() }); } catch (ce2) {}
      forcedVoice = vhit;
    }
  }
  if (forcedVoice && !voiceClips.length && segs.length && emoHits.length === 0 && ttsOk) {
    // ②/③ 命中：前 3 段直接升级语音条（v15 分段同款：每段 >200 字按句界再切）
    var vSegs = segs.slice(0, 3);
    segs = segs.slice(vSegs.length);
    for (var vci = 0; vci < vSegs.length && voiceClips.length < 3; vci++) {
      var vParts = splitVoicePieces(vSegs[vci]);
      if (vParts.rest) segs.push(vParts.rest);
      for (var vpi = 0; vpi < vParts.pieces.length && voiceClips.length < 3; vpi++) {
        var vPiece = vParts.pieces[vpi];
        if (!vPiece) continue;
        var vClip = await synthesizeQqVoice(cfg, vPiece);
        if (vClip) voiceClips.push({ clip: vClip, text: vPiece, sent: false });
        else segs.push(vPiece); // 该片合成失败：文字补回（保底不丢）
      }
    }
  }
  // v22 发送预算放开（机主定调：QQ 被动回复没有「一共只能发五条」的平台限制——旧版按
  // 5 次/轮预算把连发 3~30 条压成几条文字墙，是「真机 AI 只发一条」的直接根因）：
  // 文字条数不再设预算，超出 30 条并入末条（与微信侧同口径，不丢内容）；语音条合成上限
  // 3 条照旧（TTS 成本）；表情图平时 3 张 / 斗图 5 张（防刷屏），不挤占文字名额。
  var maxImgs = cfg.qq && cfg.qq.stickerBattle ? 5 : 3;
  var images = [];
  for (var si2 = 0; si2 < emoHits.length && images.length < maxImgs; si2++) {
    var st = emoHits[si2];
    if (st && st.dataUrl && String(st.dataUrl).split(',')[1]) images.push(st);
  }
  if (segs.length > 30) {
    var qqHead = segs.slice(0, 29);
    qqHead.push(segs.slice(29).join('\n'));
    segs = qqHead;
  }
  // v16 QQ 出站净化：经典表情文字代码（[流泪][裂开]…）在机器人通道不渲染——剥掉再发
  for (var csi = 0; csi < segs.length; csi++) segs[csi] = qqStripClassicCodes(segs[csi]);
  // 发送：语音条逐条（失败降级文字）→ 文字连发 → 表情图片（逐张：URL 候选直选 → 托管兜底；单张失败跳过）
  for (var vSendI = 0; vSendI < voiceClips.length; vSendI++) {
    try {
      var vfi = await qqUploadMedia(cfg, authorId, isGroup, d.group_openid, 3, voiceClips[vSendI].clip.url);
      await qqReplyMedia(cfg, authorId, msgId, vfi, isGroup, d.group_openid);
      voiceClips[vSendI].sent = true;
    } catch (ve) {
      segs.push(voiceClips[vSendI].text); // 语音失败：该段文字补回（保底不丢）
    }
  }
  for (var sgi = 0; sgi < segs.length; sgi++) {
    await qqReply(cfg, authorId, msgId, segs[sgi], isGroup, d.group_openid);
  }
  var sentEmo = 0;
  for (var sji = 0; sji < images.length; sji++) {
    if (!images[sji] || (!images[sji].dataUrl && !images[sji].url)) continue;
    // v19 url 制发送（候选逐个试）：CDN 直选 → 网关托管 → 云端公桶；全失败跳过该张
    var sentOne = await qqSendStickerImage(cfg, authorId, msgId, isGroup, d.group_openid, images[sji]);
    if (sentOne) sentEmo++;
  }
  // 历史回写（网站拉取展示）：v13 逐条连发落库（= 站内多条气泡）；语音条 [语音] 摘要；
  // v10 角色格式 user/assistant（与微信 history.json 同构，被本文件自己的 LLM 上下文消费）。
  // 手机 App 拉取端（pullQqCloudHistory）已做双向兼容（me/peer 旧条目照常合入）。
  // v21：对方消息已在认领后先入列（上方 appendQqHistory）——这里只落 TA 的回复；
  // 逐条 append 只写内存+本地，轮末一次批量上云（写放大 N→1）。
  // v21 兜底：loadQqHistory 冷读可能整表重置（Storage 读失败时 HIST_QQ 被清空）——
  // 轮末再补一次对方这条（幂等：还在就跳过），云端批量写与内存不缺这条。
  await appendQqHistory({ id: 'q-' + msgId, role: 'user', content: content.slice(0, 500), ts: Date.now() });
  for (var vhi = 0; vhi < voiceClips.length; vhi++) {
    if (!voiceClips[vhi].sent) continue;
    await appendQqHistory({ id: 'qv-' + msgId + '-' + vhi, role: 'assistant', content: ('[语音] ' + voiceClips[vhi].text).slice(0, 500), ts: Date.now() });
  }
  for (var hgi = 0; hgi < segs.length; hgi++) {
    await appendQqHistory({ id: 'qr-' + msgId + '-' + hgi, role: 'assistant', content: segs[hgi].slice(0, 500), ts: Date.now() });
  }
  var emoLog = [];
  for (var lei = 0; lei < sentEmo; lei++) emoLog.push('[表情:' + (images[lei] && images[lei].name ? images[lei].name : '') + ']');
  if (emoLog.length) await appendQqHistory({ id: 'qe-' + msgId, role: 'assistant', content: emoLog.join(' ').slice(0, 500), ts: Date.now() });
  // v21 轮末批量上云（一次写代替旧版逐条整文件重写）
  await flushQqHistory();
  // v20 被动回复余量记账（网站回复同步真机用）：记下本轮回了几条（语音+文字+表情图），
  // 站内镜像优先吃被动回窗（免每月 4 条主动配额）。v22 起连发条数放开，used 只作参考记账。
  try {
    var usedQ = segs.length + sentEmo;
    for (var vui = 0; vui < voiceClips.length; vui++) if (voiceClips[vui] && voiceClips[vui].sent) usedQ++;
    await supaPutJson('state/qq-lastmsg.json', {
      msgid: msgId, openid: authorId, isGroup: isGroup ? 1 : 0,
      groupOpenid: (d && d.group_openid) || '', at: Date.now(), used: usedQ,
    });
  } catch (le) { /* 记账失败不影响本轮回复 */ }
  return true;
  } catch (e) {
    // 失败即释：回复没发出去（LLM 失败 / QQ 接口失败）时释放认领，下一轮可重试；
    // 回复成功的路径保留认领，直到 TTL 过期（期间同条事件的重发一律不回）
    try { await clearQqClaim(msgId); } catch (ce) { /* 释放失败不掩盖原错误 */ }
    throw e;
  }
}

async function writeHeartbeat(extra) {
  await supaPutJson('state/heartbeat.json', Object.assign({
    lastRunAt: Date.now(),
    codeSource: CODE_SOURCE,
    ok: true,
    wxMsgError: WX_MSG_ERR || undefined,
    wxMsgErrorAt: WX_MSG_ERR_AT || undefined,
  }, extra || {}));
}

/** QQ WebSocket 连接锁（v9）：同一机器人账号同时开两条长连接会互踢会话——本站网关
 *  （免费加速器）与云端函数（Supabase 定时任务）用这把锁互斥，谁在线谁持有（40s TTL，
 *  持有期间每 15s 续期）；另一方看到新鲜锁就不连，让消息只走一条活连接。 */
var QQ_WS_LOCK_TTL = 40000;
async function refreshQqWsLock(owner) {
  await supaPutJson('state/qq-ws-lock.json', { at: Date.now(), owner: String(owner || '') });
}
async function qqWsLockBlocked(owner) {
  var l = await supaGetJson('state/qq-ws-lock.json');
  return !!(l && typeof l.at === 'number' && typeof l.owner === 'string' && l.owner !== String(owner || '') && Date.now() - l.at < QQ_WS_LOCK_TTL);
}
`;

// ---------------- Ed25519：Deno 版（Web Crypto，Edge Function 用） ----------------

const ED25519_DENO = String.raw`
// ---- QQ Webhook Ed25519（Deno Web Crypto；算法官方文档：seed=BotSecret 重复到32字节） ----
function seedBytes(seedStr) {
  var out = new Uint8Array(32);
  for (var i = 0; i < 32; i++) out[i] = seedStr.charCodeAt(i) & 0xff;
  return out;
}

async function edSign(seedStr, dataBytes) {
  var key = await crypto.subtle.importKey('raw', seedBytes(seedStr), { name: 'Ed25519' }, false, ['sign']);
  var sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, dataBytes);
  return new Uint8Array(sig);
}

async function edVerify(seedStr, dataBytes, sigBytes) {
  try {
    var key = await crypto.subtle.importKey('raw', seedBytes(seedStr), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, dataBytes);
  } catch (e) { return false; }
}

function hexToBytes(hex) {
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(b) {
  var s = '';
  for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}

/** QQ Webhook 处理（Edge Function 入口调用）：校验请求 / 事件验签+代答。返回 Response */
async function handleQqWebhook(cfg, req, rawBodyText) {
  var seed = qqSeed(cfg.qq.appSecret);
  if (!seed) return Response.json({ error: 'no secret' }, { status: 400 });
  var payload = null;
  try { payload = JSON.parse(rawBodyText); } catch (e) { payload = null; }
  if (!payload || typeof payload !== 'object') return Response.json({ error: 'bad json' }, { status: 400 });
  var d = payload.d || payload.data;
  // 回调已生效标记（手机 App 自动检测用，v6）：QQ 平台的校验请求或事件推送到达即写入
  // state/qq-callback.json——接入页轮询它，用户在 q.qq.com 控制台配置完回调即自动点亮，无需手点验证
  try { await supaPutJson('state/qq-callback.json', { at: Date.now(), kind: d && d.plain_token ? 'validation' : 'event' }); } catch (e0) { /* 尽力而为，不影响回包 */ }
  // 1) 校验请求：d 里带 plain_token/event_ts → 返回 {plain_token, signature}
  if (d && typeof d === 'object' && d.plain_token) {
    var msg = String(d.event_ts || '') + String(d.plain_token);
    var sig = await edSign(seed, new TextEncoder().encode(msg));
    return Response.json({ plain_token: d.plain_token, signature: bytesToHex(sig) });
  }
  // 2) 事件推送：验签 X-Signature-Ed25519（timestamp + body）
  var sigHex = req.headers.get('x-signature-ed25519') || '';
  var ts = req.headers.get('x-signature-timestamp') || '';
  if (sigHex && ts) {
    var data = new TextEncoder().encode(ts + rawBodyText);
    var ok = await edVerify(seed, data, hexToBytes(sigHex));
    if (!ok) return Response.json({ error: 'bad signature' }, { status: 401 });
  }
  var t = payload.t || payload.event_type || '';
  if (t === 'C2C_MESSAGE_CREATE' || t === 'GROUP_AT_MESSAGE_CREATE') {
    try {
      await handleQqEvent(cfg, t, d);
      return Response.json({ ok: true });
    } catch (e) {
      // 回复失败也回 200，避免平台反复重推同一条消息（历史里已去重）
      return Response.json({ ok: false, error: String(e && e.message).slice(0, 200) });
    }
  }
  return Response.json({ ok: true, ignored: t || 'unknown' });
}
`;

// ---------------- Ed25519：Node 版（node:crypto PKCS8 DER 拼装，容器用） ----------------

const ED25519_NODE = String.raw`
// ---- QQ Webhook Ed25519（Node crypto；seed=BotSecret 重复到32字节 → PKCS8 DER 前缀拼装） ----
var ED_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function edPriv(seedStr) {
  var seed = Buffer.from(seedStr, 'latin1').slice(0, 32);
  var der = Buffer.concat([ED_PKCS8_PREFIX, seed]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function edSignHex(seedStr, dataBuf) {
  return crypto.sign(null, dataBuf, edPriv(seedStr)).toString('hex');
}

function edVerifyHex(seedStr, dataBuf, sigHex) {
  try {
    var pub = crypto.createPublicKey(edPriv(seedStr));
    return crypto.verify(null, dataBuf, pub, Buffer.from(sigHex, 'hex'));
  } catch (e) { return false; }
}

/** QQ Webhook 处理（Node 容器 HTTP 入口调用）：返回 {status, body} */
async function handleQqWebhookNode(cfg, headers, rawBodyText) {
  var seed = qqSeed(cfg.qq.appSecret);
  if (!seed) return { status: 400, body: { error: 'no secret' } };
  var payload = null;
  try { payload = JSON.parse(rawBodyText); } catch (e) { payload = null; }
  if (!payload || typeof payload !== 'object') return { status: 400, body: { error: 'bad json' } };
  var d = payload.d || payload.data;
  // 回调已生效标记（手机 App 自动检测用，v6，同 Deno 版）：校验请求或事件推送到达即写入
  try { await supaPutJson('state/qq-callback.json', { at: Date.now(), kind: d && d.plain_token ? 'validation' : 'event' }); } catch (e0) { /* 尽力而为，不影响回包 */ }
  if (d && typeof d === 'object' && d.plain_token) {
    var msg = Buffer.from(String(d.event_ts || '') + String(d.plain_token), 'utf8');
    return { status: 200, body: { plain_token: d.plain_token, signature: edSignHex(seed, msg) } };
  }
  var sigHex = (headers['x-signature-ed25519'] || '').toLowerCase();
  var ts = headers['x-signature-timestamp'] || '';
  if (sigHex && ts) {
    var ok = edVerifyHex(seed, Buffer.from(ts + rawBodyText, 'utf8'), sigHex);
    if (!ok) return { status: 401, body: { error: 'bad signature' } };
  }
  var t = payload.t || payload.event_type || '';
  if (t === 'C2C_MESSAGE_CREATE' || t === 'GROUP_AT_MESSAGE_CREATE') {
    try {
      await handleQqEvent(cfg, t, d);
      return { status: 200, body: { ok: true } };
    } catch (e) {
      return { status: 200, body: { ok: false, error: String(e && e.message).slice(0, 200) } };
    }
  }
  return { status: 200, body: { ok: true, ignored: t || 'unknown' } };
}
`;

// ---------------- （v5 已移除）自动开定时轮询 ----------------
// 旧版 setup-cron/stop-cron 用 npm:postgres@3.5.4 直连用户库执行 cron.schedule——
// 该版本在 npm 上不存在，Supabase Edge 运行时解析报「Could not find constraint
// 'postgres@3.5.4' in the list of packages」，且每分钟定时轮询会烧爆免费额度（546
// WORKER_RESOURCE_LIMIT）。v5 彻底改为被动 Webhook：QQ 消息由平台推送进函数、微信
// 由手机页面本机回复或手动「云端测试一次」单轮收发；清旧定时任务改走服务端
// Management API SQL（/api/cloud-deploy 的 unschedule-cron），不再需要 npm 依赖。


// ---------------- Node 常驻容器版（HF Space / ClawCloud / 本地盒子） ----------------

export const ASSISTANT_MJS = `#!/usr/bin/env node
/**
 * 云端助手 · Node 常驻版（HF Space Docker / ClawCloud / 任意 Node 20+ 盒子）
 *
 * ENV（HF Spaces 用 Settings→Secrets 添加；ClawCloud 用环境变量）：
 *   SUPA_URL  你自己的 Supabase 项目地址，如 https://xxxx.supabase.co
 *   SUPA_KEY  你自己的 Supabase service_role key（手机 App 部署时自动生成）
 *
 * 职责：微信长轮询代答 + QQ Webhook（POST /qq）+ 状态页（GET /）。
 * 配置从 Supabase Storage 私有桶 wx-cloud/config.json 读取，
 * 在手机 App 里改绑定角色 / 换 API 后重新同步即生效，无需重建容器。
 */
import http from 'node:http';
import crypto from 'node:crypto';
const CODE_SOURCE = 'node';
var SUPA_URL_INJECT = process.env.SUPA_URL || '';
var SUPA_KEY_INJECT = process.env.SUPA_KEY || '';
var LAST_RUN_AT = 0;
var LAST_ERROR = '';
${WX_CLOUD_CORE}
${ED25519_NODE}
async function main() {
  if (!SUPA_URL || !SUPA_KEY) {
    console.error('缺少 SUPA_URL / SUPA_KEY 环境变量');
    process.exit(1);
  }
  console.log('[wx-assistant] 启动：', SUPA_URL);
  // CORS（v3）：手机 App 页面浏览器直连本容器（HF Space / ClawCloud 域名）验证凭证、测试云端
  // 时会先发 OPTIONS 预检——没有这组头浏览器一律 TypeError: Failed to fetch
  function corsHeaders() {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Task-Secret, X-Task-Action, X-Signature-Ed25519, X-Signature-Timestamp, Authorization',
      'Access-Control-Max-Age': '86400',
    };
  }
  http.createServer(async function (req, res) {
    try {
      // CORS 预检：直接放行
      if (req.method === 'OPTIONS') {
        res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain' }, corsHeaders()));
        res.end('ok');
        return;
      }
      // QQ Webhook 入口
      if (req.method === 'POST' && /^\\/qq\\/?$/.test(req.url || '')) {
        var chunks = [];
        for await (const c of req) chunks.push(c);
        var body = Buffer.concat(chunks).toString('utf8');
        var cfg = await loadConfig(false);
        if (!cfg.qq || !cfg.qq.appId) {
          res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, corsHeaders()));
          res.end(JSON.stringify({ ok: false, error: '未配置 QQ' }));
          return;
        }
        var out = await handleQqWebhookNode(cfg, req.headers, body);
        res.writeHead(out.status, Object.assign({ 'Content-Type': 'application/json' }, corsHeaders()));
        res.end(JSON.stringify(out.body));
        return;
      }
      // 云端验证 QQ 凭证（POST /verify-qq，body {appId, appSecret}；绕开本机网络限制）
      if (req.method === 'POST' && /^\\/verify-qq\\/?$/.test(req.url || '')) {
        var vchunks = [];
        for await (const vc of req) vchunks.push(vc);
        var vbody = {};
        try { vbody = JSON.parse(Buffer.concat(vchunks).toString('utf8')); } catch (ve) {}
        var vr = await verifyQqCreds(vbody.appId, vbody.appSecret);
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, corsHeaders()));
        res.end(JSON.stringify(vr));
        return;
      }
      // 状态页（保活 ping / 测试）：带 wxMsgError（微信逐条回复失败的原因——LLM 配置无效/
      // 网络不通时主人在「测试云端」里就能看到，不再静默丢消息）
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, corsHeaders()));
      res.end(JSON.stringify({ ok: true, source: 'node', lastRunAt: LAST_RUN_AT, lastError: LAST_ERROR, wxMsgError: WX_MSG_ERR, cfgLoaded: !!CFG }));
    } catch (e) {
      res.writeHead(500, Object.assign({ 'Content-Type': 'application/json' }, corsHeaders()));
      res.end(JSON.stringify({ ok: false, error: String(e && e.message) }));
    }
  }).listen(Number(process.env.PORT || 7860), '0.0.0.0');
  var errs = 0;
  for (;;) {
    try {
      var n = await tick();
      errs = 0;
      LAST_RUN_AT = Date.now();
      LAST_ERROR = '';
      if (n > 0) console.log(new Date().toISOString(), '微信回复了', n, '条消息');
      await writeHeartbeat({ source: 'node' });
    } catch (e) {
      var msg = String(e && e.message);
      LAST_ERROR = msg;
      if (msg.indexOf('TOKEN_EXPIRED') >= 0) {
        console.error('[wx-assistant] 微信 Token 已过期，需回手机 App 重新扫码；暂停 5 分钟');
        await writeHeartbeat({ ok: false, lastError: '微信 Token 已过期，请回手机 App 重新扫码接入' });
        await new Promise(function (r) { setTimeout(r, 300000); });
      } else if (msg.indexOf('未配置') >= 0 || msg.indexOf('运行包缺失') >= 0) {
        console.error('[wx-assistant]', msg);
        await new Promise(function (r) { setTimeout(r, 60000); });
      } else {
        errs++;
        console.error('[wx-assistant] 轮询失败(' + errs + '):', msg);
        await new Promise(function (r) { setTimeout(r, Math.min(5000 * errs, 30000)); });
        if (errs >= 5) { UPDATES_BUF = ''; errs = 0; }
      }
    }
  }
}
main().catch(function (e) { console.error(e); process.exit(1); });
`;

// ---------------- Supabase Edge Function 版（Deno，被动 Webhook + 手动单轮） ----------------

export const EDGE_FUNCTION_TS = `// 云端助手 · Supabase Edge Function（Deno）· v19 真机富媒体根修版（v13：连发分段/世界书运行时命中/[M编号]引用/深度思考剥除/富媒体标记净化/表情包ID直选/语音条首段化；v14：连发 3~30 条 + max_tokens 2400 + 微信真表情包（AES-128-ECB→CDN→image_item）+ QQ 超预算均匀分摊；v15：入站引用解析 + QQ 超长语音分段 + QQ 斗图模式 + 照片标记；v16：QQ 语音条标记强制发送 + QQ 经典表情代码剥离 + 微信引用下线 + 照片下线 + 主动消息改站内驱动（send-active）+ 云端轮询 10 秒分档（fast=1 / qq=1）；v17：QQ 语音云端 LLM 兜底合成（没配 TTS 用聊天 API 试 /audio/speech）+ 同步升级链收紧（探测不到 ver 也重部署）；v19：微信表情包 aes_key 对齐官方 SDK（base64(hex 文本)——旧版发 base64(原始 16 字节)接收端解不开 →「图片已过期或已被清理」）+ QQ 富媒体 url 制（官方 v2 files 接口只收 url：内置包 CDN URL 直发 + 语音 silk/用户表情托管公桶 qqHostMediaCloud）+ upload-file 支持 encoding:'base64' 二进制）
// 函数 slug：wx-assistant（QQ 回调地址 / 云端测试 URL = https://<项目ref>.supabase.co/functions/v1/wx-assistant）。
// 注意：本行的 wx-assistant 标记同时是部署接口（/api/cloud-deploy/supabase op=deploy）的产品
// 校验标记——v5 移除函数内 pg_cron 路径时把它一并带走过一次，导致一键部署全线 400
// invalid_code；改动此处时必须保留该字面量。
// v9 架构（用户 Supabase 项目 = 7×24 骨干，不依赖本站在线）：
// - 定时任务 pg_cron 每分钟打一次 action=cron-cycle：微信单轮收发（getupdates 长轮询）+
//   QQ WebSocket 会话保持到预算（~135s；会话+seq 存 state/qq-ws-session.json，断点
//   Resume 续传——QQ 官方出站长连接，不需要境内回调出口，绕开平台对 Webhook 的地域限制）。
// - 双轮询器安全（WX_CLOUD_CORE v9）：轮询锁 + 认领表——本站网关（免费加速器）与
//   本函数并发跑也不会双回；微信轮询锁 50s TTL、QQ 连接锁 40s TTL 互相让位。
// - 手动「云端测试一次」仍走默认分支（单轮收发，验通道兼补收）。
// QQ：同一函数 URL 直接当 QQ Webhook 回调地址（q.qq.com 控制台回调配置直接填它，
// 无签名头的 plain_token 校验也能命中）——Webhook 与 WebSocket 双通道都可用。
// CORS：手机 App 页面带 X-Task-Secret 等自定义头浏览器直连本函数（云端验证凭证 /
// 测试云端），会先发 OPTIONS 预检——没有这组头浏览器一律报
// TypeError: Failed to fetch（v3 修复：所有响应统一带 CORS 头 + OPTIONS 直接放行）。
const CODE_SOURCE = 'deno';
var SUPA_URL_INJECT = Deno.env.get('SUPABASE_URL') || '';
var SUPA_KEY_INJECT = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
// v4：部署时 Management API secrets 注入的任务密钥——upload-file 动作用它鉴权（首次
// 部署时桶里还没 config.json 可比对 secret，靠这个先立住信任链；与 config.secret 同值）
var TASK_SECRET_ENV = Deno.env.get('WX_TASK_SECRET') || '';
${WX_CLOUD_CORE}
${ED25519_DENO}
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Task-Secret, X-Task-Action, X-Signature-Ed25519, X-Signature-Timestamp, Authorization, apikey',
  'Access-Control-Max-Age': '86400',
};
function jr(obj, status) { return Response.json(obj, { status: status || 200, headers: CORS_HEADERS }); }
// v16 10 秒轮询档的心跳节流计数器（fast 分支用：每 3 轮写一次心跳，回过消息的轮必写）
var FAST_TICKS = 0;

/** QQ 信封形状态（无自定义鉴权头的 POST 是否像 QQ 平台回调）：校验请求带 plain_token；
 *  事件推送带 t/op/intent_type 等信封键——我们自己的调用一定带 action 或 secret */
function looksQqEnvelope(raw) {
  var s = String(raw || '').slice(0, 600);
  if (/"plain_token"/.test(s)) return true;
  if (/"(?:t|event_type|event|op|intent_type|id)"\\s*:\\s*"/.test(s)) return true;
  if (/"d"\\s*:\\s*\\{/.test(s) && /"(?:op|t|id)"\\s*:/.test(s)) return true;
  return false;
}

/** QQ WebSocket 会话保持（Deno 版，v9）：连官方 wss 网关 → Identify/Resume → 心跳 →
 *  事件交 handleQqEvent（人设/表情包/语音条/历史回写全在 WX_CLOUD_CORE）→ 预算耗尽前
 *  干净收尾（会话 id + seq 落盘 state/qq-ws-session.json，下一轮 Resume 续传，平台补发
 *  断线期间的事件——QQ 级的"断连自动回补"）。与本站网关互斥：qq-ws-lock（对方 40s 内
 *  活跃 → 本轮跳过不抢会话；持有期间每 15s 续期）。 */
async function qqWsHold(cfg, budgetMs) {
  if (!cfg.qq || !cfg.qq.appId) return { skipped: 'no-qq' };
  const OWNER = 'edge';
  if (await qqWsLockBlocked(OWNER)) return { skipped: 'gateway-holding' };
  const token = await qqToken(cfg);
  const gwr = await fetch('https://api.sgroup.qq.com/gateway', {
    headers: { Authorization: 'QQBot ' + token },
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  const gwj = gwr ? await gwr.json().catch(() => null) : null;
  const wssUrl = gwj && typeof gwj.url === 'string' && gwj.url ? gwj.url : '';
  if (!wssUrl) return { error: 'QQ 网关地址获取失败' };
  await refreshQqWsLock(OWNER);
  const sess = await supaGetJson('state/qq-ws-session.json');
  const canResume = !!(sess && typeof sess.sessionId === 'string' && sess.sessionId &&
    typeof sess.at === 'number' && Date.now() - sess.at < 600000 &&
    typeof sess.seq === 'number' && sess.seq > 0);
  let sessionId = canResume ? sess.sessionId : '';
  let lastSeq = canResume ? sess.seq : 0;
  const t0 = Date.now();
  let nEvents = 0;
  let closed = false;
  let hbOk = true;
  let hbTimer = null;
  let keepTimer = null;
  let queue = Promise.resolve();
  const ws = new WebSocket(wssUrl);
  const saveSess = () => {
    if (!sessionId) return;
    void supaPutJson('state/qq-ws-session.json', { sessionId: sessionId, seq: lastSeq, at: Date.now() });
  };
  const cleanup = () => {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    if (keepTimer) { clearInterval(keepTimer); keepTimer = null; }
    saveSess();
    if (ws.readyState === 0 || ws.readyState === 1) {
      try { ws.close(1000, 'budget'); } catch (e) { /* 忽略 */ }
    }
  };
  ws.addEventListener('message', (ev) => {
    let f = null;
    try { f = JSON.parse(String(ev.data)); } catch (e) { return; }
    if (!f || typeof f !== 'object') return;
    if (typeof f.s === 'number' && f.s > 0) lastSeq = f.s;
    const op = Number(f.op);
    if (op === 10) {
      // Hello：心跳周期 + 登录鉴权（有会话则 Resume 续传，官方补发断线期间的事件）
      const hbInt = Number(f.d && f.d.heartbeat_interval) || 41250;
      hbOk = true;
      if (hbTimer) clearInterval(hbTimer);
      hbTimer = setInterval(() => {
        if (closed || ws.readyState !== 1) { if (hbTimer) clearInterval(hbTimer); return; }
        if (!hbOk) { try { ws.close(); } catch (e) { /* 忽略 */ } return; }
        hbOk = false;
        try { ws.send(JSON.stringify({ op: 1, d: lastSeq || null })); } catch (e) { /* 忽略 */ }
      }, hbInt);
      try {
        if (sessionId && lastSeq) {
          ws.send(JSON.stringify({ op: 6, d: { token: 'QQBot ' + token, session_id: sessionId, seq: lastSeq } }));
        } else {
          ws.send(JSON.stringify({ op: 2, d: { token: 'QQBot ' + token, intents: 1 << 25, shard: [0, 1], properties: { $os: 'deno', $browser: 'wx-assistant', $device: 'wx-assistant' } } }));
        }
      } catch (e) { /* 忽略 */ }
      return;
    }
    if (op === 11) { hbOk = true; return; }
    if (op === 7) { try { ws.close(); } catch (e) { /* 忽略 */ } return; }
    if (op === 9) { sessionId = ''; try { ws.close(); } catch (e) { /* 忽略 */ } return; }
    if (op === 0) {
      const t = String(f.t || '');
      if (t === 'READY') { sessionId = String((f.d && f.d.session_id) || ''); saveSess(); return; }
      if (t === 'RESUMED') return;
      if (t === 'C2C_MESSAGE_CREATE' || t === 'GROUP_AT_MESSAGE_CREATE') {
        nEvents += 1;
        const dEv = (f.d || {});
        const tt = t;
        queue = queue.then(async () => {
          try { await handleQqEvent(cfg, tt, dEv); } catch (e) { /* 单条失败不拖垮会话 */ }
        }).catch(() => undefined);
      }
      return;
    }
  });
  ws.addEventListener('close', () => { closed = true; });
  ws.addEventListener('error', () => { closed = true; });
  // 等连上（最多 20s）
  for (let oi = 0; oi < 20 && !closed && ws.readyState === 0; oi++) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (closed || ws.readyState !== 1) { cleanup(); return { error: 'QQ WS 连接失败' }; }
  // 预算保持：每 15s 续锁 + 存会话断点；最后 ~33s 留给在途回复排空（不撞函数 150s 硬限）
  keepTimer = setInterval(() => {
    void refreshQqWsLock(OWNER);
    saveSess();
  }, 15000);
  while (!closed && Date.now() - t0 < budgetMs - 33000) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  closed = true;
  cleanup();
  await Promise.race([queue, new Promise((r) => setTimeout(r, 30000))]);
  return { ok: true, events: nEvents, seconds: Math.round((Date.now() - t0) / 1000) };
}

Deno.serve(async (req) => {
  // CORS 预检：非简单请求（自定义头 / JSON body）的跨域 POST 会先打 OPTIONS，直接放行
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS_HEADERS });
  const url = new URL(req.url);
  try {
    const action = url.searchParams.get('action') || req.headers.get('x-task-action') || '';
    const secret = req.headers.get('x-task-secret') || url.searchParams.get('secret') || '';

    // ---- QQ Webhook（被动接收，消息来了才运行）：显式 /qq 路径 / 官方签名头 /
    // 无我们鉴权头但 body 是 QQ 信封（校验请求 plain_token 无签名头——QQ 控制台回调
    // 地址直接填函数 URL 即可命中，不用带任何自定义头） ----
    const isQqPath = /\\/qq\\/?$/.test(url.pathname);
    const hasQqSig = req.headers.get('x-signature-ed25519');
    if (req.method === 'POST' && (isQqPath || hasQqSig || (!action && !secret))) {
      const raw = await req.text();
      if (isQqPath || hasQqSig || looksQqEnvelope(raw)) {
        const cfg = await loadConfig(false);
        if (!cfg.qq || !cfg.qq.appId) return jr({ ok: false, error: '未配置 QQ' });
        return await handleQqWebhook(cfg, req, raw);
      }
      return jr({ ok: false, error: 'bad secret' }, 401);
    }

    // ---- upload-file：手机 App 把运行包文件托云端代写 Storage（v4）----
    // 必须放在 loadConfig 之前：首次部署时桶里还没有 config.json（loadConfig 会抛
    // 「运行包缺失」）。鉴权优先用注入的 WX_TASK_SECRET；没注入成功时退回读一次桶里
    // config.json 的 secret 校验（老函数没有这个动作，走不到这里）。写入用平台注入的
    // SUPABASE_SERVICE_ROLE_KEY——用户的 Storage key 被项目全拒（JWT 轮换后的
    // signature verification failed 等）也能照常部署。
    if (action === 'upload-file') {
      let cfgSecret = '';
      try {
        const c0 = await supaGetJson('config.json');
        cfgSecret = c0 && c0.secret ? String(c0.secret) : '';
      } catch (e) { /* 读取失败按没有处理 */ }
      const authed = !!(secret && (TASK_SECRET_ENV === secret || (cfgSecret && cfgSecret === secret)));
      if (!authed) return jr({ ok: false, error: 'bad secret' }, 401);
      let body = { files: [] };
      try { body = await req.json(); } catch (e) { /* 空 body */ }
      const filesUp = Array.isArray(body.files) ? body.files.slice(0, 8) : [];
      const uploaded = [];
      let validCount = 0;
      let lastUpErr = '';
      // 先确保两个桶都在（幂等：已存在=成功）——SQL/REST 建桶路径都失败时这条能补上
      for (const b of [{ id: 'wx-cloud', public: false }, { id: 'wx-cloud-public', public: true }]) {
        try {
          const br = await fetch(SUPA_URL + '/storage/v1/bucket', {
            method: 'POST',
            headers: Object.assign(supaHeaders(), { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ id: b.id, name: b.id, public: b.public }),
          });
          const bt = await br.text().catch(() => '');
          if (!br.ok && !(br.status === 409 || /already exists|Duplicate|resource already exists/i.test(bt))) {
            lastUpErr = '建桶失败 ' + b.id + ' ' + br.status + ' ' + String(bt).slice(0, 100);
          }
        } catch (e) { /* 建桶网络失败继续传文件试 */ }
      }
      for (const f of filesUp) {
        const path = String((f && f.path) || '').replace(/[^a-zA-Z0-9._/-]/g, '');
        const bucket = f && f.bucket === 'wx-cloud-public' ? 'wx-cloud-public' : 'wx-cloud';
        const content = typeof (f && f.content) === 'string' ? f.content : '';
        // v19 二进制支持：encoding:'base64'（用户收藏表情/语音 silk 上公桶——QQ 富媒体
        // url 制需要公网 URL，字节数据经部署代理转 base64 传上来，这里解码回字节写入）
        const isB64 = !!(f && typeof f.encoding === 'string' && /^base64$/i.test(f.encoding) && content);
        const rawLen = isB64 ? Math.floor((content.length * 3) / 4) : content.length;
        if (!path || path.length > 128 || !content || rawLen <= 0 || rawLen > 900000) continue;
        validCount += 1;
        try {
          const body = isB64 ? cloudB64ToBytes(content) : content;
          const r = await fetch(SUPA_URL + '/storage/v1/object/' + bucket + '/' + path, {
            method: 'POST',
            headers: Object.assign(supaHeaders(), { 'x-upsert': 'true', 'Content-Type': (f && f.contentType) || (isB64 ? 'application/octet-stream' : 'text/plain') }),
            body: body,
          });
          if (r.ok) uploaded.push(bucket + '/' + path);
          else lastUpErr = String(await r.text().catch(() => '')).slice(0, 200);
        } catch (e) {
          lastUpErr = '网络错误';
        }
      }
      return jr({ ok: validCount > 0 && uploaded.length === validCount, uploaded: uploaded, error: lastUpErr, via: 'edge-function' });
    }

    // ---- read-file（v8 内置网关中继读）：用户 Supabase 项目密钥拿不到/被拒时（代写路径部署后
    //    serviceKey 为空，或 JWT 轮换后旧 key 全拒），网关的配置/历史/游标读改走这里——函数用
    //    平台注入凭证读 Storage。鉴权同 upload-file（任务密钥优先，兑底比对桶里 config.json 的
    //    secret）；放在 loadConfig 之前同理（config 缺失时不能先抛「运行包缺失」）。
    if (action === 'read-file') {
      let cfgSecret = '';
      try {
        const c0 = await supaGetJson('config.json');
        cfgSecret = c0 && c0.secret ? String(c0.secret) : '';
      } catch (e) { /* 读取失败按没有处理 */ }
      const authed = !!(secret && (TASK_SECRET_ENV === secret || (cfgSecret && cfgSecret === secret)));
      if (!authed) return jr({ ok: false, error: 'bad secret' }, 401);
      let rb: { path?: unknown } = {};
      try { rb = (await req.json().catch(() => ({}))) as { path?: unknown }; } catch (e) { /* 空 body */ }
      const p = String(rb.path || '').replace(/[^a-zA-Z0-9._/-]/g, '');
      if (!p || p.length > 128) return jr({ ok: false, error: 'bad path' }, 400);
      const obj = await supaGetJson(p);
      if (obj === null || obj === undefined) return jr({ ok: false, error: 'not found' }, 404);
      return jr({ ok: true, relay: true, ver: 8, data: obj });
    }

    const cfg = await loadConfig(false);
    // 任务密钥：桶里 config.secret 或部署时注入的 WX_TASK_SECRET 任一命中即可
    if (!(secret && (secret === (cfg && cfg.secret) || (TASK_SECRET_ENV && secret === TASK_SECRET_ENV)))) {
      return jr({ ok: false, error: 'bad secret' }, 401);
    }

    // ---- 管理 action ----
    // v5：setup-cron / stop-cron 已废弃（定时任务改由手机 App 设置里的「云端轮询」开关
    // 走服务端 Management API SQL 建立/清除，不再依赖函数里的 npm:postgres）。兼容老客户端的调用
    if (action === 'setup-cron' || action === 'stop-cron') {
      return jr({ ok: true, note: '定时任务请用手机 App 设置 → 云端助手 的「云端轮询」开关管理（v6 起）；本函数已改为被动 Webhook + 单轮收发' });
    }
    // 云端验证 QQ 凭证（绕开本机网络限制：从这台云服务器的出口连 QQ 平台）
    if (action === 'verify-qq') {
      let body = { appId: '', appSecret: '' };
      try { body = await req.json(); } catch (e) { /* 空 body */ }
      const r = await verifyQqCreds(body.appId, body.appSecret);
      return jr(r);
    }
    if (action === 'ping') {
      await writeHeartbeat({ ping: true });
      // ver：内置网关探测函数代际用（read-file 中继读写 = ver>=8；旧版函数 ping 无 ver 字段）；
      // 站内「重新同步运行包」拿它判断要不要重部署函数代码升级运行时（旧版不升 = 真机上
      // 一直跑旧行为：只回一两条/不会表情包/不会语音/发裸标记——「重新同步只推配置不推代码」
      // 的坑；v17 起探测不到 ver 也重部署，旧函数不再永远升不了级）。
      // v19：微信表情包 aes_key 根修 + QQ 富媒体 url 制（内置包 CDN 直发 + 语音/表情公桶托管）
      // + upload-file 二进制——真机微信/QQ 表情包、QQ 语音的全量可用代际。
      // v20：QQ 入站图片 URL 提取占位统一 + send-active QQ 被动回复余量优先（网站回复镜像
      // 零配额送达窗口）+ 载入本地直推表情清单兑底（网关通道同款合并口径）。
      return jr({ ok: true, source: 'deno', ver: 20 });
    }

    // ---- v16 send-active（站内「主动发消息」引擎触发）：把站内已生成的主动消息内容发到
    // 真机微信/QQ。微信用最近会话上下文（state/wx-lastctx.json），QQ 用活跃消息接口
    // （state/qq-active.json 记的 openid；QQ 平台限每月 4 条）。 ----
    if (action === 'send-active') {
      let body = { channel: '', texts: [] };
      try { body = await req.json(); } catch (e) { /* 空 body */ }
      const r = await cloudSendActive(cfg, String(body.channel || ''), Array.isArray(body.texts) ? body.texts : []);
      return jr(r);
    }

    // ---- v9 cron-cycle（Supabase 定时任务打）：微信单轮收发 + QQ WebSocket 会话保持到预算
    // ——云端 7×24 骨干，不依赖本站在线。会话断点存 state/qq-ws-session.json，下轮 Resume 续传
    // （平台补发断线期间的事件）；本站网关在线时（qq-ws-lock）自动让位。
    // v16 分档：?fast=1（每 10 秒的 pg_cron 打：只做 tickFast 短窗单轮，不做 QQ WS——高频档
    // 短快返回）；?qq=1（每分钟的 pg_cron 打：只做 QQ WS 保持，微信轮由 fast 档覆盖）；
    // 不带参数 = 旧行为（tick + QQ WS，兼容存量 1 分钟任务直到重新调度）。 ----
    if (action === 'cron-cycle') {
      const t0 = Date.now();
      const fast = url.searchParams.get('fast') === '1';
      const qqOnly = url.searchParams.get('qq') === '1';
      if (fast) {
        // 10 秒轮询档：短窗单轮 getupdates（有消息立刻回，超窗空手）——心跳每 3 轮写一次
        // （8640 次/天的 Storage 写没必要；回过消息的轮必写），返回秒级
        FAST_TICKS = (Number(FAST_TICKS) || 0) + 1;
        let handledFast = 0;
        let lastErrorFast = '';
        try {
          handledFast += await tickFast();
        } catch (e) {
          lastErrorFast = String(e && e.message);
        }
        if (handledFast > 0 || FAST_TICKS % 3 === 1) {
          await writeHeartbeat({ handled: handledFast, lastError: lastErrorFast, source: 'fast-poll' });
        }
        return jr({ ok: !lastErrorFast, handled: handledFast, lastError: lastErrorFast, wxMsgError: WX_MSG_ERR || '', ranMs: Date.now() - t0 });
      }
      let handled = 0;
      let lastError = '';
      if (!qqOnly) {
        try {
          handled += await tick();
        } catch (e) {
          lastError = String(e && e.message);
        }
      }
      let qq = { skipped: 'no-qq' };
      // 微信轮询这轮还没把预算吃光才开 QQ 保持（消息多/LLM 慢时优先微信）；qqOnly 档预算全给 QQ
      if (!qqOnly && Date.now() - t0 >= 100000) {
        qq = { skipped: 'wx-busy' };
      } else {
        try {
          qq = await qqWsHold(cfg, (qqOnly ? 135000 : 135000 - (Date.now() - t0)));
        } catch (e) {
          qq = { error: String(e && e.message).slice(0, 120) };
        }
      }
      await writeHeartbeat({ handled: handled, lastError: lastError, source: qqOnly ? 'qq-hold' : 'cron-cycle' });
      return jr({ ok: !lastError, handled: handled, lastError: lastError, wxMsgError: WX_MSG_ERR || '', qq: qq, ranMs: Date.now() - t0 });
    }

    // ---- 默认：微信单轮收发（手动「云端测试一次」触发；一次 getupdates 服务端挂
    // ~35s，零 CPU 热转——旧版 100s 热循环轮询是 546 WORKER_RESOURCE_LIMIT 的根因；
    // 定时任务已由 cron-cycle 承担，本分支只做单轮验证/补收） ----
    const t0 = Date.now();
    let handled = 0;
    let lastError = '';
    try {
      handled += await tick();
    } catch (e) {
      lastError = String(e && e.message);
    }
    await writeHeartbeat({ handled: handled, lastError: lastError });
    return jr({ ok: !lastError, handled: handled, lastError: lastError, wxMsgError: WX_MSG_ERR || '', ranMs: Date.now() - t0 });
  } catch (e) {
    return jr({ ok: false, error: String(e && e.message).slice(0, 200) }, 500);
  }
});
`;

// ---------------- HF Space Dockerfile ----------------

/** HF Space 的 Dockerfile（公共 Space 也无泄露：密钥走 HF Secrets，不在文件里） */
export function hfDockerfile(): string {
  return [
    '# 云端助手 · HF Space（Docker SDK）',
    '# 密钥在 Space 的 Settings → Secrets 里添加：SUPA_URL / SUPA_KEY',
    'FROM node:20-alpine',
    'WORKDIR /app',
    'COPY assistant.mjs ./assistant.mjs',
    '# QQ 语音条用的 silk 编码器（silk-wasm + wasm 二进制，缺了语音自动降级文字）',
    'COPY silk-wasm.mjs ./silk-wasm.mjs',
    'COPY silk.wasm ./silk.wasm',
    'ENV NODE_ENV=production',
    'EXPOSE 7860',
    'CMD ["node", "assistant.mjs"]',
    '',
  ].join('\n');
}

/** 生成 HF Space 的部署说明（含 Secrets 与 Webhook 配置） */
export function hfDeployGuide(spaceUrl: string, statusUrl: string): string {
  return [
    '1. 打开你的 Space → Settings → Variables and secrets → New secret，添加两个：',
    '   SUPA_URL = 你的 Supabase 项目地址（https://xxxx.supabase.co）',
    '   SUPA_KEY = 你的 Supabase service_role key（部署参数里可复制）',
    '2. Space 会自动重建并启动；状态页：' + statusUrl,
    '3. 保活：到 cron-job.org 免费注册一个每 30 分钟 GET ' + statusUrl + ' 的任务（HF 48 小时无访问会休眠）',
    '4. QQ Webhook（可选）：回调地址填 ' + (statusUrl.endsWith('/') ? statusUrl.slice(0, -1) : statusUrl) + '/qq',
    'Space 地址：' + spaceUrl,
  ].join('\n');
}
