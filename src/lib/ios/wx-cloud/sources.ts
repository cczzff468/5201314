/**
 * 云端助手运行时源码 v2（模板字符串，部署时下发）。
 *
 * 三种职责、两个运行时：
 * - 微信收发（getupdates 长轮询 → 人设回复 → sendmessage）：Node 容器常驻跑；
 *   Supabase Edge Function 由 pg_cron 每分钟触发、单次 100s 预算内轮询。
 * - QQ Webhook（官方已停 WebSocket，走 HTTP 回调）：两个运行时的对外 HTTP 入口都能接——
 *   Edge Function 的函数 URL、Node 容器的 POST /qq。处理：Ed25519 验签（Bot Secret 派生
 *   私钥）→ 校验请求签名 plain_token → C2C/群@消息 → 人设回复 → v2 被动回复接口。
 * - 自动开定时轮询（仅 Edge Function）：action=setup-cron 时直连用户数据库（SUPABASE_DB_URL）
 *   执行 cron.schedule，用户无需再手动复制 SQL 到 SQL Editor。
 *
 * 配置（用户 Supabase 私有桶 wx-cloud/config.json，v2 形状）：
 * { version:2, secret, wechat:{botToken,botId,persona,history}, qq:{appId,appSecret,persona,history},
 *   llm:{baseUrl,apiKey,model}, promptTimeZone, syncedAt }
 *
 * 注意：模板里内层代码一律用单双引号，不用反引号，避免与外层模板字面量冲突。
 */

// ---------------- 微信 + QQ 共用核心（Node / Deno 通用，纯 fetch） ----------------

const WX_CLOUD_CORE = String.raw`
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
  var r = await fetch(SUPA_URL + '/storage/v1/object/' + BUCKET + '/' + path, { headers: supaHeaders() });
  if (!r.ok) return null;
  try { return await r.json(); } catch (e) { return null; }
}

async function supaPutJson(path, obj) {
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
  await supaPutJson('history.json', { msgs: (HIST_WX || []).slice(-30), updatedAt: Date.now() });
}

async function ilinkCall(path, botToken, body) {
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
        body: JSON.stringify({ model: llm.model || 'gpt-4o-mini', messages: messages, max_tokens: 500 }),
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
  // 入站图片/表情包（type 2，AES 加密看不到内容）：占位让 AI 按语境回应（不整条丢弃）
  for (var k = 0; k < list.length; k++) {
    if (list[k] && list[k].type === 2) return '（对方发了一个表情包/图片，内容看不到）';
  }
  return '';
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
function sanitizeWxOutText(text) {
  var tagRe = /[\[【]\s*(?:发送了|发出了)?\s*(?:表情包|表情|图片|照片|语音|贴纸|Sticker)\s*[:：]\s*([^\]】]{1,24})\s*[\]】]/g;
  var out = String(text || '').replace(tagRe, function (_all, rawName) {
    var name = String(rawName || '').trim().replace(/^(?:wwb|wxb|qqb|wx|qq|mt|wb)-/i, '').trim();
    return WX_CLASSIC_SET[name] ? '[' + name + ']' : '';
  });
  out = out.replace(/\n{3,}/g, '\n\n').replace(/^[\s\n]+|[\s\n]+$/g, '').replace(/^[，,。.\s]+/, '');
  if (out) return out;
  return WX_EMOJI_FALLBACKS[Math.floor(Math.random() * WX_EMOJI_FALLBACKS.length)];
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
  try {
    var c = await ilinkCall('/ilink/bot/getconfig', cfg.wechat.botToken, {
      ilink_user_id: msg.from_user_id, context_token: msg.context_token, base_info: BASE_INFO,
    });
    if (c && c.typing_ticket) {
      ilinkCall('/ilink/bot/sendtyping', cfg.wechat.botToken, {
        ilink_user_id: msg.from_user_id, typing_ticket: c.typing_ticket, status: 2, base_info: BASE_INFO,
      }).catch(function () {});
    }
  } catch (e) { /* 可选 */ }
  try {
    var hist = await loadWxHistory(false);
    var system = (cfg.wechat.persona && cfg.wechat.persona.system) || '你和主人在真实微信上聊天，回复简短自然，绝不透露自己是AI。';
    var msgs = [{ role: 'system', content: system }];
    for (var i = Math.max(0, hist.length - 12); i < hist.length; i++) msgs.push(hist[i]);
    msgs.push({ role: 'user', content: text.slice(0, 2000) });
    var reply = '';
    var lastLlmErr = null;
    for (var att = 0; att < 2 && !reply; att++) {
      try {
        reply = sanitizeWxOutText(await callLlm(cfg, msgs));
      } catch (le) { lastLlmErr = le; }
    }
    if (!reply) {
      WX_MSG_ERR = ('LLM 回复失败：' + String((lastLlmErr && lastLlmErr.message) || lastLlmErr)).slice(0, 160);
      WX_MSG_ERR_AT = Date.now();
      throw new Error(WX_MSG_ERR);
    }
    await sendWxText(cfg, msg.from_user_id, msg.context_token, reply);
    if (WX_MSG_ERR_AT && Date.now() - WX_MSG_ERR_AT > 600000) WX_MSG_ERR = '';
    HIST_WX = (HIST_WX || []).concat([
      { role: 'user', content: text.slice(0, 500), ts: Date.now() },
      { role: 'assistant', content: reply.slice(0, 500), ts: Date.now() },
    ]).slice(-30);
    await saveWxHistory();
    return true;
  } catch (e) {
    if (!WX_MSG_ERR) {
      WX_MSG_ERR = ('微信回复失败：' + String(e && e.message)).slice(0, 160);
      WX_MSG_ERR_AT = Date.now();
    }
    throw e;
  }
}

/** 微信：轮询一轮，返回本轮处理了几条消息；TOKEN_EXPIRED 抛错 */
async function tick() {
  var cfg = await loadConfig(false);
  if (!cfg.wechat || !cfg.wechat.botToken) return 0;
  var d = await ilinkCall('/ilink/bot/getupdates', cfg.wechat.botToken, {
    get_updates_buf: UPDATES_BUF, base_info: BASE_INFO,
  });
  if (d && d.error_code === -14) throw new Error('TOKEN_EXPIRED');
  if (d && typeof d.get_updates_buf === 'string' && d.get_updates_buf) UPDATES_BUF = d.get_updates_buf;
  var n = 0;
  var msgs = (d && d.msgs) || [];
  for (var i = 0; i < msgs.length; i++) {
    try {
      if (await handleWxMsg(cfg, msgs[i])) n++;
    } catch (e) {
      if (String(e && e.message).indexOf('TOKEN_EXPIRED') >= 0) throw e;
      /* 单条失败继续下一条；原因已记入 WX_MSG_ERR（心跳/ping 可见） */
    }
  }
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
  HIST_QQ = (HIST_QQ || []).concat([item]).slice(-200);
  await supaPutJson('qq-history.json', { msgs: HIST_QQ, updatedAt: Date.now() });
}

/** QQ：被动回复（v2 接口，60 分钟内有效、每条消息最多回 5 次；seq 递增防同 msg_id 撞号） */
var QQ_SEQ = 1;
async function qqReply(cfg, openid, msgId, content, isGroup, groupOpenid) {
  var token = await qqToken(cfg);
  var url = isGroup ? QQ_API + '/v2/groups/' + groupOpenid + '/messages' : QQ_API + '/v2/users/' + openid + '/messages';
  var r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
    body: JSON.stringify({ msg_type: 0, content: content.slice(0, 1500), msg_id: msgId, msg_seq: QQ_SEQ++ }),
  });
  if (!r.ok) {
    var t = await r.text().catch(function () { return ''; });
    throw new Error('QQ 回复失败 ' + r.status + ' ' + t.slice(0, 100));
  }
}

/** QQ：上传富媒体文件（file_type 1=图片 2=视频 3=语音 silk；file 为 base64，≤2MB），返回 file_info 句柄 */
async function qqUploadMedia(cfg, openid, isGroup, groupOpenid, fileType, dataB64) {
  var token = await qqToken(cfg);
  var url = isGroup ? QQ_API + '/v2/groups/' + groupOpenid + '/files' : QQ_API + '/v2/users/' + openid + '/files';
  var r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
    body: JSON.stringify({ file_type: fileType, file: dataB64, srv_send_msg: false }),
  });
  var t = await r.text().catch(function () { return ''; });
  if (!r.ok) throw new Error('QQ 富媒体上传失败 ' + r.status + ' ' + t.slice(0, 100));
  var j = null;
  try { j = JSON.parse(t); } catch (e) { j = null; }
  var fi = j && (j.file_info || (j.file_infos && j.file_infos[0] && j.file_infos[0].file_info)) || '';
  if (!fi) throw new Error('QQ 富媒体上传失败：无 file_info');
  return fi;
}

/** QQ：发富媒体消息（msg_type=2 media；用于表情图片 / 语音条） */
async function qqReplyMedia(cfg, openid, msgId, fileInfo, isGroup, groupOpenid) {
  var token = await qqToken(cfg);
  var url = isGroup ? QQ_API + '/v2/groups/' + groupOpenid + '/messages' : QQ_API + '/v2/users/' + openid + '/messages';
  var r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
    body: JSON.stringify({ msg_type: 2, media: { file_info: fileInfo }, msg_id: msgId, msg_seq: QQ_SEQ++ }),
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

/** 云端 TTS（OpenAI 兼容 /audio/speech，只要 wav）→ silk → QQ 原生语音条。失败返回 null（降级文字） */
async function synthesizeQqVoice(cfg, text) {
  var tts = cfg.qq && cfg.qq.tts;
  if (!tts || !tts.baseUrl || !tts.apiKey) return null;
  var b = String(tts.baseUrl).replace(/\/+$/, '');
  var url = /\/audio\/speech$/.test(b) ? b : b + '/audio/speech';
  try {
    var r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tts.apiKey },
      body: JSON.stringify({ model: tts.model || 'tts-1', voice: tts.voice || 'alloy', input: text.slice(0, 200), response_format: 'wav', speed: 1 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return null;
    var buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 44 || String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'RIFF') return null;
    var silk = await silkEncode(buf);
    if (!silk) return null;
    var bin = '';
    for (var i = 0; i < silk.length; i += 32768) bin += String.fromCharCode.apply(null, silk.subarray(i, i + 32768));
    var b64 = (typeof btoa === 'function') ? btoa(bin) : Buffer.from(silk).toString('base64');
    var dur = Math.max(1, Math.round(text.length / 4));
    return { b64: b64, dur: dur };
  } catch (e) { return null; }
}

/** 回复里的表情标记（[表情包:名字] / [表情:名字] / [发送了表情:名字]） */
var QQ_STICKER_RE = /[【\[]\s*(?:表情包|表情|贴纸|发送了表情包|发送了表情|发送表情)\s*[:：]\s*([^】\]]{1,20})\s*[】\]]/g;

/** 自然语句变体（[发送了一个"抱抱"表情包]：AI 不按标记写，而是写一句「发送了+词+表情包」） */
var QQ_STICKER_NATURAL_RE =
  /[【\[]\s*(?:发送|发)\s*(?:了|出)?\s*(?:一?个)?\s*["\u201c\u300c\u300e']?\s*([^"'\u201d\u2019\u300d\u300f【\[\]】\s:：，。！!]{1,16}?)\s*["'\u201d\u2019\u300d\u300f]?\s*(?:表情包|表情|贴纸)\s*[】\]]/g;

/** 图片描述变体（[图片: 一只圆滚滚的柴犬…]：AI 把发表情包理解成发图片，用画面描述当标记） */
var QQ_STICKER_IMAGE_RE = /[【\[]\s*图片\s*[:：]\s*([^】\]]{2,60})\s*[】\]]/g;

/** [图片:描述] 变体匹配：描述含表情名 → 该名字；再按动作/动物情感词兑底（名字在清单里才返回，找不到 null） */
function resolveQqEmoticonFromDesc(cfg, desc) {
  var d = String(desc || '').trim();
  if (!d) return null;
  var list = (cfg.qq && cfg.qq.emoticons) || [];
  for (var i = 0; i < list.length; i++) {
    var n = list[i] && list[i].name;
    if (n && n.length >= 2 && d.indexOf(n) >= 0) return n;
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
        if (nj && nj.indexOf(FEEL[f][1]) >= 0) return nj;
      }
    }
  }
  return null;
}

/** 运行包内置表情（cfg.qq.emoticons: [{name, dataUrl}]）匹配：名字精确 → 互相包含 */
function resolveQqEmoticon(cfg, token) {
  var t = String(token || '').trim();
  if (!t) return null;
  var list = (cfg.qq && cfg.qq.emoticons) || [];
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === t) return list[i];
  for (var j = 0; j < list.length; j++) {
    var n = list[j] && list[j].name;
    if (n && (n.indexOf(t) >= 0 || t.indexOf(n) >= 0)) return list[j];
  }
  return null;
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
  // 双端点都没拿到业务回包：典型是网关 503（新端点也 503 时说明这台云服务器出口被两个网关同时拦）
  var geo = lastStatus === 503 ? '（503：QQ 网关拒绝了这台云服务器的出口 IP）——QQ 收发消息走不了这台云端，也不会回复。可换一个部署平台（境内出口，如 ClawCloud 境内节点/国内服务器）重新部署后再点本按钮验证' : '';
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

/** QQ：处理 C2C / 群@ 消息事件（d），返回是否回复成功。
 *  回复分流：文字（msg_type 0）/ 语音条（TTS→silk，file_type 3）/ 表情包（运行包内置表情图，file_type 1）。
 *  语音条频率：cfg.qq.voiceEvery（每 N 条 1 条，0=关），计数器存云端 state/qq-voice-counter.json。 */
async function handleQqEvent(cfg, t, d) {
  var content = qqMediaToPlaceholder(String((d && d.content) || '').trim());
  var authorId = d && d.author && d.author.id ? String(d.author.id) : '';
  var msgId = d && d.id ? String(d.id) : '';
  if (!authorId || !msgId) return false;
  // 空正文 + 带附件 = 富媒体消息（部分事件 content 为空只挂 attachments）：同样给占位
  if (!content && d && d.attachments && d.attachments.length) {
    var at = d.attachments[0] && d.attachments[0].content_type;
    content = at && String(at).indexOf('image') >= 0 ? '（对方发了一个表情包/图片，内容看不到）' : '（对方发了一个媒体消息）';
  }
  if (!content) return false;
  var isGroup = t === 'GROUP_AT_MESSAGE_CREATE';
  if (isGroup) content = content.replace(/^<at[^>]*>[^<]*<\/at>\s*/, '').trim();
  if (!content) return false;
  var hist = await loadQqHistory(false);
  var system = (cfg.qq.persona && cfg.qq.persona.system) || '你和主人在真实QQ上聊天，回复简短自然，绝不透露自己是AI。';
  // 表情包指令（运行包有内置表情时注入可用清单；AI 输出 [表情包:名字] 云端转真图）
  var emo = (cfg.qq && cfg.qq.emoticons) || [];
  if (emo.length) {
    var names = [];
    for (var ei = 0; ei < emo.length; ei++) if (emo[ei] && emo[ei].name) names.push(emo[ei].name);
    system +=
      '\n【表情包】你可以发表情包：在回复里单独一行输出 [表情包:名字]。可用名字：' +
      names.join('、') +
      '。主人让你发表情包、要抱抱蹭蹭逗TA开心时【必须发】——明确点名要表情包的那条回复里一定要带 [表情包:名字] 标记（可以先回一句文字再跟标记），不许只回文字、不许装傻；平时正常聊天不必每次都发。';
  }
  var msgs = [{ role: 'system', content: system }];
  var recent = hist.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; });
  for (var i = Math.max(0, recent.length - 12); i < recent.length; i++) msgs.push(recent[i]);
  msgs.push({ role: 'user', content: content.slice(0, 2000) });
  var reply = await callLlm(cfg, msgs);
  // 拆表情标记：文字段保留、标记转图片发送（最多 3 张防刷屏）。
  // 三套标记一起扫描（标准 [表情包:名字] / 自然语句 [发送了一个"抱抱"表情包] / 图片描述
  // [图片: 一只柴犬…]）：标准标记命中就切出（名字解析不到在发送段跳过），两个变体
  // 能解析到表情名才切出（匹配不到保留原文当普通文字发）。
  var textParts = [];
  var emoHits = [];
  var mm = null;
  var cursor = 0;
  var hits = [];
  function collectHits(re, resolver) {
    re.lastIndex = 0;
    var m2 = null;
    while ((m2 = re.exec(reply)) !== null) {
      var tok = resolver(m2[1]);
      if (tok) hits.push({ s: m2.index, e: m2.index + m2[0].length, tok: tok });
    }
  }
  collectHits(QQ_STICKER_RE, function (t) { return String(t || '').trim(); });
  collectHits(QQ_STICKER_NATURAL_RE, function (t) {
    var r = resolveQqEmoticon(cfg, t);
    return r ? r.name : null;
  });
  collectHits(QQ_STICKER_IMAGE_RE, function (t) { return resolveQqEmoticonFromDesc(cfg, t); });
  hits.sort(function (a, b) { return a.s - b.s; });
  for (var hi = 0; hi < hits.length; hi++) {
    var h = hits[hi];
    if (h.s < cursor) continue;
    var before = reply.slice(cursor, h.s).trim();
    if (before) textParts.push(before);
    emoHits.push(h.tok);
    cursor = h.e;
  }
  var tailText = reply.slice(cursor).trim();
  if (tailText) textParts.push(tailText);
  var textOut = textParts.join('\n').trim();
  if (!textOut && emoHits.length === 0) textOut = reply.slice(0, 500);
  // 语音条判定（纯文字回复才有资格；配置了云端 TTS 且 voiceEvery>0）
  var voiceClip = null;
  var voiceText = '';
  var ttsOk = cfg.qq && cfg.qq.tts && cfg.qq.tts.baseUrl && cfg.qq.tts.apiKey;
  var every = ttsOk ? Number(cfg.qq.voiceEvery || 0) : 0;
  if (every > 0 && textOut && emoHits.length === 0) {
    var counter = 0;
    try { var cst = await supaGetJson('state/qq-voice-counter.json'); counter = (cst && cst.n) || 0; } catch (ce) {}
    var hit = counter % every === 0;
    counter = hit ? 1 : counter + 1;
    try { await supaPutJson('state/qq-voice-counter.json', { n: counter, updatedAt: Date.now() }); } catch (ce2) {}
    if (hit) {
      var clip = await synthesizeQqVoice(cfg, textOut);
      if (clip) { voiceClip = clip; voiceText = textOut; textOut = ''; }
    }
  }
  // 发送：语音条（失败降级文字）→ 文字 → 表情图片（逐张，单张失败跳过）
  if (voiceClip) {
    try {
      var vfi = await qqUploadMedia(cfg, authorId, isGroup, d.group_openid, 3, voiceClip.b64);
      await qqReplyMedia(cfg, authorId, msgId, vfi, isGroup, d.group_openid);
    } catch (ve) {
      voiceClip = null;
      textOut = voiceText || textOut;
    }
  }
  if (textOut) await qqReply(cfg, authorId, msgId, textOut, isGroup, d.group_openid);
  var sentEmo = 0;
  for (var si = 0; si < emoHits.length && sentEmo < 3; si++) {
    var st = resolveQqEmoticon(cfg, emoHits[si]);
    if (!st || !st.dataUrl) continue;
    var sb64 = String(st.dataUrl).split(',')[1] || '';
    if (!sb64) continue;
    try {
      var sfi = await qqUploadMedia(cfg, authorId, isGroup, d.group_openid, 1, sb64);
      await qqReplyMedia(cfg, authorId, msgId, sfi, isGroup, d.group_openid);
      sentEmo++;
    } catch (se) { /* 单张失败跳过 */ }
  }
  // 历史（网站拉取展示用）：文字 + [语音] + [表情:名字] 摘要
  await appendQqHistory({ id: 'q-' + msgId, role: 'me', content: content.slice(0, 500), ts: Date.now() });
  var logParts = [];
  if (textOut) logParts.push(textOut.slice(0, 400));
  if (voiceClip) logParts.push('[语音]');
  for (var li = 0; li < sentEmo; li++) logParts.push('[表情:' + emoHits[li] + ']');
  await appendQqHistory({ id: 'qr-' + msgId, role: 'peer', content: (logParts.join(' ') || reply.slice(0, 400)).slice(0, 500), ts: Date.now() });
  return true;
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

// ---------------- 自动开定时轮询（仅 Edge Function；npm:postgres 直连用户库） ----------------

const CRON_DENO = String.raw`
/** action=setup-cron：直连用户数据库（SUPABASE_DB_URL）执行 cron.schedule——用户不用复制 SQL */
async function setupCron() {
  var dbUrl = Deno.env.get('SUPABASE_DB_URL');
  if (!dbUrl) return { ok: false, error: 'SUPABASE_DB_URL 不可用（需在 Supabase 项目启用）' };
  const { default: postgres } = await import('npm:postgres@3.5.4');
  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    await sql.unsafe('create extension if not exists pg_cron');
    await sql.unsafe('create extension if not exists pg_net');
    await sql.unsafe("select cron.unschedule('wx-assistant')");
    var url = Deno.env.get('SUPABASE_URL') + '/functions/v1/wx-assistant';
    var stmt = "select net.http_post(url := '" + url + "', headers := '{\"Content-Type\":\"application/json\",\"X-Task-Secret\":\"" + CFG.secret + "\"}'::jsonb, body := '{}'::jsonb)";
    await sql.unsafe("select cron.schedule('wx-assistant', '* * * * *', " + JSON.stringify(stmt) + ")");
    return { ok: true };
  } finally {
    await sql.end({ timeout: 5 }).catch(function () {});
  }
}

async function stopCron() {
  var dbUrl = Deno.env.get('SUPABASE_DB_URL');
  if (!dbUrl) return { ok: false, error: 'SUPABASE_DB_URL 不可用' };
  const { default: postgres } = await import('npm:postgres@3.5.4');
  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    await sql.unsafe("select cron.unschedule('wx-assistant')");
    return { ok: true };
  } finally {
    await sql.end({ timeout: 5 }).catch(function () {});
  }
}
`;

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

// ---------------- Supabase Edge Function 版（Deno，pg_cron 每分钟触发） ----------------

export const EDGE_FUNCTION_TS = `// 云端助手 · Supabase Edge Function（Deno）
// 微信：pg_cron 每分钟触发（X-Task-Secret 校验），单次 100s 预算内循环轮询。
// QQ：同一函数 URL 直接当 QQ Webhook 回调地址（自动识别 QQ 信封）。
// 定时轮询：action=setup-cron 自动执行 cron.schedule（无需手动复制 SQL）。
// CORS：手机 App 页面带 X-Task-Secret 等自定义头浏览器直连本函数（云端验证凭证 /
// 自动开定时 / 测试云端），会先发 OPTIONS 预检——没有这组头浏览器一律报
// TypeError: Failed to fetch（v3 修复：所有响应统一带 CORS 头 + OPTIONS 直接放行）。
const CODE_SOURCE = 'deno';
var SUPA_URL_INJECT = Deno.env.get('SUPABASE_URL') || '';
var SUPA_KEY_INJECT = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
${WX_CLOUD_CORE}
${ED25519_DENO}
${CRON_DENO}
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Task-Secret, X-Task-Action, X-Signature-Ed25519, X-Signature-Timestamp, Authorization, apikey',
  'Access-Control-Max-Age': '86400',
};
function jr(obj, status) { return Response.json(obj, { status: status || 200, headers: CORS_HEADERS }); }
const BUDGET_MS = 100000;

Deno.serve(async (req) => {
  // CORS 预检：非简单请求（自定义头 / JSON body）的跨域 POST 会先打 OPTIONS，直接放行
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS_HEADERS });
  const url = new URL(req.url);
  try {
    // ---- QQ Webhook（POST 且带 QQ 信封/签名头，或路径 /qq） ----
    const isQqPath = /\\/qq\\/?$/.test(url.pathname);
    const hasQqSig = req.headers.get('x-signature-ed25519');
    if (req.method === 'POST' && (isQqPath || hasQqSig)) {
      const raw = await req.text();
      const cfg = await loadConfig(false);
      if (!cfg.qq || !cfg.qq.appId) return jr({ ok: false, error: '未配置 QQ' });
      return await handleQqWebhook(cfg, req, raw);
    }

    const action = url.searchParams.get('action') || req.headers.get('x-task-action') || '';
    const secret = req.headers.get('x-task-secret') || url.searchParams.get('secret') || '';
    const cfg = await loadConfig(false);
    if (!cfg.secret || secret !== cfg.secret) {
      return jr({ ok: false, error: 'bad secret' }, 401);
    }

    // ---- 管理 action ----
    if (action === 'setup-cron') {
      const r = await setupCron();
      await writeHeartbeat({ cronSetup: r });
      return jr(r);
    }
    if (action === 'stop-cron') {
      const r = await stopCron();
      return jr(r);
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
      return jr({ ok: true, source: 'deno' });
    }

    // ---- 默认：微信轮询（100s 预算） ----
    const t0 = Date.now();
    let handled = 0;
    let lastError = '';
    while (Date.now() - t0 < BUDGET_MS) {
      try {
        handled += await tick();
      } catch (e) {
        lastError = String(e && e.message);
        break;
      }
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
