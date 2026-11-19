// [im-gateway 生成] 单一事实来源：src/lib/ios/wx-cloud/sources.ts 的 WX_CLOUD_CORE；勿手改本文件
var CODE_SOURCE = "im-gateway";
var SUPA_URL_INJECT = "https://upuqeapyteywfsibcyho.supabase.co";
var SUPA_KEY_INJECT = "";
var RELAY_URL_INJECT = "https://upuqeapyteywfsibcyho.supabase.co/functions/v1/wx-assistant";
var RELAY_SECRET_INJECT = "deafb60771c4e84147c4f06c33792af21f63d1b95be0f832";
var TTS_LOCAL_URL_INJECT = "http://127.0.0.1:3100/tts";

// ---- \u5FAE\u4FE1\u4E91\u7AEF\u52A9\u624B\u6838\u5FC3\uFF08\u81EA\u52A8\u751F\u6210\uFF0C\u52FF\u624B\u5DE5\u7F16\u8F91\uFF09 ----
var ILINK = 'https://ilinkai.weixin.qq.com';
// \u53EF\u53D8\uFF1AloadConfig \u8BFB\u5230\u8FD0\u884C\u5305 wechat.baseUrl\uFF08confirmed \u56DE\u5305\uFF09\u540E\u5207\u8FC7\u53BB\uFF1B\u5176\u4F59\u573A\u666F\u56DE\u9ED8\u8BA4
var ILINK_HOST = ILINK;
var QQ_API = 'https://api.sgroup.qq.com';
// QQ \u53D6\u51ED\u8BC1\u53CC\u7AEF\u70B9\uFF08\u5B98\u65B9\u73B0\u884C\u7248\u5148\u884C\uFF1A\u6D77\u5916\u51FA\u53E3\u53EF\u8FBE\uFF1B\u65E7 /api/v1/* \u7F51\u5173\u5C42\u62E6\u6D77\u5916 503 \u4F5C\u5151\u5E95\uFF09
var QQ_TOKEN_URLS = ['https://api.bot.qq.com/app/getAppAccessToken', 'https://bots.qq.com/api/v1/getAppAccessToken'];
var BASE_INFO = { channel_version: '2.4.10', bot_agent: 'OpenClaw' };
var SUPA_URL = (typeof SUPA_URL_INJECT !== 'undefined' && SUPA_URL_INJECT) || '';
var SUPA_KEY = (typeof SUPA_KEY_INJECT !== 'undefined' && SUPA_KEY_INJECT) || '';
// v8 \u4E2D\u7EE7\u6A21\u5F0F\uFF08\u5185\u7F6E IM \u7F51\u5173\u7528\uFF09\uFF1A\u7528\u6237 Supabase \u9879\u76EE\u5BC6\u94A5\u62FF\u4E0D\u5230/\u88AB\u62D2\u65F6\uFF08\u4EE3\u5199\u8DEF\u5F84\u90E8\u7F72\u540E serviceKey \u4E3A\u7A7A\uFF0C
// \u6216 JWT \u8F6E\u6362\u540E\u65E7 key \u5168\u62D2\uFF09\uFF0C\u8BFB\u5199\u4E00\u5F8B\u6539\u7ECF\u5DF2\u90E8\u7F72\u7684 wx-assistant \u51FD\u6570\uFF08read-file / upload-file \u52A8\u4F5C\uFF0C
// X-Task-Secret \u9274\u6743\uFF0C\u51FD\u6570\u7528\u5E73\u53F0\u6CE8\u5165\u51ED\u8BC1\u8BBF\u95EE Storage\uFF09\u2014\u2014\u7F51\u5173\u53EA\u9700\u8981\u9879\u76EE\u5730\u5740 + \u4EFB\u52A1\u5BC6\u94A5\u5373\u53EF\u5DE5\u4F5C\u3002
var RELAY_URL = (typeof RELAY_URL_INJECT !== 'undefined' && RELAY_URL_INJECT) || '';
var RELAY_SECRET = (typeof RELAY_SECRET_INJECT !== 'undefined' && RELAY_SECRET_INJECT) || '';
// v13 \u7F51\u5173\u672C\u5730\u8BED\u97F3\u5408\u6210\u7AEF\u70B9\uFF08im-gateway \u6CE8\u5165\uFF0Cz-ai SDK \u5408\u6210 wav\uFF09\uFF1A\u914D\u4E86\u5B83\u65F6 QQ \u8BED\u97F3\u6761
// \u4E0D\u9700\u8981\u7528\u6237\u81EA\u914D OpenAI \u517C\u5BB9 TTS\uFF1B\u4E91\u7AEF\uFF08Deno\uFF09\u4E0D\u6CE8\u5165\u5219\u7528 cfg.qq.tts\uFF08\u7528\u6237\u81EA\u914D\uFF09
var TTS_LOCAL_URL = (typeof TTS_LOCAL_URL_INJECT !== 'undefined' && TTS_LOCAL_URL_INJECT) || '';
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
  // \u6309 key \u7C7B\u578B\u533A\u5206\uFF08\u5B98\u65B9\u6587\u6863\u4E24\u5957\u9274\u6743\uFF09\uFF1A\u65B0\u5F0F key\uFF08sb_secret_/sb_publishable_ \u5F00\u5934\uFF09
  // \u4E0D\u662F JWT\uFF0C\u53EA\u80FD\u653E apikey \u5934\u2014\u2014\u653E Authorization Bearer \u4F1A\u88AB\u7F51\u5173/Storage \u5F53 JWT \u89E3\u6790\uFF0C
  // \u62A5 400 Invalid Compact JWS\uFF1Blegacy JWT\uFF08eyJ \u5F00\u5934\uFF09\u5219 apikey + Bearer \u53CC\u5E26
  if (/^sb_(secret|publishable)_/.test(SUPA_KEY)) {
    return { apikey: SUPA_KEY, 'Content-Type': 'application/json' };
  }
  return { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json' };
}

async function supaGetJson(path) {
  // v8 \u4E2D\u7EE7\u8BFB\uFF1A\u7ECF\u4E91\u7AEF\u51FD\u6570\uFF08\u5E73\u53F0\u51ED\u8BC1\u8BFB Storage\uFF09\uFF1B\u5931\u8D25\u6309\u300C\u6CA1\u6709\u300D\u5904\u7406\uFF0C\u4E0E\u76F4\u8BFB\u8BED\u4E49\u4E00\u81F4
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
  // v8 \u4E2D\u7EE7\u5199\uFF1A\u7ECF\u4E91\u7AEF\u51FD\u6570 upload-file \u52A8\u4F5C\uFF08\u5E73\u53F0\u51ED\u8BC1\u5199 Storage\uFF09
  if (RELAY_URL && RELAY_SECRET) {
    try {
      await fetch(RELAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Task-Secret': RELAY_SECRET, 'X-Task-Action': 'upload-file' },
        body: JSON.stringify({ files: [{ path: path, content: JSON.stringify(obj), bucket: BUCKET, contentType: 'application/json' }] }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) { /* \u5FC3\u8DF3/\u5386\u53F2\u5199\u5931\u8D25\u4E0D\u81F4\u547D */ }
    return;
  }
  try {
    await fetch(SUPA_URL + '/storage/v1/object/' + BUCKET + '/' + path, {
      method: 'POST',
      headers: Object.assign(supaHeaders(), { 'x-upsert': 'true', 'Content-Type': 'application/json' }),
      body: JSON.stringify(obj),
    });
  } catch (e) { /* \u5FC3\u8DF3/\u5386\u53F2\u5199\u5931\u8D25\u4E0D\u81F4\u547D */ }
}

async function loadConfig(force) {
  if (!force && CFG && Date.now() - CFG_AT < 60000) return CFG;
  var c = await supaGetJson('config.json');
  if (!c) throw new Error('\u8FD0\u884C\u5305\u7F3A\u5931\uFF1A\u8BF7\u56DE\u5230\u624B\u673A App\u300C\u8BBE\u7F6E \u2192 \u4E91\u7AEF\u52A9\u624B\u300D\u91CD\u65B0\u540C\u6B65');
  CFG = c;
  CFG_AT = Date.now();
  // confirmed \u56DE\u5305\u7684 baseurl\uFF1A\u4E91\u7AEF Bot API \u8DDF\u7740\u8D70\uFF08\u4EC5\u653E\u884C *.weixin.qq.com / *.qq.com\uFF0C\u9632 SSRF\uFF09
  var bu = c && c.wechat && typeof c.wechat.baseUrl === 'string' ? c.wechat.baseUrl.replace(/\/+$/, '') : '';
  ILINK_HOST = /^https:\/\/[a-z0-9.-]+\.(weixin\.)?qq\.com$/i.test(bu) ? bu : ILINK;
  return CFG;
}

/** X-WECHAT-UIN\uFF1A\u968F\u673A uint32 \u5341\u8FDB\u5236\u4E32\u518D base64\uFF08\u534F\u8BAE\u7EA6\u5B9A\u5F62\u6001\uFF0C\u4E0A\u6E38\u4E0D\u6821\u9A8C\u5177\u4F53\u503C\uFF1BDeno/Node \u901A\u7528\uFF09 */
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

/** v5 \u6E38\u6807\u6301\u4E45\u5316\uFF1Agetupdates \u6E38\u6807\u5B58\u8FDB\u6876\uFF08state/wx-updates-buf.json\uFF09\uFF0C\u65B0\u5B9E\u4F8B/\u51B7\u542F\u52A8\u4E0D\u518D
 *  \u4ECE\u7A7A\u6E38\u6807\u91CD\u6536\u6574\u6279\u79EF\u538B\uFF08\u65E7\u7248\u300C\u4E00\u6761\u6D88\u606F\u88AB\u56DE\u5341\u51E0\u6B21\u300D\u7684\u56DE\u590D\u98CE\u66B4\u6839\u56E0\uFF09\uFF1B\u5DF2\u56DE\u590D\u7684
 *  message_id \u53E6\u5B58 state/wx-seen.json \u53BB\u91CD\u5151\u5E95\uFF08\u6E38\u6807\u56DE\u9000\u65F6\u53EA\u8865\u672A\u56DE\u6210\u529F\u7684\u90A3\u4E9B\uFF09\u3002 */
var WX_SEEN = null;
async function loadWxCursor() {
  try {
    var s = await supaGetJson('state/wx-updates-buf.json');
    if (s && typeof s.buf === 'string' && s.buf) UPDATES_BUF = s.buf;
    var sn = await supaGetJson('state/wx-seen.json');
    WX_SEEN = sn && Array.isArray(sn.ids) ? sn.ids : [];
  } catch (e) { /* \u5151\u5E95\uFF1A\u4ECE\u7A7A\u6E38\u6807\u5F00\u59CB\uFF08\u9996\u6761\u4F1A\u91CD\u6536\u4F46 seen \u5151\u5E95\uFF09 */ }
}
async function saveWxCursor() {
  if (!UPDATES_BUF) return;
  await supaPutJson('state/wx-updates-buf.json', { buf: UPDATES_BUF, at: Date.now() });
}
/** v9 \u53CC\u8F6E\u8BE2\u5668\u5B89\u5168\uFF08\u672C\u7AD9\u7F51\u5173 / \u4F60\u7684 Supabase \u5B9A\u65F6\u4EFB\u52A1 / \u624B\u52A8\u300C\u4E91\u7AEF\u6D4B\u8BD5\u300D\u540C\u8DD1\u4E00\u4E2A\u6876\uFF09\uFF1A
 *  \u2460 \u8F6E\u8BE2\u9501 state/wx-lock.json\uFF1A\u522B\u7684 owner 50 \u79D2\u5185\u6D3B\u8DC3 \u2192 \u672C\u8F6E\u76F4\u63A5\u8BA9\u4F4D\uFF08\u7701\u91CD\u590D getupdates\uFF1B
 *    owner \u662F\u8FDB\u7A0B\u7EA7\u968F\u673A id\u2014\u2014\u540C\u8FDB\u7A0B\u6C38\u4E0D\u81EA\u5835\uFF0C\u5D29\u4E86\u9760 TTL \u81EA\u7136\u8FC7\u671F\uFF0C\u63A5\u7BA1 \u226450s + \u4E0B\u4E00\u8F6E\u89E6\u53D1\uFF09\u3002
 *  \u2461 \u8BA4\u9886\u8868 state/wx-claims.json\uFF1A\u56DE\u590D\u524D\u5148\u8BA4\u9886\uFF083 \u5206\u949F TTL\uFF09\u2014\u2014\u5E76\u53D1\u62C9\u5230\u540C\u4E00\u6279\u6D88\u606F\u4E5F\u53EA\u4F1A\u56DE
 *    \u4E00\u6B21\uFF1B\u56DE\u590D\u5931\u8D25\u7ACB\u5373\u91CA\u653E\uFF08\u4E0B\u4E00\u8F6E\u91CD\u8BD5\uFF09\uFF1B\u8FDB\u7A0B\u5D29\u5728\u534A\u8DEF\u7531 TTL \u8FC7\u671F\u5151\u5E95\uFF08\u6700\u591A\u5EF6\u8FDF\u91CD\u8BD5\uFF09\u3002 */
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
  // v12 \u7F13\u5B58 TTL 3s\uFF1A\u957F\u9A7B\u8FDB\u7A0B\uFF08\u5185\u7F6E\u7F51\u5173\uFF09\u65E7\u7248\u4E00\u6B21\u52A0\u8F7D\u540E\u6C38\u4E0D\u91CD\u8BFB\u2014\u2014\u4E91\u7AEF\u5B9A\u65F6\u4EFB\u52A1/
  // \u624B\u52A8\u6D4B\u8BD5\u5E76\u53D1\u8BA4\u9886\u540C\u4E00\u6279\u6D88\u606F\u65F6\u4E92\u76F8\u770B\u4E0D\u89C1\uFF0C\u53CC\u56DE\u6839\u56E0\u4E4B\u4E00\u30023s \u5185\u590D\u7528\uFF0C\u8FC7\u671F\u91CD\u8BFB\u3002
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

/** v11 QQ \u8BA4\u9886\u8868\uFF08state/qq-claims.json\uFF09\uFF1AQQ \u6D88\u606F\u56DE\u590D\u524D\u5148\u8BA4\u9886\uFF083 \u5206\u949F TTL\uFF0C\u5931\u8D25\u5373\u91CA\uFF09\u3002
 *  \u7F51\u5173\u957F\u8FDE\u63A5 / \u4E91\u7AEF cron-cycle WS / Webhook / \u65AD\u7EBF Resume \u540E\u5E73\u53F0\u8865\u53D1\uFF0C\u540C\u4E00\u6761\u4E8B\u4EF6
 *  \u4ECE\u51E0\u6761\u8DEF\u90FD\u80FD\u518D\u8FDB\u4E00\u6B21\u2014\u2014\u53EA\u6709\u8BA4\u9886\u5230\u7684\u90A3\u4E00\u65B9\u56DE\u590D\uFF0C\u5176\u4F59\u8DF3\u8FC7\uFF08\u65E7\u7248\u300C\u56DE\u590D\u4E24\u4E09\u904D\u300D\u6839\u56E0\uFF09\u3002
 *  \u4E0E\u5FAE\u4FE1 wx-claims \u540C\u6784\uFF1A\u8FDB\u7A0B\u5D29\u5728\u534A\u8DEF\u7531 TTL \u8FC7\u671F\u5151\u5E95\uFF08\u6700\u591A\u5EF6\u8FDF\u91CD\u8BD5\u4E00\u6B21\uFF09\u3002 */
var QQ_CLAIM_TTL = 180000;
var QQ_CLAIMS = null;
var QQ_CLAIMS_AT = 0;
async function loadQqClaims(force) {
  // v12 \u7F13\u5B58 TTL 3s\uFF08\u540C loadWxClaims\uFF09\uFF1A\u957F\u9A7B\u7F51\u5173/\u4E91\u7AEF\u51FD\u6570\u5E76\u53D1\u6301\u6709\u540C\u4E00\u6761 QQ \u4E8B\u4EF6\u65F6\uFF0C
  // \u8BA4\u9886\u8868\u5FC5\u987B\u8FD1\u5B9E\u65F6\u4E92\u901A\u2014\u2014\u65E7\u7248\u6C38\u4E0D\u91CD\u8BFB\uFF0C\u7F51\u5173\u4E0E\u4E91\u7AEF\u5404\u8BA4\u5404\u7684 \u2192 \u540C\u4E00\u6761\u6D88\u606F\u4E24\u8FB9\u90FD\u56DE\u3002
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
    // v8\uFF1A\u539F\u6765\u6CA1\u6709\u8D85\u65F6\u2014\u2014\u4E0A\u6E38\u6302\u8D77\u4F1A\u628A\u6574\u6761\u5FAE\u4FE1\u8F6E\u8BE2\u5FAA\u73AF\u5361\u6B7B\uFF08\u540E\u7EED\u6D88\u606F\u5168\u4E0D\u56DE\uFF0C\u300CAI \u4E0D\u56DE\u4FE1\u606F\u300D\u6839\u56E0\u4E4B\u4E00\uFF09\u3002
    // getupdates \u670D\u52A1\u7AEF\u957F\u8F6E\u8BE2\u6302 ~35s\uFF0C\u7A97\u53E3\u7559\u5230 50s\uFF1B\u5176\u4F59\u77ED\u8C03\u7528\u540C\u7A97\u4E0D\u5F71\u54CD\u3002
    signal: AbortSignal.timeout(50000),
  });
  var j = null;
  try { j = await r.json(); } catch (e) { /* \u4FDD\u7559 null */ }
  if (!r.ok || (j && typeof j.error_code === 'number' && j.error_code !== 0 && j.error_code !== -1 && path.indexOf('getupdates') < 0)) {
    throw new Error('iLink ' + path + ' \u5931\u8D25 ' + r.status);
  }
  return j || {};
}

/** LLM\uFF1AOpenAI \u517C\u5BB9 chat/completions\uFF08\u975E\u6D41\u5F0F\uFF09\uFF0C\u8DDF\u968F\u624B\u673A App\u300CAPI \u8BBE\u7F6E\u300D */
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
  var lastErr = '\u672A\u914D\u7F6E\u6A21\u578B API\uFF08\u5728\u624B\u673A App \u8BBE\u7F6E \u2192 API \u8BBE\u7F6E\u91CC\u586B\u5199\u540E\u91CD\u65B0\u540C\u6B65\uFF09';
  for (var i = 0; i < cands.length; i++) {
    try {
      var r = await fetch(cands[i], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: llm.apiKey ? 'Bearer ' + llm.apiKey : '',
        },
        body: JSON.stringify({ model: llm.model || 'gpt-4o-mini', messages: messages, max_tokens: 500 }),
        // v8\uFF1A\u539F\u6765\u6CA1\u6709\u8D85\u65F6\u2014\u2014\u6A21\u578B API \u6302\u8D77\u65F6\u6574\u6761\u6536\u53D1\u5FAA\u73AF\u88AB\u62D6\u6B7B\uFF08\u6D88\u606F\u6C38\u8FDC\u4E0D\u56DE\uFF09\uFF1B75s \u4E0E
        // /api/chat \u7684\u975E\u6D41\u5F0F\u7A97\u53E3\u5BF9\u9F50\uFF0C\u8D85\u65F6\u8FDB lastErr\uFF0C\u5916\u5C42 handleWxMsg \u7684\u91CD\u8BD5\u94FE\u8DEF\u63A5\u7740\u5151
        signal: AbortSignal.timeout(75000),
      });
      if (!r.ok) { lastErr = 'LLM ' + r.status; continue; }
      var j = await r.json();
      var text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (typeof text === 'string' && text.trim()) return text.trim();
      lastErr = 'LLM \u7A7A\u56DE\u590D';
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
  // \u5165\u7AD9\u56FE\u7247/\u8868\u60C5\u5305\uFF08type 2\uFF0CAES \u52A0\u5BC6\u770B\u4E0D\u5230\u5185\u5BB9\uFF09\uFF1A\u5360\u4F4D\u8BA9 AI \u6309\u8BED\u5883\u56DE\u5E94\uFF08\u4E0D\u6574\u6761\u4E22\u5F03\uFF09
  for (var k = 0; k < list.length; k++) {
    if (list[k] && list[k].type === 2) return '\uFF08\u5BF9\u65B9\u53D1\u4E86\u4E00\u4E2A\u8868\u60C5\u5305/\u56FE\u7247\uFF0C\u5185\u5BB9\u770B\u4E0D\u5230\uFF09';
  }
  return '';
}

// ---- \u771F\u673A\u5FAE\u4FE1\u51FA\u7AD9\u51C0\u5316\uFF08iLink \u901A\u9053\u53EA\u80FD\u53D1\u6587\u5B57\uFF1Bv4\uFF1A\u5927\u8868\u60C5\u6807\u8BB0 \u2192 \u7ECF\u5178\u8868\u60C5\u4EE3\u7801\uFF09 ----
// \u6839\u56E0\uFF08\u7528\u6237\u5B9E\u62CD\uFF09\uFF1A\u4E91\u7AEF\u4EBA\u8BBE\u6CBF\u7528\u4E86\u7AD9\u5185\u5FAE\u4FE1\u7684 [\u8868\u60C5\u5305:ID] \u4E60\u60EF\uFF08\u5386\u53F2/\u4EBA\u8BBE\u6559\u5B66\u5E26\u8FDB\u53BB\u7684\uFF09\uFF0C
// iLink \u901A\u9053\u53D1\u4E0D\u4E86\u56FE \u2192 \u6807\u8BB0\u4EE5\u88F8\u6587\u5B57\u51FA\u73B0\u5728\u771F\u673A\u5FAE\u4FE1\u4E0A\u3002\u63D0\u793A\u8BCD\u62E6\u4E0D\u4F4F\uFF0C\u53D1\u9001\u8FB9\u754C\u786E\u5B9A\u6027\u8F6C\u6362\u3002
// \u8F6C\u6362\u89C4\u5219\uFF1A\u53BB ID \u524D\u7F00\u540E\u540D\u5B57\u5728\u7ECF\u5178\u8868\u60C5\u6E05\u5355\u5185 \u2192 [\u540D\u5B57]\uFF08\u771F\u673A\u5FAE\u4FE1\u5BA2\u6237\u7AEF\u628A\u8BE5\u6587\u672C\u6E32\u67D3\u6210\u771F
// \u8868\u60C5\uFF0CAI \u7B49\u4E8E\u771F\u4F1A\u53D1\u8868\u60C5\uFF09\uFF1B\u4E0D\u5728\u6E05\u5355 \u2192 \u5269\u9664\uFF1B\u51C0\u7A7A \u2192 \u989C\u6587\u5B57\u5151\u5E95\uFF08\u4E0D\u7A7A\u6D88\u606F\uFF09\u3002
var WX_CLASSIC = ('\u5FAE\u7B11,\u6487\u5634,\u8272,\u53D1\u5446,\u5F97\u610F,\u6D41\u6CEA,\u5BB3\u7F9E,\u95ED\u5634,\u7761,\u5927\u54ED,\u5C34\u5C2C,\u53D1\u6012,\u8C03\u76AE,\u5472\u7259,\u60CA\u8BB6,\u96BE\u8FC7,\u56E7,\u6293\u72C2,\u5410,\u5077\u7B11,\u6109\u5FEB,\u767D\u773C,\u50B2\u6162,\u56F0,\u60CA\u6050,\u61A8\u7B11,\u60A0\u95F2,\u5492\u9A82,\u7591\u95EE,\u5618,\u6655,\u8870,\u9AB7\u9AC5,\u6572\u6253,\u518D\u89C1,\u64E6\u6C57,\u62A0\u9F3B,\u9F13\u638C,\u574F\u7B11,\u53F3\u54FC\u54FC,\u9119\u89C6,\u59D4\u5C48,\u5FEB\u54ED\u4E86,\u9634\u9669,\u4EB2\u4EB2,\u53EF\u601C,\u7B11\u8138,\u751F\u75C5,\u8138\u7EA2,\u7834\u6D95\u4E3A\u7B11,\u6050\u60E7,\u5931\u671B,\u65E0\u8BED,\u563F\u54C8,\u6342\u8138,\u5978\u7B11,\u673A\u667A,\u76B1\u7709,\u8036,\u5403\u74DC,\u52A0\u6CB9,\u6C57,\u5929\u554A,Emm,\u793E\u4F1A\u793E\u4F1A,\u65FA\u67F4,\u597D\u7684,\u6253\u8138,\u54C7,\u7FFB\u767D\u773C,666,\u8BA9\u6211\u770B\u770B,\u53F9\u6C14,\u82E6\u6DA9,\u88C2\u5F00,\u5634\u5507,\u7231\u5FC3,\u5FC3\u788E,\u62E5\u62B1,\u5F3A,\u5F31,\u63E1\u624B,\u80DC\u5229,\u62B1\u62F3,\u52FE\u5F15,\u62F3\u5934,OK,\u5408\u5341,\u732A\u5934,\u4FBF\u4FBF,\u6708\u4EAE,\u592A\u9633,\u5E86\u795D,\u7EA2\u5305,\u767C,\u798F,\u70DF\u82B1,\u7206\u7AF9,\u793C\u7269,\u8DF3\u8DF3,\u53D1\u6296,\u8F6C\u5708,\u5564\u9152,\u5496\u5561,\u86CB\u7CD5,\u73AB\u7470,\u51CB\u8C22,\u83DC\u5200,\u70B8\u5F39').split(',');
var WX_CLASSIC_SET = {};
for (var wci = 0; wci < WX_CLASSIC.length; wci++) WX_CLASSIC_SET[WX_CLASSIC[wci]] = 1;
var WX_EMOJI_FALLBACKS = ['(\u00AC\u203F\u00AC)', '(\u0E51\u2022\u0300\u3142\u2022\u0301)\u0648\u2727', '\u0669(\u02C3\u1D17\u02C2)\u06F6', '(\u3063\u02D8\u03C9\u02D8\u03C2)'];
var WX_MSG_ERR = '';
var WX_MSG_ERR_AT = 0;
/** \u8868\u60C5/\u5A92\u4F53\u6807\u8BB0 \u2192 \u7ECF\u5178\u8868\u60C5\u4EE3\u7801\uFF1A\u540D\u5B57\u76F4\u9009\uFF1Bv13 ID \u89E3\u6790\uFF08\u7AD9\u5185\u6E05\u5355\u6559 [\u8868\u60C5\u5305:ID]\u2014\u2014\u8FD0\u884C\u5305
 *  \u5E26 stickerMap: ID\u2192\u610F\u601D\uFF0C\u547D\u4E2D\u610F\u601D\u518D\u6620\u5C04\u7ECF\u5178\u8868\u60C5\uFF1B\u90FD\u4E0D\u5728\u6E05\u5355 \u2192 \u5265\u9664\uFF08\u8FD9\u6761\u901A\u9053\u53D1\u4E0D\u4E86\u56FE\uFF09\uFF09 */
function wxStickerToClassic(cfg, rawName) {
  var name = String(rawName || '').trim().replace(/^(?:wwb|wxb|qqb|wx|qq|mt|wb)-/i, '').trim();
  if (WX_CLASSIC_SET[name]) return '[' + name + ']';
  var map = (cfg && cfg.wechat && cfg.wechat.stickerMap) || {};
  var byId = map[String(rawName || '').trim()] || map[name];
  if (byId) {
    byId = String(byId).split(/[\uFF0C,\u3002.\u3001\s]/)[0].slice(0, 12);
    if (WX_CLASSIC_SET[byId]) return '[' + byId + ']';
  }
  return '';
}
function sanitizeWxOutText(cfg, text) {
  var tagRe = /[\[\u3010]\s*(?:\u53D1\u9001\u4E86|\u53D1\u51FA\u4E86)?\s*(?:\u8868\u60C5\u5305|\u8868\u60C5|\u56FE\u7247|\u7167\u7247|\u8BED\u97F3|\u8D34\u7EB8|Sticker)\s*[:\uFF1A]\s*([^\]\u3011]{1,24})\s*[\]\u3011]/g;
  var out = String(text || '').replace(tagRe, function (_all, rawName) { return wxStickerToClassic(cfg, rawName); });
  out = stripRichMarkers(out);
  out = out.replace(/\n{3,}/g, '\n\n').replace(/^[\s\n]+|[\s\n]+$/g, '').replace(/^[\uFF0C,\u3002.\s]+/, '');
  if (out) return out;
  return WX_EMOJI_FALLBACKS[Math.floor(Math.random() * WX_EMOJI_FALLBACKS.length)];
}

// ---- v13 \u8FDE\u53D1/\u4E16\u754C\u4E66/\u5F15\u7528/\u6DF1\u5EA6\u601D\u8003\uFF08\u771F\u673A\u56DE\u590D\u4E0E\u7F51\u7AD9\u540C\u6E90\uFF1A\u673A\u4E3B\u5B9A\u8C03\u300C\u7F51\u7AD9\u4E0A\u600E\u4E48\u56DE\u590D\u7684\uFF0C
//      \u771F\u673A\u5FAE\u4FE1/QQ \u5C31\u600E\u4E48\u56DE\u590D\u7684\u300D\uFF09 ----

/** \u6DF1\u5EA6\u601D\u8003\u5757\u5265\u9664\uFF08[\u601D\u8003]\u2026[/\u601D\u8003]\uFF09\uFF1A\u7AD9\u5185\u5F00\u542F\u6DF1\u5EA6\u601D\u8003\u65F6\u6A21\u578B\u5148\u8F93\u51FA\u601D\u8003\u94FE\uFF0C\u771F\u673A\u53EA\u53D1\u6B63\u6587 */
function stripThinkBlocks(text) {
  var t = String(text || '');
  t = t.replace(/\[\u601D\u8003\][\s\S]*?\[\/\u601D\u8003\]/g, '');
  t = t.replace(/\u3010\u601D\u8003\u3011[\s\S]*?\u3010\/\u601D\u8003\u3011/g, '');
  t = t.replace(/\[(?:\/)?\u601D\u8003\]/g, '').replace(/\u3010(?:\/)?\u601D\u8003\u3011/g, '');
  return t;
}

/** \u9996\u5C3E\u7A7A\u767D + \u4E0D\u53EF\u89C1\u5360\u4F4D\u5B57\u7B26\u5265\u9664\uFF08\u4E0E\u7AD9\u5185 trimBlank \u540C\u53E3\u5F84\uFF09 */
var CLOUD_BLANK_RE_H = /^[\s\u200B\u200C\u200D\u200E\u200F\u2060\u2800\u3164\uFFA0]+/;
var CLOUD_BLANK_RE_T = /[\s\u200B\u200C\u200D\u200E\u200F\u2060\u2800\u3164\uFFA0]+$/;
function cloudTrim(s) {
  return String(s || '').replace(CLOUD_BLANK_RE_H, '').replace(CLOUD_BLANK_RE_T, '');
}

/** \u7AD9\u5185\u5BCC\u5A92\u4F53\u52A8\u4F5C\u6807\u8BB0\uFF08\u771F\u673A\u901A\u9053\u5151\u73B0\u4E0D\u4E86\u7684\u6307\u4EE4\uFF09\u5265\u9664\uFF1A\u7EA2\u5305/\u8F6C\u8D26/\u4EB2\u5C5E\u5361/\u4F4D\u7F6E/\u6B4C\u66F2/\u901A\u8BDD/\u7167\u7247/\u5934\u50CF/\u670B\u53CB\u5708/\u624B\u673A\u64CD\u4F5C\u2026
 *  \u5265\u9664\u540E\u7A7A\u6389\u7684\u884C\u7531\u8FDE\u53D1\u5207\u5206\u81EA\u7136\u6EE4\u6389\uFF08\u4E0D\u4F1A\u53D1\u7A7A\u6D88\u606F\uFF09\uFF1B[\u8868\u60C5\u5305:ID] \u4E24\u901A\u9053\u5404\u81EA\u5728\u524D\u7F6E\u73AF\u8282\u89E3\u6790 */
var CLOUD_MARK_RE = /[\[\u3010]\s*(?:\u9886\u53D6\u7EA2\u5305|\u6536\u6B3E\u8F6C\u8D26|\u751F\u6210\u65B0\u5934\u50CF|\u53D1\u670B\u53CB\u5708|\u624B\u673A\u64CD\u4F5C|\u9009\u56FE\u53D1\u9001|\u8BED\u97F3\u901A\u8BDD|\u89C6\u9891\u901A\u8BDD|\u5206\u4EAB\u6B4C\u66F2|\u4EB2\u5C5E\u5361|\u7EA2\u5305|\u8F6C\u8D26|\u4F4D\u7F6E|\u62CD\u4E00\u62CD|\u70B9\u64AD|\u6B4C\u66F2|\u7167\u7247|\u56FE\u7247|\u8BED\u97F3|\u56DE\u5FC6\u63D0\u793A)\s*[:\uFF1A][^\]\u3011]{0,160}[\]\u3011]/g;
function stripRichMarkers(text) {
  return String(text || '').replace(CLOUD_MARK_RE, '');
}

/** \u8FDE\u53D1\u5207\u5206\uFF08\u7AD9\u5185 splitReplySegments(multi=true) \u540C\u53E3\u5F84\uFF09\uFF1A&&& \u6807\u8BB0 / \u6362\u884C / \u53E5\u672B\u6807\u70B9\u4E3A\u754C\uFF1B
 *  \u52A8\u4F5C\u63CF\u5199\uFF08*...*\uFF09\u72EC\u7ACB\u6210\u6BB5\uFF08\u771F\u673A\u4E0D\u663E\u793A\u661F\u53F7\uFF09\uFF1B\u8FDE\u7EED\u91CD\u590D\u4E22\u5F03\uFF1B\u5168\u5458 \u22644 \u5B57\u788E\u53E5\u5E76\u6210\u4E00\u6761 */
var CLOUD_TINY_EXCLUDE = /[\[\]{}()\uFF08\uFF09\u3010\u3011*\u300C\u300D\u300E\u300F\u201C\u201D"']/;
function cloudIsTiny(s) {
  return s.length > 0 && !CLOUD_TINY_EXCLUDE.test(s) && s.length <= 4;
}
function cloudJoinTiny(a, b) {
  return /[\u3002\uFF01\uFF1F!?\uFF5E\u301C]$/.test(a) ? a + b : a + '\uFF0C' + b;
}
function cloudPushSeg(arr, raw) {
  var s = cloudTrim(String(raw || '').replace(/^[\uFF0C,\u3001\uFF1B;\uFF1A:]+/, '').replace(/[\uFF0C,\u3001\uFF1B;\uFF1A:]+$/, ''));
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
    var bRe = /&{3,}|\n|[\u3002\uFF01\uFF1F!?\uFF5E\u301C]+[\u201D\u2019"\u300F\u300D\uFF09)\]]*/g;
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
  // \u8FDE\u7EED\u91CD\u590D\u4E22\u5F03\uFF08\u4E0D\u91CD\u590D\uFF09
  var dedup = [];
  for (var di = 0; di < out.length; di++) {
    if (di === 0 || out[di] !== out[di - 1]) dedup.push(out[di]);
  }
  out = dedup;
  // \u5168\u5458\u788E\u53E5\u5408\u5E76\uFF08\u8BDD\u5C11\u4E0D\u62C6\uFF09
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

/** \u5B8C\u6574\u56DE\u590D \u2192 \u8FDE\u53D1\u6D88\u606F\u6BB5\u3002multi\uFF08\u7AD9\u5185\u56DE\u590D\u6761\u6570 > 1\uFF0C\u8FD0\u884C\u5305 multi \u6807\u5FD7\uFF09\u6309\u53E5\u754C\u8FDE\u53D1\u5207\u5206\uFF1B
 *  \u5355\u6761\u6A21\u5F0F\uFF08\u6761\u6570=1\uFF09\u53EA\u6309 &&& \u6807\u8BB0\u5207\uFF08\u7AD9\u5185 splitReplySegments \u540C\u53E3\u5F84\uFF09 */
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

/** [\u5F15\u7528:M\u7F16\u53F7] \u2192 \u5F15\u7528\u5185\u5BB9\uFF08\u7AD9\u5185 Task 30 \u5F15\u7528\u673A\u5236\u7684\u771F\u673A\u7248\uFF1AquoteMap \u7531\u7F16\u53F7\u5386\u53F2\u6784\u5EFA\uFF09\u3002
 *  \u7F16\u53F7\u547D\u4E2D \u2192 \u8FD4\u56DE\u88AB\u5F15\u5185\u5BB9\uFF08\u622A\u65AD 40 \u5B57\uFF09\uFF0C\u6807\u8BB0\u5265\u9664\uFF1B\u672A\u547D\u4E2D \u2192 \u6807\u8BB0\u5265\u9664\uFF1B\u88F8 [M\u6570\u5B57] \u4E00\u5E76\u5265\u6389 */
function extractQuote(reply, quoteMap) {
  var found = null;
  var out = String(reply || '').replace(/[\[\u3010]\s*\u5F15\u7528\s*[:\uFF1A]\s*M\s*(\d{1,5})\s*[\]\u3011]/g, function (_all, num) {
    var q = quoteMap ? quoteMap[String(num)] : null;
    if (q && !found) found = q;
    return '';
  });
  out = out.replace(/\[\s*M\s*\d{1,5}\s*\]/g, '');
  return { text: out, quote: found };
}

/** \u4E16\u754C\u4E66\uFF08\u8FD0\u884C\u5305 cfg.<ch>.worldbook\uFF1A[{name, g, entries:[{kw, c, p, pr, ic}]}]\uFF09\u2192 \u516D\u4F4D\u7F6E\u5757\u3002
 *  \u4E0E\u7AD9\u5185 collectWbBlocks \u540C\u53E3\u5F84\uFF1A\u5168\u5C40\u4E66\u5E38\u9A7B\u3001\u5C40\u90E8/\u4E13\u5C5E\u6309\u89E6\u53D1\u8BCD\u547D\u4E2D\uFF08\u626B\u63CF\u53E3\u5F84 = \u6765\u6D88\u606F + \u6700\u8FD1\u5386\u53F2\uFF09\uFF1B
 *  \u6309\u4F4D\u7F6E\u5206\u7EC4\u3001\u540C\u4E66\u5185\u4F18\u5148\u7EA7\u964D\u5E8F\uFF1B\u6BCF\u672C\u4E66\u72EC\u7ACB\u5305\u88F9\u3010\u4E16\u754C\u8BBE\u5B9A\u5F00\u59CB/\u7ED3\u675F\u3011\uFF1B\u603B\u9884\u7B97\u5185\u5C3D\u91CF\u4FDD\u7559 */
var CLOUD_WB_BUDGET = 6000;
var CLOUD_WB_RULES = '\u3010\u4E16\u754C\u8BBE\u5B9A\u4F7F\u7528\u89C4\u5219\u3011\u5BF9\u8BDD\u4E2D\u3010\u4E16\u754C\u8BBE\u5B9A\u5F00\u59CB\u3011\u4E0E\u3010\u4E16\u754C\u8BBE\u5B9A\u7ED3\u675F\u3011\u6807\u8BB0\u4E4B\u95F4\u7684\u5185\u5BB9\u662F\u672C\u6B21\u5BF9\u8BDD\u7684\u4E16\u754C\u8BBE\u5B9A\uFF0C\u8BF7\u9075\u5B88\uFF1A1. \u6839\u636E\u8FD9\u4E9B\u8BBE\u5B9A\u7406\u89E3\u5F53\u524D\u4E16\u754C\u89C2\u3001\u89D2\u8272\u80CC\u666F\u548C\u5173\u7CFB\uFF1B2. \u8BBE\u5B9A\u4E0E\u8BB0\u5FC6\u3001\u804A\u5929\u8BB0\u5F55\u51B2\u7A81\u65F6\u4EE5\u4E16\u754C\u8BBE\u5B9A\u4E3A\u51C6\uFF1B3. \u4E0D\u8981\u76F4\u63A5\u80CC\u8BF5\u8BBE\u5B9A\u5185\u5BB9\uFF0C\u8981\u81EA\u7136\u5730\u878D\u5165\u56DE\u590D\uFF1B4. \u4E0D\u8981\u628A\u8BBE\u5B9A\u5F53\u6210\u5BF9\u65B9\u8BF4\u8FC7\u7684\u8BDD\uFF1B5. \u4E0D\u8981\u5728\u56DE\u590D\u91CC\u66B4\u9732\u300C\u8FD9\u662F\u8BBE\u5B9A\u300D\uFF1B6. \u8BBE\u5B9A\u6CA1\u63D0\u5230\u7684\u5185\u5BB9\u4E0D\u8981\u51ED\u7A7A\u7F16\u9020\u3002\u4FE1\u606F\u4F18\u5148\u7EA7\uFF1A\u7CFB\u7EDF\u89C4\u5219 > \u4E16\u754C\u4E66 > \u4EBA\u8BBE > \u8BB0\u5FC6 > \u804A\u5929\u8BB0\u5F55 > \u65B0\u6D88\u606F\uFF0C\u4F46\u5BF9\u65B9\u7684\u65B0\u6D88\u606F\u6C38\u8FDC\u7B2C\u4E00\u65F6\u95F4\u56DE\u5E94\u3002';
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
      buckets[pos].push('\u3010\u4E16\u754C\u8BBE\u5B9A\u5F00\u59CB\u3011\n\u300A' + (book.name || '\u672A\u547D\u540D\u4E16\u754C\u4E66') + '\u300B\n' + body.join('\n\n') + '\n\u3010\u4E16\u754C\u8BBE\u5B9A\u7ED3\u675F\u3011');
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

/** \u7EC4\u88C5\u6700\u7EC8 system\uFF08\u7AD9\u5185 systemFull \u7684\u4E16\u754C\u4E66\u90E8\u5206\u540C\u6784\uFF1AbeforeSystem \u2192 [beforeChar \u4EBA\u8BBE afterChar] \u2192 afterSystem \u2192 \u89C4\u5219\uFF09 */
function buildCloudSystem(base, wb) {
  var parts = [];
  if (wb.bs) parts.push(wb.bs);
  parts.push([wb.bc, base, wb.ac].filter(Boolean).join('\n\n'));
  if (wb.as) parts.push(wb.as);
  if (wb.rules) parts.push(wb.rules);
  return parts.filter(Boolean).join('\n\n');
}

/** \u7F16\u53F7\u5386\u53F2 + \u5305\u88F9\u672C\u8F6E\u7528\u6237\u6D88\u606F\uFF08\u7AD9\u5185 [M\u6570\u5B57] \u95E8\u724C\u53F7\u540C\u6B3E\uFF09\uFF1AAI \u7528 [\u5F15\u7528:\u7F16\u53F7] \u5F15\u7528\u6307\u5B9A\u6D88\u606F */
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

/** \u5FAE\u4FE1\uFF1A\u5904\u7406\u4E00\u6761\u6765\u6D88\u606F\uFF0C\u8FD4\u56DE\u662F\u5426\u6210\u529F\u56DE\u590D\u3002
 *  v4\uFF1A\u2460LLM \u5931\u8D25\u91CD\u8BD5\u4E00\u6B21\uFF08\u539F\u6765\u4E00\u6B21\u5931\u8D25\u6D88\u606F\u5C31\u88AB\u9759\u9ED8\u4E22\u5F03\uFF0C\u4E3B\u4EBA\u770B\u5230\u300Cai\u4E0D\u56DE\u4FE1\u606F\u300D\uFF09\uFF1B
 *  \u2461\u51FA\u7AD9\u6587\u672C\u7ECF sanitizeWxOutText \u51C0\u5316\uFF08\u5927\u8868\u60C5\u6807\u8BB0\u2192\u7ECF\u5178\u8868\u60C5\u4EE3\u7801/\u5265\u9664\uFF09\uFF1B
 *  \u2462\u5931\u8D25\u539F\u56E0\u8BB0\u5165 WX_MSG_ERR\uFF08\u5FC3\u8DF3/ping \u53EF\u89C1\u2014\u2014\u539F\u6765\u9010\u6761\u5931\u8D25\u5B8C\u5168\u4E0D\u53EF\u89C1\uFF0C\u65E0\u6CD5\u6392\u67E5\uFF09 */
async function handleWxMsg(cfg, msg) {
  var text = extractText(msg);
  if (!text || !msg.from_user_id || !msg.context_token) return false;
  if (msg.from_user_id === cfg.wechat.botId) return false;
  // v12 \u771F\u673A\u5FAE\u4FE1\u300C\u5BF9\u65B9\u6B63\u5728\u8F93\u5165\u4E2D\u2026\u300D\uFF1A\u5B98\u65B9\u534F\u8BAE status 1=\u5F00\u59CB\u8F93\u5165\uFF08\u957F\u64CD\u4F5C\u6BCF 5s \u7EED\u4E00\u6B21\u4FDD\u6D3B\uFF09\u3001
  // 2=\u7ED3\u675F\u8F93\u5165\u3002\u65E7\u7248\u7528\u53CD\u4E86\uFF08\u56DE\u590D\u524D\u53D1 2=\u7ED3\u675F\u3001\u56DE\u590D\u540E\u53C8\u4E0D\u6536\u5C3E\uFF09\u2014\u2014\u771F\u673A\u5FAE\u4FE1\u4E0A\u4ECE\u6765
  // \u770B\u4E0D\u5230\u300C\u6B63\u5728\u8F93\u5165\u300D\u3002\u73B0\u5728\uFF1A\u53D6 ticket \u2192 \u53D1 1 \u2192 LLM \u671F\u95F4\u6BCF 5s \u7EED 1 \u2192 \u56DE\u590D\u53D1\u5B8C\u53D1 2 \u6536\u5C3E\u3002
  var typingTicket = '';
  var typingTimer = null;
  try {
    var c = await ilinkCall('/ilink/bot/getconfig', cfg.wechat.botToken, {
      ilink_user_id: msg.from_user_id, context_token: msg.context_token, base_info: BASE_INFO,
    });
    if (c && c.typing_ticket) typingTicket = String(c.typing_ticket);
  } catch (e) { /* \u53EF\u9009 */ }
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
    // v5 \u5386\u53F2\u79CD\u5B50\uFF1A\u4E91\u7AEF\u8FD8\u6CA1\u5B58\u8FC7\u5386\u53F2\u65F6\u7528\u8FD0\u884C\u5305\u91CC\u6253\u5305\u7684\u7F51\u7AD9\u804A\u5929\u6700\u8FD1 20 \u6761\uFF08\u4E91\u7AEF\u51B7\u542F\u52A8
    // \u4E0D\u5931\u5FC6\u2014\u2014\u56DE\u590D\u5185\u5BB9\u4E0E\u624B\u673A App \u804A\u5929\u540C\u6E90\u8FDE\u7EED\uFF0C\u7528\u6237\u53CD\u9988\u300C\u7F51\u7AD9\u4E0A\u600E\u4E48\u56DE\u590D\u7684\u5FAE\u4FE1\u5C31\u600E\u4E48\u56DE\u300D\uFF09
    if ((!hist || !hist.length) && cfg.wechat && Array.isArray(cfg.wechat.history) && cfg.wechat.history.length) {
      hist = cfg.wechat.history.slice(-20);
      HIST_WX = hist;
    }
    // v13 \u4E16\u754C\u4E66\uFF08\u8FD0\u884C\u5305\u6253\u5305\u7684\u6302\u8F7D\u4E66\uFF1A\u5168\u5C40\u5E38\u9A7B + \u89E6\u53D1\u8BCD\u547D\u4E2D\uFF0C\u626B\u63CF\u53E3\u5F84 = \u6765\u6D88\u606F + \u6700\u8FD1 8 \u6761\u5386\u53F2\uFF09
    var scanParts = [text];
    for (var wsi = Math.max(0, hist.length - 8); wsi < hist.length; wsi++) {
      if (hist[wsi] && hist[wsi].content) scanParts.push(hist[wsi].content);
    }
    var wb = collectCloudWb(cfg.wechat.worldbook, scanParts.join('\n'));
    var system = buildCloudSystem((cfg.wechat.persona && cfg.wechat.persona.system) || '\u4F60\u548C\u4E3B\u4EBA\u5728\u771F\u5B9E\u5FAE\u4FE1\u4E0A\u804A\u5929\uFF0C\u56DE\u590D\u7B80\u77ED\u81EA\u7136\uFF0C\u7EDD\u4E0D\u900F\u9732\u81EA\u5DF1\u662FAI\u3002', wb);
    // v13 \u7F16\u53F7\u5386\u53F2\uFF08[M\u6570\u5B57] \u95E8\u724C\u53F7\u2014\u2014\u7AD9\u5185\u5F15\u7528\u673A\u5236\u540C\u6B3E\uFF09+ \u4E16\u754C\u4E66 user \u4F4D\u5305\u88F9\u672C\u8F6E\u6D88\u606F
    var numbered = cloudNumbered(hist, text, wb);
    var msgs = [{ role: 'system', content: system }];
    for (var i = Math.max(0, numbered.msgs.length - 13); i < numbered.msgs.length - 1; i++) msgs.push(numbered.msgs[i]);
    msgs.push(numbered.msgs[numbered.msgs.length - 1]);
    var reply = '';
    var lastLlmErr = null;
    for (var att = 0; att < 2 && !reply; att++) {
      try {
        reply = await callLlm(cfg, msgs);
      } catch (le) { lastLlmErr = le; }
    }
    if (!reply) {
      WX_MSG_ERR = ('LLM \u56DE\u590D\u5931\u8D25\uFF1A' + String((lastLlmErr && lastLlmErr.message) || lastLlmErr)).slice(0, 160);
      WX_MSG_ERR_AT = Date.now();
      throw new Error(WX_MSG_ERR);
    }
    // v13 \u8FDE\u53D1 + \u5F15\u7528 + \u6DF1\u5EA6\u601D\u8003\u5265\u9664 + \u5BCC\u5A92\u4F53\u6807\u8BB0\u51C0\u5316\uFF08\u4E0E\u7F51\u7AD9\u540C\u6E90\uFF1A\u4E00\u53E5\u4E00\u6761\u9010\u6761\u53D1\uFF09\uFF1A
    // [\u601D\u8003]\u5757\u5265\u6389\u3001[\u5F15\u7528:M\u7F16\u53F7] \u8F6C\u6587\u5B57\u5F15\u7528\u884C\uFF08\u6302\u7B2C\u4E00\u6761\u6B63\u6587\u524D\uFF09\u3001\u7AD9\u5185\u52A8\u4F5C\u6807\u8BB0\u5265\u9664\u3001
    // [\u8868\u60C5\u5305:ID] \u7ECF\u8FD0\u884C\u5305 stickerMap \u8F6C\u5FAE\u4FE1\u7ECF\u5178\u8868\u60C5\u4EE3\u7801
    var q = extractQuote(stripThinkBlocks(reply), numbered.quoteMap);
    var cleaned = stripRichMarkers(q.text);
    var segs = cloudReplySegments(cleaned, cfg.wechat.multi !== false);
    if (!segs.length) segs = [WX_EMOJI_FALLBACKS[Math.floor(Math.random() * WX_EMOJI_FALLBACKS.length)]];
    for (var ssi = 0; ssi < segs.length; ssi++) segs[ssi] = sanitizeWxOutText(cfg, segs[ssi]);
    if (q.quote) segs[0] = '\u300C' + q.quote + '\u300D\n' + segs[0];
    // 8 \u6761\u4E0A\u9650\uFF1A\u8D85\u51FA\u5E76\u5165\u672B\u6761\uFF08\u4E0D\u4E22\u5185\u5BB9\uFF09\uFF1B\u9010\u6761\u8FDE\u53D1 + \u771F\u4EBA\u8282\u594F\u95F4\u9694\uFF08\u6B63\u5728\u8F93\u5165\u4FDD\u6D3B\u6301\u7EED\u5230\u53D1\u5B8C\uFF09
    if (segs.length > 8) {
      var head = segs.slice(0, 7);
      head.push(segs.slice(7).join('\n'));
      segs = head;
    }
    for (var gi = 0; gi < segs.length; gi++) {
      await sendWxText(cfg, msg.from_user_id, msg.context_token, segs[gi]);
      if (gi < segs.length - 1) await coreSleep(280 + Math.floor(Math.random() * 420));
    }
    if (WX_MSG_ERR_AT && Date.now() - WX_MSG_ERR_AT > 600000) WX_MSG_ERR = '';
    // v13 \u5386\u53F2\u9010\u6BB5\u843D\u5E93\uFF08\u7F51\u7AD9\u62C9\u53D6\u5C55\u793A = \u8FDE\u53D1\u591A\u6761\u6C14\u6CE1\uFF0C\u4E0E\u7AD9\u5185\u804A\u5929\u9875\u4E00\u81F4\uFF09
    var histAdd = [{ role: 'user', content: text.slice(0, 500), ts: Date.now() }];
    for (var hi = 0; hi < segs.length; hi++) {
      histAdd.push({ role: 'assistant', content: segs[hi].slice(0, 500), ts: Date.now() });
    }
    HIST_WX = (HIST_WX || []).concat(histAdd).slice(-30);
    await saveWxHistory();
    return true;
  } catch (e) {
    if (!WX_MSG_ERR) {
      WX_MSG_ERR = ('\u5FAE\u4FE1\u56DE\u590D\u5931\u8D25\uFF1A' + String(e && e.message)).slice(0, 160);
      WX_MSG_ERR_AT = Date.now();
    }
    throw e;
  } finally {
    // \u56DE\u590D\u6210\u529F/\u5931\u8D25\u90FD\u6536\u5C3E\uFF1A\u505C\u4FDD\u6D3B\u5B9A\u65F6\u5668 + \u53D1 status 2 \u7ED3\u675F\u8F93\u5165
    stopTypingLight();
  }
}

/** \u5FAE\u4FE1\uFF1A\u8F6E\u8BE2\u4E00\u8F6E\uFF0C\u8FD4\u56DE\u672C\u8F6E\u5904\u7406\u4E86\u51E0\u6761\u6D88\u606F\uFF1BTOKEN_EXPIRED \u629B\u9519\u3002
 *  v9\uFF1A\u2460\u5F00\u8F6E\u8BE2\u9501\uFF08\u522B\u7684 owner 50s \u5185\u6D3B\u8DC3 \u2192 \u8BA9\u4F4D\u8FD4\u56DE 0\uFF09\uFF1B\u2461\u6E38\u6807\u6062\u590D \u2192 \u6536\u4E00\u6279 \u2192
 *  \u9010\u6761\u300C\u8BA4\u9886\u2192\u56DE\u2192\u9500\u8BA4\u9886\u2192\u8BB0\u5DF2\u56DE\u300D\uFF08\u522B\u4EBA\u5DF2\u8BA4\u9886\u7684\u8DF3\u8FC7\u2014\u2014\u5E76\u53D1\u53CC\u8F6E\u8BE2\u5668\u4E0D\u518D\u53CC\u56DE\uFF09\uFF1B
 *  \u5168\u90E8\u6210\u529F\u624D\u843D\u6E38\u6807\uFF08\u4E2D\u9014\u5931\u8D25\u4FDD\u6301\u65E7\u6E38\u6807\uFF1A\u4E0B\u8F6E\u91CD\u6536\u6574\u6279\uFF0C\u5DF2\u56DE\u7684\u9760 seen \u8DF3\u8FC7\u3001\u53EA\u91CD\u8BD5\u6CA1\u56DE\u6210\u529F\u7684\uFF09\u3002 */
async function tick() {
  var cfg = await loadConfig(false);
  if (!cfg.wechat || !cfg.wechat.botToken) return 0;
  // v9 \u8F6E\u8BE2\u9501\uFF1A\u8BA9\u4F4D\u4E0D\u6539\u6B63\u786E\u6027\uFF08\u8BA4\u9886\u8868\u5151\u5E95\uFF09\uFF0C\u53EA\u662F\u7701\u4E00\u6B21\u91CD\u590D getupdates
  try {
    var lk = await loadWxLock();
    if (lk && lk.owner !== POLL_OWNER && Date.now() - lk.at < WX_LOCK_TTL) return 0;
    await writeWxLock();
  } catch (e) { /* \u9501\u8BFB\u5199\u5931\u8D25\u7167\u5E38\u8F6E\u8BE2\uFF08\u8BA4\u9886\u8868\u5151\u5E95\u5E76\u53D1\u5B89\u5168\uFF09 */ }
  await loadWxCursor();
  await loadWxClaims();
  var d = await ilinkCall('/ilink/bot/getupdates', cfg.wechat.botToken, {
    get_updates_buf: UPDATES_BUF, base_info: BASE_INFO,
  });
  if (d && d.error_code === -14) throw new Error('TOKEN_EXPIRED');
  if (d && typeof d.get_updates_buf === 'string' && d.get_updates_buf) UPDATES_BUF = d.get_updates_buf;
  var n = 0;
  var pending = 0;
  var msgs = (d && d.msgs) || [];
  for (var i = 0; i < msgs.length; i++) {
    var mid = msgs[i] && msgs[i].message_id != null ? String(msgs[i].message_id) : '';
    if (wxSeenHas(mid)) continue;
    pending++;
    if (wxClaimFresh(mid)) continue; // \u522B\u7684\u8F6E\u8BE2\u5668\u6B63\u5728\u56DE\u8FD9\u6761\uFF1A\u8DF3\u8FC7\uFF08\u5B83\u56DE\u5B8C\u4F1A\u8BB0 seen/\u843D\u6E38\u6807\uFF09
    if (mid) await writeWxClaim(mid);
    try {
      if (await handleWxMsg(cfg, msgs[i])) {
        n++;
        if (mid) { await markWxSeen(mid); await clearWxClaim(mid); }
      } else if (mid) {
        await clearWxClaim(mid); // \u7A7A\u6D88\u606F/\u81EA\u53D1\u6D88\u606F\u7B49\uFF1A\u9500\u8BA4\u9886\uFF0C\u4E0D\u5360\u91CD\u8BD5\u4F4D
      }
    } catch (e) {
      if (mid) await clearWxClaim(mid); // \u5931\u8D25\u7ACB\u5373\u91CA\u653E\uFF1A\u4E0B\u4E00\u8F6E\u91CD\u8BD5
      if (String(e && e.message).indexOf('TOKEN_EXPIRED') >= 0) throw e;
      /* \u5355\u6761\u5931\u8D25\u7EE7\u7EED\u4E0B\u4E00\u6761\uFF1B\u539F\u56E0\u5DF2\u8BB0\u5165 WX_MSG_ERR\uFF08\u5FC3\u8DF3/ping \u53EF\u89C1\uFF09 */
    }
  }
  if (pending === 0 || n >= pending) await saveWxCursor();
  return n;
}

// ---- QQ\uFF1Aaccess_token\uFF082h \u6709\u6548\uFF0C110 \u5206\u949F\u5237\u65B0\u7F13\u5B58\uFF1B\u53CC\u7AEF\u70B9\u964D\u7EA7\uFF1A\u65B0\u7AEF\u70B9\u6D77\u5916\u53EF\u8FBE\uFF0C\u65E7\u7AEF\u70B9\u7F51\u5173\u62E6 503\uFF09 ----
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
        // v8\uFF1A\u539F\u6765\u6CA1\u6709\u8D85\u65F6\u2014\u2014QQ \u53D6\u51ED\u8BC1\u6302\u8D77\u4F1A\u5361\u4F4F WS \u8FDE\u63A5\u4E0E\u6D88\u606F\u56DE\u590D
        signal: AbortSignal.timeout(20000),
      });
      lastStatus = r.status;
      var j = await r.json().catch(function () { return {}; });
      if (j && j.access_token) {
        QQ_TOKEN = j.access_token;
        QQ_TOKEN_AT = Date.now();
        return QQ_TOKEN;
      }
      // \u4E1A\u52A1\u9519\u8BEF\uFF08\u5B98\u65B9\u7EA6\u5B9A HTTP 200 + code\uFF09\uFF1A\u6362\u7AEF\u70B9\u65E0\u610F\u4E49\uFF0C\u76F4\u63A5\u62A5\u53EF\u8BFB\u9519\uFF08code \u517C\u5BB9\u6570\u5B57/\u5B57\u7B26\u4E32\uFF09
      var bizCode = Number(j && j.code) || 0;
      if (bizCode) {
        if (bizCode === 100016) throw new Error('QQ \u51ED\u8BC1\u4E0D\u6B63\u786E\uFF08100016\uFF09\uFF1A\u8BF7\u6838\u5BF9 AppID/AppSecret');
        if (bizCode === 100007) throw new Error('QQ AppID \u65E0\u6548\u6216\u673A\u5668\u4EBA\u72B6\u6001\u5F02\u5E38\uFF08100007\uFF09');
        if (bizCode === 10004) throw new Error('QQ \u673A\u5668\u4EBA\u4E0D\u5B58\u5728\uFF0810004\uFF09');
        if (bizCode === 100001) throw new Error('QQ \u5E73\u53F0\u9891\u63A7\uFF08100001\uFF09\uFF1A\u7A0D\u540E\u518D\u8BD5');
        throw new Error('QQ token \u83B7\u53D6\u5931\u8D25 code ' + bizCode);
      }
      lastErr = 'HTTP ' + r.status;
    } catch (te) {
      if (String(te && te.message).indexOf('QQ ') === 0) throw te; // \u4E1A\u52A1\u9519\u4E0D\u518D\u964D\u7EA7
      lastErr = String(te && te.message);
    }
  }
  throw new Error('QQ token \u83B7\u53D6\u5931\u8D25 ' + (lastStatus || '') + ' ' + lastErr.slice(0, 80));
}

/** QQ\uFF1AEd25519 \u79CD\u5B50\uFF08Bot Secret \u91CD\u590D\u5230 32 \u5B57\u8282\uFF1B\u5B98\u65B9\u6587\u6863\u7B97\u6CD5\uFF09 */
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
  // v11 \u5E42\u7B49\uFF1A\u540C id \u5DF2\u5728\u5386\u53F2\u91CC\u5C31\u4E0D\u518D\u8FFD\u52A0\uFF08\u8BA4\u9886\u8868\u62E6\u4E0D\u4F4F\u7684\u8FB9\u89D2\uFF1A\u65E7\u7248\u53CC\u5199\u5B58\u91CF\u3001\u5E76\u53D1\u7ADE\u6001\uFF09\u3002
  // \u4E0D\u53BB\u91CD\u7684\u8BDD\u4E91\u7AEF qq-history.json \u4F1A\u51FA\u73B0\u540C id \u4E24\u4EFD\uFF0C\u624B\u673A App \u62C9\u56DE\u5408\u5165\u672C\u5730\u540E
  // \u540C\u4E00\u6761\u6D88\u606F\u6E32\u67D3\u4E24\u904D\uFF08React key \u62A5\u9519 + \u754C\u9762\u91CC\u300C\u56DE\u590D\u4E24\u4E09\u904D\u300D\u7684\u76F4\u63A5\u63A8\u624B\uFF09\u3002
  for (var ai = 0; ai < (HIST_QQ || []).length; ai++) {
    if (HIST_QQ[ai] && HIST_QQ[ai].id === item.id) return;
  }
  HIST_QQ = (HIST_QQ || []).concat([item]).slice(-200);
  await supaPutJson('qq-history.json', { msgs: HIST_QQ, updatedAt: Date.now() });
}

/** QQ\uFF1A\u88AB\u52A8\u56DE\u590D\uFF08v2 \u63A5\u53E3\uFF0C60 \u5206\u949F\u5185\u6709\u6548\u3001\u6BCF\u6761\u6D88\u606F\u6700\u591A\u56DE 5 \u6B21\uFF1Bseq \u9012\u589E\u9632\u540C msg_id \u649E\u53F7\uFF09 */
var QQ_SEQ = 1;
async function qqReply(cfg, openid, msgId, content, isGroup, groupOpenid) {
  var token = await qqToken(cfg);
  var url = isGroup ? QQ_API + '/v2/groups/' + groupOpenid + '/messages' : QQ_API + '/v2/users/' + openid + '/messages';
  var r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
    body: JSON.stringify({ msg_type: 0, content: content.slice(0, 1500), msg_id: msgId, msg_seq: QQ_SEQ++ }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) {
    var t = await r.text().catch(function () { return ''; });
    throw new Error('QQ \u56DE\u590D\u5931\u8D25 ' + r.status + ' ' + t.slice(0, 100));
  }
}

/** QQ\uFF1A\u4E0A\u4F20\u5BCC\u5A92\u4F53\u6587\u4EF6\uFF08file_type 1=\u56FE\u7247 2=\u89C6\u9891 3=\u8BED\u97F3 silk\uFF1Bfile \u4E3A base64\uFF0C\u22642MB\uFF09\uFF0C\u8FD4\u56DE file_info \u53E5\u67C4 */
async function qqUploadMedia(cfg, openid, isGroup, groupOpenid, fileType, dataB64) {
  var token = await qqToken(cfg);
  var url = isGroup ? QQ_API + '/v2/groups/' + groupOpenid + '/files' : QQ_API + '/v2/users/' + openid + '/files';
  var r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
    body: JSON.stringify({ file_type: fileType, file: dataB64, srv_send_msg: false }),
    signal: AbortSignal.timeout(30000),
  });
  var t = await r.text().catch(function () { return ''; });
  if (!r.ok) throw new Error('QQ \u5BCC\u5A92\u4F53\u4E0A\u4F20\u5931\u8D25 ' + r.status + ' ' + t.slice(0, 100));
  var j = null;
  try { j = JSON.parse(t); } catch (e) { j = null; }
  var fi = j && (j.file_info || (j.file_infos && j.file_infos[0] && j.file_infos[0].file_info)) || '';
  if (!fi) throw new Error('QQ \u5BCC\u5A92\u4F53\u4E0A\u4F20\u5931\u8D25\uFF1A\u65E0 file_info');
  return fi;
}

/** QQ\uFF1A\u53D1\u5BCC\u5A92\u4F53\u6D88\u606F\uFF08msg_type=2 media\uFF1B\u7528\u4E8E\u8868\u60C5\u56FE\u7247 / \u8BED\u97F3\u6761\uFF09 */
async function qqReplyMedia(cfg, openid, msgId, fileInfo, isGroup, groupOpenid) {
  var token = await qqToken(cfg);
  var url = isGroup ? QQ_API + '/v2/groups/' + groupOpenid + '/messages' : QQ_API + '/v2/users/' + openid + '/messages';
  var r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
    body: JSON.stringify({ msg_type: 2, media: { file_info: fileInfo }, msg_id: msgId, msg_seq: QQ_SEQ++ }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) {
    var t = await r.text().catch(function () { return ''; });
    throw new Error('QQ \u5BCC\u5A92\u4F53\u53D1\u9001\u5931\u8D25 ' + r.status + ' ' + t.slice(0, 100));
  }
}

/** silk \u7F16\u7801\u5668\uFF08QQ \u539F\u751F\u8BED\u97F3\u6761\uFF09\uFF1ADeno \u7528 npm:silk-wasm\uFF0CNode \u7528\u8FD0\u884C\u5305\u540C\u76EE\u5F55 ./silk-wasm.mjs + silk.wasm\u3002
 *  \u52A0\u8F7D\u5931\u8D25\u7F13\u5B58 10 \u5206\u949F\uFF08\u6587\u4EF6\u6CA1\u5E26\u4E0A/\u7F51\u7EDC\u95EE\u9898\u65F6\u4E0D\u6BCF\u6761\u6D88\u606F\u90FD\u91CD\u8BD5\uFF09\uFF1B\u5931\u8D25\u8FD4\u56DE null \u964D\u7EA7\u6587\u5B57 */
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

/** \u4E91\u7AEF TTS\uFF08OpenAI \u517C\u5BB9 /audio/speech\uFF0C\u53EA\u8981 wav\uFF09\u2192 silk \u2192 QQ \u539F\u751F\u8BED\u97F3\u6761\u3002\u5931\u8D25\u8FD4\u56DE null\uFF08\u964D\u7EA7\u6587\u5B57\uFF09 */
async function synthesizeQqVoice(cfg, text) {
  var tts = cfg.qq && cfg.qq.tts;
  // v13\uFF1A\u7F51\u5173\u672C\u5730\u5408\u6210\u7AEF\u70B9\uFF08im-gateway \u6CE8\u5165\uFF0Cz-ai SDK \u5408\u6210 wav\uFF09\u4F18\u5148\u4E8E\u7528\u6237\u81EA\u914D TTS\u2014\u2014
  // \u7F51\u5173\u5728\u7EBF\uFF08\u79D2\u56DE\u52A0\u901F\uFF09\u65F6 QQ \u8BED\u97F3\u6761\u96F6\u914D\u7F6E\u53EF\u7528\uFF1B\u4E91\u7AEF\uFF08Deno\uFF09\u6CA1\u6CE8\u5165\u5219\u8D70 cfg.qq.tts
  var localUrl = TTS_LOCAL_URL;
  if (!localUrl && (!tts || !tts.baseUrl || !tts.apiKey)) return null;
  try {
    var r = null;
    if (localUrl) {
      r = await fetch(localUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text.slice(0, 200), voice: (tts && tts.voice) || 'tongtong', speed: 1, response_format: 'wav' }),
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
    var silk = await silkEncode(buf);
    if (!silk) return null;
    var bin = '';
    for (var i = 0; i < silk.length; i += 32768) bin += String.fromCharCode.apply(null, silk.subarray(i, i + 32768));
    var b64 = (typeof btoa === 'function') ? btoa(bin) : Buffer.from(silk).toString('base64');
    var dur = Math.max(1, Math.round(text.length / 4));
    return { b64: b64, dur: dur };
  } catch (e) { return null; }
}

/** \u56DE\u590D\u91CC\u7684\u8868\u60C5\u6807\u8BB0\uFF08[\u8868\u60C5\u5305:\u540D\u5B57/ID] / [\u8868\u60C5:\u540D\u5B57] / [\u53D1\u9001\u4E86\u8868\u60C5:\u540D\u5B57]\uFF09
 *  v13 token \u4E0A\u9650 20\u219248\uFF1A\u8D34\u7EB8 ID\uFF08stk-xxxxxxxx-xxxx\uFF09\u6BD4\u540D\u5B57\u957F\uFF0C20 \u5B57\u7B26\u4F1A\u628A ID \u622A\u65AD\u5BFC\u81F4\u89E3\u6790\u5931\u8D25 */
var QQ_STICKER_RE = /[\u3010\[]\s*(?:\u8868\u60C5\u5305|\u8868\u60C5|\u8D34\u7EB8|\u53D1\u9001\u4E86\u8868\u60C5\u5305|\u53D1\u9001\u4E86\u8868\u60C5|\u53D1\u9001\u8868\u60C5)\s*[:\uFF1A]\s*([^\u3011\]]{1,48})\s*[\u3011\]]/g;

/** \u81EA\u7136\u8BED\u53E5\u53D8\u4F53\uFF08[\u53D1\u9001\u4E86\u4E00\u4E2A"\u62B1\u62B1"\u8868\u60C5\u5305]\uFF1AAI \u4E0D\u6309\u6807\u8BB0\u5199\uFF0C\u800C\u662F\u5199\u4E00\u53E5\u300C\u53D1\u9001\u4E86+\u8BCD+\u8868\u60C5\u5305\u300D\uFF09 */
var QQ_STICKER_NATURAL_RE =
  /[\u3010\[]\s*(?:\u53D1\u9001|\u53D1)\s*(?:\u4E86|\u51FA)?\s*(?:\u4E00?\u4E2A)?\s*["\u201c\u300c\u300e']?\s*([^"'\u201d\u2019\u300d\u300f\u3010\[\]\u3011\s:\uFF1A\uFF0C\u3002\uFF01!]{1,16}?)\s*["'\u201d\u2019\u300d\u300f]?\s*(?:\u8868\u60C5\u5305|\u8868\u60C5|\u8D34\u7EB8)\s*[\u3011\]]/g;

/** \u56FE\u7247\u63CF\u8FF0\u53D8\u4F53\uFF08[\u56FE\u7247: \u4E00\u53EA\u5706\u6EDA\u6EDA\u7684\u67F4\u72AC\u2026]\uFF1AAI \u628A\u53D1\u8868\u60C5\u5305\u7406\u89E3\u6210\u53D1\u56FE\u7247\uFF0C\u7528\u753B\u9762\u63CF\u8FF0\u5F53\u6807\u8BB0\uFF09 */
var QQ_STICKER_IMAGE_RE = /[\u3010\[]\s*\u56FE\u7247\s*[:\uFF1A]\s*([^\u3011\]]{2,60})\s*[\u3011\]]/g;

/** [\u56FE\u7247:\u63CF\u8FF0] \u53D8\u4F53\u5339\u914D\uFF1A\u63CF\u8FF0\u542B\u8868\u60C5\u540D \u2192 \u8BE5\u540D\u5B57\uFF1B\u518D\u6309\u52A8\u4F5C/\u52A8\u7269\u60C5\u611F\u8BCD\u5151\u5E95\uFF08\u540D\u5B57\u5728\u6E05\u5355\u91CC\u624D\u8FD4\u56DE\uFF0C\u627E\u4E0D\u5230 null\uFF09 */
function resolveQqEmoticonFromDesc(cfg, desc) {
  var d = String(desc || '').trim();
  if (!d) return null;
  var list = (cfg.qq && cfg.qq.emoticons) || [];
  for (var i = 0; i < list.length; i++) {
    var n = list[i] && list[i].name;
    if (n && n.length >= 2 && d.indexOf(n) >= 0) return n;
  }
  var FEEL = [
    [/\u62B1|\u6402/, '\u62B1'], [/\u8E6D|\u8D34|\u7C98/, '\u8E6D'], [/\u6478|\u63C9/, '\u6478'], [/\u4EB2|\u543B/, '\u4EB2'],
    [/\u54ED|\u6D41\u6CEA|\u545C/, '\u54ED'], [/\u7B11|\u5F00\u5FC3|\u9AD8\u5174/, '\u7B11'], [/\u6012|\u6C14\u9F13|\u54FC/, '\u6012'],
    [/\u7761|\u665A\u5B89|\u56F0/, '\u7761'], [/\u5F97\u610F|\u54FC\u54FC|\u9A84\u50B2/, '\u5F97\u610F'],
    [/\u67F4\u72AC|\u5C0F\u72D7|\u72D7\u72D7|\u6C6A/, '\u62B1'], [/\u732B|\u55B5/, '\u8D34'],
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

/** \u8FD0\u884C\u5305\u5185\u7F6E\u8868\u60C5\uFF08cfg.qq.emoticons: [{name, dataUrl}]\uFF09\u5339\u914D\uFF1A\u540D\u5B57\u7CBE\u786E \u2192 \u4E92\u76F8\u5305\u542B */
function resolveQqEmoticon(cfg, token) {
  var t = String(token || '').trim();
  if (!t) return null;
  var list = (cfg.qq && cfg.qq.emoticons) || [];
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === t) return list[i];
  // v13 ID \u76F4\u9009\uFF1A\u7AD9\u5185\u4EBA\u8BBE\u6E05\u5355\u6559\u7684\u662F [\u8868\u60C5\u5305:ID]\uFF08\u8FD0\u884C\u5305 emoticons \u5E26\u6253\u5305\u65F6\u540C\u6E90 sticker id\uFF09
  for (var i2 = 0; i2 < list.length; i2++) if (list[i2] && list[i2].id && list[i2].id === t) return list[i2];
  for (var j = 0; j < list.length; j++) {
    var n = list[j] && list[j].name;
    if (n && (n.indexOf(t) >= 0 || t.indexOf(n) >= 0)) return list[j];
  }
  return null;
}

/** \u4E91\u7AEF\u9A8C\u8BC1 QQ \u51ED\u8BC1\uFF08\u90E8\u7F72\u540E\u4ECE\u4E91\u7AEF\u51FA\u53E3\u8FDE QQ \u5E73\u53F0\uFF1B\u65B0\u7AEF\u70B9 api.bot.qq.com \u6D77\u5916\u51FA\u53E3\u53EF\u8FBE\uFF0C503 \u5730\u57DF\u62E6\u5DF2\u6210\u5386\u53F2\uFF09 */
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
        } catch (e3) { /* \u62FF\u4E0D\u5230\u540D\u5B57\u4E0D\u7B97\u5931\u8D25 */ }
        return { ok: true, botName: botName };
      }
      // \u4E1A\u52A1\u9519\u8BEF\uFF08HTTP 200 + code\uFF09\uFF1A\u6362\u7AEF\u70B9\u65E0\u610F\u4E49\uFF0C\u76F4\u63A5\u7ED9\u53EF\u8BFB\u63D0\u793A\uFF08code \u517C\u5BB9\u6570\u5B57/\u5B57\u7B26\u4E32\uFF09
      var code = Number(j && j.code) || 0;
      var why = code === 100016 ? 'AppID \u6216 AppSecret \u4E0D\u6B63\u786E\uFF08100016\uFF09'
        : code === 100007 ? 'AppID \u65E0\u6548\u6216\u673A\u5668\u4EBA\u72B6\u6001\u5F02\u5E38\uFF08100007\uFF09'
        : code === 10004 ? 'AppID \u5BF9\u5E94\u7684\u673A\u5668\u4EBA\u4E0D\u5B58\u5728\uFF0810004\uFF09'
        : code === 100001 ? '\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF08100001\uFF09\uFF0C\u7A0D\u540E\u518D\u8BD5'
        : '\u8BF7\u68C0\u67E5 AppID/AppSecret \u662F\u5426\u6B63\u786E';
      if (code) return { ok: false, error: 'QQ \u5E73\u53F0\u8FD4\u56DE code ' + code + '\uFF1A' + why + (j && j.message ? '\uFF08' + j.message + '\uFF09' : '') };
      lastErr = (j && j.message) || ('HTTP ' + r.status);
    } catch (e) {
      lastErr = String(e && e.message).slice(0, 120);
    }
  }
  // \u53CC\u7AEF\u70B9\u90FD\u6CA1\u62FF\u5230\u4E1A\u52A1\u56DE\u5305\uFF1A\u5178\u578B\u662F\u7F51\u7EDC\u4E0D\u901A/\u88AB\u7F51\u5173\u62E6\u2014\u2014QQ \u6536\u53D1\u6D88\u606F\u8D70\u5185\u7F6E\u7F51\u5173\u7684
  // WebSocket \u957F\u8FDE\u63A5\uFF08\u8BBE\u7F6E \u2192 \u4E91\u7AEF\u52A9\u624B \u2192\u300C\u81EA\u52A8\u5728\u7EBF\u300D\uFF09\uFF0C\u4E0D\u4F9D\u8D56\u8FD9\u53F0\u4E91\u670D\u52A1\u5668\u7684\u51FA\u53E3
  var geo = lastStatus === 503 ? '\uFF08503\uFF1AQQ \u7F51\u5173\u62D2\u7EDD\u4E86\u8FD9\u53F0\u4E91\u670D\u52A1\u5668\u7684\u51FA\u53E3 IP\uFF09\u2014\u2014QQ \u6536\u53D1\u6D88\u606F\u8D70\u300C\u81EA\u52A8\u5728\u7EBF\u300D\u5185\u7F6E\u7F51\u5173\uFF08WebSocket \u957F\u8FDE\u63A5\uFF0C\u4E0D\u53D7\u6B64\u9650\u5236\uFF09' : '';
  return { ok: false, error: '\u4E91\u7AEF\u8FDE\u4E0D\u4E0A QQ \u5E73\u53F0\uFF1A' + (lastErr || 'HTTP ' + lastStatus).slice(0, 120) + geo };
}

/** QQ\uFF1A\u5165\u7AD9\u5BCC\u5A92\u4F53 content \u91CC\u7684 markdown \u56FE\uFF08![\u52A8\u753B\u8868\u60C5](\u2026)/![\u56FE\u7247](\u2026)\uFF09\u8F6C\u53EF\u8BFB\u5360\u4F4D\uFF0C\u4E0D\u628A\u88F8\u94FE\u63A5\u5806\u7ED9 LLM */
function qqMediaToPlaceholder(t) {
  return String(t || '').replace(/!\[([^\]]*)\]\([^)]*\)/g, function (_, alt) {
    var a = String(alt || '').trim();
    return a && a !== '\u56FE\u7247' && a !== '\u52A8\u753B\u8868\u60C5'
      ? '\uFF08\u5BF9\u65B9\u53D1\u4E86\u4E00\u4E2A\u8868\u60C5\u5305/\u56FE\u7247\uFF1A' + a + '\uFF09'
      : '\uFF08\u5BF9\u65B9\u53D1\u4E86\u4E00\u4E2A\u8868\u60C5\u5305/\u56FE\u7247\uFF0C\u5185\u5BB9\u770B\u4E0D\u5230\uFF09';
  });
}

/** QQ\uFF1A\u5904\u7406 C2C / \u7FA4@ \u6D88\u606F\u4E8B\u4EF6\uFF08d\uFF09\uFF0C\u8FD4\u56DE\u662F\u5426\u56DE\u590D\u6210\u529F\u3002
 *  \u56DE\u590D\u5206\u6D41\uFF1A\u6587\u5B57\uFF08msg_type 0\uFF09/ \u8BED\u97F3\u6761\uFF08TTS\u2192silk\uFF0Cfile_type 3\uFF09/ \u8868\u60C5\u5305\uFF08\u8FD0\u884C\u5305\u5185\u7F6E\u8868\u60C5\u56FE\uFF0Cfile_type 1\uFF09\u3002
 *  \u8BED\u97F3\u6761\u9891\u7387\uFF1Acfg.qq.voiceEvery\uFF08\u6BCF N \u6761 1 \u6761\uFF0C0=\u5173\uFF09\uFF0C\u8BA1\u6570\u5668\u5B58\u4E91\u7AEF state/qq-voice-counter.json\u3002 */
async function handleQqEvent(cfg, t, d) {
  // v12 \u65AD\u5F00\u5B88\u536B\uFF1A\u8FD0\u884C\u5305\u91CC\u5DF2\u6CA1\u6709 QQ \u51ED\u8BC1\uFF08\u624B\u673A App \u70B9\u4E86\u300C\u65AD\u5F00\u8FDE\u63A5\u300D\u2192 \u8FD0\u884C\u5305\u91CD\u63A8\u3001
  // \u957F\u8FDE\u63A5\u62C6\u9664\u524D\u7684\u7A97\u53E3\u671F\uFF09\u2014\u2014\u4E0D\u56DE\u590D\u3001\u4E0D\u5199\u5386\u53F2\u3001\u4E0D\u8BA4\u9886\u3002\u65E7\u7248\u8FD9\u91CC\u76F4\u63A5\u7A7A\u6307\u9488\u5D29\u5728
  // cfg.qq.persona\uFF0C\u4E14 WS \u672A\u62C6\u65F6\u6D88\u606F\u7167\u6536\u7167\u56DE\uFF08\u7F51\u9875\u663E\u793A\u5DF2\u65AD\u5F00\u3001\u771F\u673A QQ \u4E0A TA \u8FD8\u5728\u7EBF
  // \u8FD8\u5728\u56DE\u7684\u6839\u56E0\uFF09\u3002
  if (!cfg.qq || !cfg.qq.appId) return false;
  var content = qqMediaToPlaceholder(String((d && d.content) || '').trim());
  var authorId = d && d.author && d.author.id ? String(d.author.id) : '';
  var msgId = d && d.id ? String(d.id) : '';
  if (!authorId || !msgId) return false;
  // \u7A7A\u6B63\u6587 + \u5E26\u9644\u4EF6 = \u5BCC\u5A92\u4F53\u6D88\u606F\uFF08\u90E8\u5206\u4E8B\u4EF6 content \u4E3A\u7A7A\u53EA\u6302 attachments\uFF09\uFF1A\u540C\u6837\u7ED9\u5360\u4F4D
  if (!content && d && d.attachments && d.attachments.length) {
    var at = d.attachments[0] && d.attachments[0].content_type;
    content = at && String(at).indexOf('image') >= 0 ? '\uFF08\u5BF9\u65B9\u53D1\u4E86\u4E00\u4E2A\u8868\u60C5\u5305/\u56FE\u7247\uFF0C\u5185\u5BB9\u770B\u4E0D\u5230\uFF09' : '\uFF08\u5BF9\u65B9\u53D1\u4E86\u4E00\u4E2A\u5A92\u4F53\u6D88\u606F\uFF09';
  }
  if (!content) return false;
  var isGroup = t === 'GROUP_AT_MESSAGE_CREATE';
  if (isGroup) content = content.replace(/^<at[^>]*>[^<]*<\/at>\s*/, '').trim();
  if (!content) return false;
  // v11 \u8BA4\u9886\u95E8\uFF1A\u7F51\u5173\u957F\u8FDE\u63A5 / \u4E91\u7AEF cron-cycle WS / Webhook / \u65AD\u7EBF Resume \u540E\u5E73\u53F0\u8865\u53D1\uFF0C
  // \u540C\u4E00\u6761\u4E8B\u4EF6\u4ECE\u51E0\u6761\u8DEF\u90FD\u80FD\u518D\u8FDB\u4E00\u6B21\u2014\u2014\u5148\u8BA4\u9886\uFF083 \u5206\u949F TTL\uFF09\uFF0C\u8BA4\u9886\u4E0D\u5230\u7684\u76F4\u63A5\u8DF3\u8FC7\u4E0D\u56DE
  // \uFF08\u300C\u56DE\u590D\u4E24\u4E09\u904D\u300D\u6839\u56E0\u4FEE\u590D\uFF0C\u4E0E\u5FAE\u4FE1 wx-claims \u540C\u6784\uFF09\u3002
  // v12 \u53CC\u68C0\uFF1A\u4E24\u8DEF\u51E0\u4E4E\u540C\u65F6\u8BA4\u9886\u65F6\uFF0CStorage \u65E0\u4E8B\u52A1\u3001\u540E\u5199\u8986\u76D6\u5148\u5199\u2014\u2014\u8BA4\u9886\u540E\u7B49 600ms
  // \u91CD\u8BFB\uFF0C\u5B58\u4E0B\u6765\u7684\u65F6\u95F4\u6233\u4E0D\u662F\u81EA\u5DF1\u5199\u7684\u90A3\u4EFD \u2192 \u5BF9\u65B9\u540E\u5230\u8986\u76D6\u4E86\u6211\u4EEC \u2192 \u8BA9\u4F4D\uFF08\u4FDD\u8BC1\u53EA\u56DE\u4E00\u904D\uFF09\u3002
  var qcl = await loadQqClaims(true);
  if (qqClaimFresh(msgId)) return false;
  var myClaimTs = await writeQqClaim(msgId);
  try {
  await coreSleep(600);
  var recheck = await loadQqClaims(true);
  if (recheck && typeof recheck[msgId] === 'number' && recheck[msgId] !== myClaimTs) return false;
  var hist = await loadQqHistory(false);
  // v5 \u5386\u53F2\u79CD\u5B50\uFF1A\u540C\u5FAE\u4FE1\u2014\u2014\u4E91\u7AEF\u8FD8\u6CA1\u6709 QQ \u5386\u53F2\u65F6\u7528\u8FD0\u884C\u5305\u6253\u5305\u7684\u7F51\u7AD9\u804A\u5929\u7EED\u4E0A\u4E0B\u6587
  if ((!hist || !hist.length) && cfg.qq && Array.isArray(cfg.qq.history) && cfg.qq.history.length) {
    hist = cfg.qq.history.slice(-20);
    HIST_QQ = hist;
  }
  var system = (cfg.qq.persona && cfg.qq.persona.system) || '\u4F60\u548C\u4E3B\u4EBA\u5728\u771F\u5B9EQQ\u4E0A\u804A\u5929\uFF0C\u56DE\u590D\u7B80\u77ED\u81EA\u7136\uFF0C\u7EDD\u4E0D\u900F\u9732\u81EA\u5DF1\u662FAI\u3002';
  // \u8868\u60C5\u5305\u6307\u4EE4\uFF1Av13 \u8FD0\u884C\u5305\u4EBA\u8BBE\uFF08\u7AD9\u5185\u7EC4\u88C5\u5668\u4EA7\u51FA\uFF09\u81EA\u5E26\u3010\u8868\u60C5\u5305\u6E05\u5355\u3011\u65F6\u4E0D\u518D\u91CD\u590D\u6CE8\u5165\u2014\u2014
  // \u53EA\u6709\u5151\u5E95\u4EBA\u8BBE\uFF08\u6CA1\u7ED1\u89D2\u8272/\u65E7\u8FD0\u884C\u5305\uFF09\u624D\u7ED9\u8FD9\u4EFD\u7CBE\u7B80\u6E05\u5355\u6559\u5B66\uFF08ID/\u540D\u5B57\u90FD\u53EF\u89E3\u6790\uFF09
  var emo = (cfg.qq && cfg.qq.emoticons) || [];
  if (emo.length && system.indexOf('\u8868\u60C5\u5305\u6E05\u5355') < 0) {
    var names = [];
    for (var ei = 0; ei < emo.length; ei++) if (emo[ei] && emo[ei].name) names.push(emo[ei].name);
    system +=
      '\n\u3010\u8868\u60C5\u5305\u3011\u4F60\u53EF\u4EE5\u53D1\u8868\u60C5\u5305\uFF1A\u5728\u56DE\u590D\u91CC\u5355\u72EC\u4E00\u884C\u8F93\u51FA [\u8868\u60C5\u5305:\u540D\u5B57\u6216ID]\u3002\u53EF\u7528\u540D\u5B57\uFF1A' +
      names.join('\u3001') +
      '\u3002\u4E3B\u4EBA\u8BA9\u4F60\u53D1\u8868\u60C5\u5305\u3001\u8981\u62B1\u62B1\u8E6D\u8E6D\u9017TA\u5F00\u5FC3\u65F6\u3010\u5FC5\u987B\u53D1\u3011\u2014\u2014\u660E\u786E\u70B9\u540D\u8981\u8868\u60C5\u5305\u7684\u90A3\u6761\u56DE\u590D\u91CC\u4E00\u5B9A\u8981\u5E26 [\u8868\u60C5\u5305:\u540D\u5B57] \u6807\u8BB0\uFF08\u53EF\u4EE5\u5148\u56DE\u4E00\u53E5\u6587\u5B57\u518D\u8DDF\u6807\u8BB0\uFF09\uFF0C\u4E0D\u8BB8\u53EA\u56DE\u6587\u5B57\u3001\u4E0D\u8BB8\u88C5\u50BB\uFF1B\u5E73\u65F6\u6B63\u5E38\u804A\u5929\u4E0D\u5FC5\u6BCF\u6B21\u90FD\u53D1\u3002';
  }
  // v10 QQ \u5386\u53F2\u89D2\u8272\u5F52\u4E00\uFF1Aqq-history.json \u91CC\u65B0\u65E7\u4E24\u79CD\u683C\u5F0F\u5E76\u5B58\uFF08\u65E7 me/peer\u3001\u65B0 user/assistant\uFF09\u2014\u2014
  // \u5F52\u4E00\u6210 LLM \u7684 user/assistant\uFF08\u65E7\u7248\u5199 me/peer \u4F46\u8FC7\u6EE4\u53EA\u8BA4 user/assistant\uFF0C\u4E91\u7AEF QQ \u4E0A\u4E0B\u6587
  // \u4E00\u76F4\u662F\u7A7A\u7684\u2014\u2014\u56DE\u590D\u4E0D\u8FDE\u8D2F\u7684\u6839\u56E0\u4E4B\u4E00\uFF09\u3002me=\u771F\u673A QQ \u4E0A\u53D1\u6D88\u606F\u7684\u4EBA\uFF08\u4E3B\u4EBA\uFF09\u2192 user\uFF0Cpeer=TA \u2192 assistant\u3002
  var recent = [];
  for (var ri = 0; ri < hist.length; ri++) {
    var rm = hist[ri];
    if (!rm || typeof rm.content !== 'string' || !rm.content) continue;
    var rrole = (rm.role === 'user' || rm.role === 'me') ? 'user' : (rm.role === 'assistant' || rm.role === 'peer') ? 'assistant' : '';
    if (!rrole) continue;
    recent.push({ role: rrole, content: rm.content });
  }
  // v13 \u4E16\u754C\u4E66 + \u7F16\u53F7\u5386\u53F2\uFF08\u540C\u5FAE\u4FE1\uFF1A[M\u6570\u5B57] \u95E8\u724C\u53F7 + \u516D\u4F4D\u7F6E\u6CE8\u5165 + user \u4F4D\u5305\u88F9\u672C\u8F6E\u6D88\u606F\uFF09
  var scanParts2 = [content];
  for (var wq = Math.max(0, recent.length - 8); wq < recent.length; wq++) scanParts2.push(recent[wq].content);
  var wb = collectCloudWb(cfg.qq.worldbook, scanParts2.join('\n'));
  system = buildCloudSystem(system, wb);
  var numbered = cloudNumbered(recent, content, wb);
  var msgs = [{ role: 'system', content: system }];
  for (var i = Math.max(0, numbered.msgs.length - 13); i < numbered.msgs.length - 1; i++) msgs.push(numbered.msgs[i]);
  msgs.push(numbered.msgs[numbered.msgs.length - 1]);
  var reply = await callLlm(cfg, msgs);
  // v13 \u6DF1\u5EA6\u601D\u8003\u5265\u9664 + \u5F15\u7528\u63D0\u53D6\uFF08[\u5F15\u7528:M\u7F16\u53F7] \u8F6C\u6587\u5B57\u5F15\u7528\u884C\uFF0C\u6302\u7B2C\u4E00\u6761\u6B63\u6587\u524D\uFF09
  var q = extractQuote(stripThinkBlocks(reply), numbered.quoteMap);
  // \u62C6\u8868\u60C5\u6807\u8BB0\uFF1A\u6587\u5B57\u6BB5\u4FDD\u7559\u3001\u6807\u8BB0\u8F6C\u56FE\u7247\u53D1\u9001\uFF08\u6700\u591A 3 \u5F20\u9632\u5237\u5C4F\uFF09\u3002
  // \u4E09\u5957\u6807\u8BB0\u4E00\u8D77\u626B\u63CF\uFF08\u6807\u51C6 [\u8868\u60C5\u5305:ID/\u540D\u5B57] / \u81EA\u7136\u8BED\u53E5 [\u53D1\u9001\u4E86\u4E00\u4E2A"\u62B1\u62B1"\u8868\u60C5\u5305] / \u56FE\u7247\u63CF\u8FF0
  // [\u56FE\u7247: \u4E00\u53EA\u67F4\u72AC\u2026]\uFF09\uFF1A\u6807\u51C6\u6807\u8BB0\u547D\u4E2D\u5C31\u5207\u51FA\uFF08\u540D\u5B57/ID \u89E3\u6790\u4E0D\u5230\u5728\u53D1\u9001\u6BB5\u8DF3\u8FC7\uFF09\uFF0C\u4E24\u4E2A\u53D8\u4F53
  // \u80FD\u89E3\u6790\u5230\u8868\u60C5\u624D\u5207\u51FA\uFF08\u5339\u914D\u4E0D\u5230\u4FDD\u7559\u539F\u6587\u5F53\u666E\u901A\u6587\u5B57\u53D1\uFF09\u3002
  var textParts = [];
  var emoHits = [];
  var cursor = 0;
  var hits = [];
  function collectHits(re, resolver) {
    re.lastIndex = 0;
    var m2 = null;
    while ((m2 = re.exec(q.text)) !== null) {
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
    var before = q.text.slice(cursor, h.s).trim();
    if (before) textParts.push(before);
    emoHits.push(h.tok);
    cursor = h.e;
  }
  var tailText = q.text.slice(cursor).trim();
  if (tailText) textParts.push(tailText);
  var textOut = textParts.join('\n').trim();
  if (!textOut && emoHits.length === 0) textOut = q.text.slice(0, 500);
  // v13 \u8FDE\u53D1\u5207\u5206\uFF08\u7AD9\u5185\u56DE\u590D\u6761\u6570 > 1\uFF1A\u53E5\u754C\u4E00\u6761\u6761\u53D1\uFF09+ \u7AD9\u5185\u52A8\u4F5C\u6807\u8BB0\u51C0\u5316 + \u5F15\u7528\u884C
  var cleaned = stripRichMarkers(textOut);
  var segs = cloudReplySegments(cleaned, cfg.qq.multi !== false);
  if (!segs.length && emoHits.length === 0) segs = [q.text.slice(0, 500)];
  if (q.quote && segs.length) segs[0] = '\u300C' + q.quote + '\u300D\n' + segs[0];
  // \u8BED\u97F3\u6761\u5224\u5B9A\uFF08v13\uFF1A\u8FDE\u53D1\u7684\u7B2C\u4E00\u6761\u5408\u6210\u8BED\u97F3\u3001\u5176\u4F59\u6587\u5B57\u7167\u5E38\u8FDE\u53D1\uFF1B\u7EAF\u8868\u60C5\u56DE\u590D\u4E0D\u53D1\u8BED\u97F3\uFF1B
  // \u4E91\u7AEF TTS\uFF08OpenAI \u517C\u5BB9\uFF09\u6216\u7F51\u5173\u672C\u5730\u5408\u6210\uFF08TTS_LOCAL_URL\uFF09\u4EFB\u4E00\u53EF\u7528\u5373\u5F00\uFF09
  var voiceClip = null;
  var voiceText = '';
  var ttsOk = (cfg.qq && cfg.qq.tts && cfg.qq.tts.baseUrl && cfg.qq.tts.apiKey) || TTS_LOCAL_URL;
  var every = ttsOk ? Number(cfg.qq.voiceEvery || 0) : 0;
  if (every > 0 && segs.length && emoHits.length === 0) {
    var counter = 0;
    try { var cst = await supaGetJson('state/qq-voice-counter.json'); counter = (cst && cst.n) || 0; } catch (ce) {}
    var vhit = counter % every === 0;
    counter = vhit ? 1 : counter + 1;
    try { await supaPutJson('state/qq-voice-counter.json', { n: counter, updatedAt: Date.now() }); } catch (ce2) {}
    if (vhit) {
      var clip = await synthesizeQqVoice(cfg, segs[0]);
      if (clip) { voiceClip = clip; voiceText = segs[0]; segs = segs.slice(1); }
    }
  }
  // \u53D1\u9001\u9884\u7B97\uFF1AQQ \u88AB\u52A8\u56DE\u590D\u540C\u4E00 msg_id \u6700\u591A 5 \u6B21\uFF08\u8BED\u97F3/\u6587\u5B57/\u8868\u60C5\u56FE\u5171\u7528\uFF09\u2014\u2014\u8D85\u51FA\u7684\u6587\u5B57\u5E76\u5165\u672B\u6761\u4E0D\u4E22\u5185\u5BB9
  var images = [];
  for (var si2 = 0; si2 < emoHits.length && images.length < 3; si2++) {
    var st = resolveQqEmoticon(cfg, emoHits[si2]);
    if (st && st.dataUrl && String(st.dataUrl).split(',')[1]) images.push(st);
  }
  var room = 5 - (voiceClip ? 1 : 0) - images.length;
  if (room < 1) { room = 1; images = images.slice(0, 5 - (voiceClip ? 1 : 0) - 1); }
  if (segs.length > room) {
    var head = room > 1 ? segs.slice(0, room - 1) : [];
    head.push(segs.slice(Math.max(0, room - 1)).join('\n'));
    segs = head;
  }
  // \u53D1\u9001\uFF1A\u8BED\u97F3\u6761\uFF08\u5931\u8D25\u964D\u7EA7\u6587\u5B57\uFF09\u2192 \u6587\u5B57\u8FDE\u53D1 \u2192 \u8868\u60C5\u56FE\u7247\uFF08\u9010\u5F20\uFF0C\u5355\u5F20\u5931\u8D25\u8DF3\u8FC7\uFF09
  if (voiceClip) {
    try {
      var vfi = await qqUploadMedia(cfg, authorId, isGroup, d.group_openid, 3, voiceClip.b64);
      await qqReplyMedia(cfg, authorId, msgId, vfi, isGroup, d.group_openid);
    } catch (ve) {
      voiceClip = null;
      segs = [voiceText].concat(segs); // \u8BED\u97F3\u5931\u8D25\uFF1A\u9996\u6BB5\u6587\u5B57\u8865\u56DE\uFF08\u4FDD\u5E95\u4E0D\u4E22\uFF09
    }
  }
  for (var sgi = 0; sgi < segs.length; sgi++) {
    await qqReply(cfg, authorId, msgId, segs[sgi], isGroup, d.group_openid);
  }
  var sentEmo = 0;
  for (var sji = 0; sji < images.length; sji++) {
    var sb64 = String(images[sji].dataUrl).split(',')[1] || '';
    if (!sb64) continue;
    try {
      var sfi = await qqUploadMedia(cfg, authorId, isGroup, d.group_openid, 1, sb64);
      await qqReplyMedia(cfg, authorId, msgId, sfi, isGroup, d.group_openid);
      sentEmo++;
    } catch (se) { /* \u5355\u5F20\u5931\u8D25\u8DF3\u8FC7 */ }
  }
  // \u5386\u53F2\u56DE\u5199\uFF08\u7F51\u7AD9\u62C9\u53D6\u5C55\u793A\uFF09\uFF1Av13 \u9010\u6761\u8FDE\u53D1\u843D\u5E93\uFF08= \u7AD9\u5185\u591A\u6761\u6C14\u6CE1\uFF09\uFF1B\u8BED\u97F3\u6761 [\u8BED\u97F3] \u6458\u8981\uFF1B
  // v10 \u89D2\u8272\u683C\u5F0F user/assistant\uFF08\u4E0E\u5FAE\u4FE1 history.json \u540C\u6784\uFF0C\u88AB\u672C\u6587\u4EF6\u81EA\u5DF1\u7684 LLM \u4E0A\u4E0B\u6587\u6D88\u8D39\uFF09\u3002
  // \u624B\u673A App \u62C9\u53D6\u7AEF\uFF08pullQqCloudHistory\uFF09\u5DF2\u505A\u53CC\u5411\u517C\u5BB9\uFF08me/peer \u65E7\u6761\u76EE\u7167\u5E38\u5408\u5165\uFF09\u3002
  await appendQqHistory({ id: 'q-' + msgId, role: 'user', content: content.slice(0, 500), ts: Date.now() });
  if (voiceClip) await appendQqHistory({ id: 'qv-' + msgId, role: 'assistant', content: ('[\u8BED\u97F3] ' + voiceText).slice(0, 500), ts: Date.now() });
  for (var hgi = 0; hgi < segs.length; hgi++) {
    await appendQqHistory({ id: 'qr-' + msgId + '-' + hgi, role: 'assistant', content: segs[hgi].slice(0, 500), ts: Date.now() });
  }
  var emoLog = [];
  for (var lei = 0; lei < sentEmo; lei++) emoLog.push('[\u8868\u60C5:' + (images[lei] && images[lei].name ? images[lei].name : '') + ']');
  if (emoLog.length) await appendQqHistory({ id: 'qe-' + msgId, role: 'assistant', content: emoLog.join(' ').slice(0, 500), ts: Date.now() });
  return true;
  } catch (e) {
    // \u5931\u8D25\u5373\u91CA\uFF1A\u56DE\u590D\u6CA1\u53D1\u51FA\u53BB\uFF08LLM \u5931\u8D25 / QQ \u63A5\u53E3\u5931\u8D25\uFF09\u65F6\u91CA\u653E\u8BA4\u9886\uFF0C\u4E0B\u4E00\u8F6E\u53EF\u91CD\u8BD5\uFF1B
    // \u56DE\u590D\u6210\u529F\u7684\u8DEF\u5F84\u4FDD\u7559\u8BA4\u9886\uFF0C\u76F4\u5230 TTL \u8FC7\u671F\uFF08\u671F\u95F4\u540C\u6761\u4E8B\u4EF6\u7684\u91CD\u53D1\u4E00\u5F8B\u4E0D\u56DE\uFF09
    try { await clearQqClaim(msgId); } catch (ce) { /* \u91CA\u653E\u5931\u8D25\u4E0D\u63A9\u76D6\u539F\u9519\u8BEF */ }
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

/** QQ WebSocket \u8FDE\u63A5\u9501\uFF08v9\uFF09\uFF1A\u540C\u4E00\u673A\u5668\u4EBA\u8D26\u53F7\u540C\u65F6\u5F00\u4E24\u6761\u957F\u8FDE\u63A5\u4F1A\u4E92\u8E22\u4F1A\u8BDD\u2014\u2014\u672C\u7AD9\u7F51\u5173
 *  \uFF08\u514D\u8D39\u52A0\u901F\u5668\uFF09\u4E0E\u4E91\u7AEF\u51FD\u6570\uFF08Supabase \u5B9A\u65F6\u4EFB\u52A1\uFF09\u7528\u8FD9\u628A\u9501\u4E92\u65A5\uFF0C\u8C01\u5728\u7EBF\u8C01\u6301\u6709\uFF0840s TTL\uFF0C
 *  \u6301\u6709\u671F\u95F4\u6BCF 15s \u7EED\u671F\uFF09\uFF1B\u53E6\u4E00\u65B9\u770B\u5230\u65B0\u9C9C\u9501\u5C31\u4E0D\u8FDE\uFF0C\u8BA9\u6D88\u606F\u53EA\u8D70\u4E00\u6761\u6D3B\u8FDE\u63A5\u3002 */
var QQ_WS_LOCK_TTL = 40000;
async function refreshQqWsLock(owner) {
  await supaPutJson('state/qq-ws-lock.json', { at: Date.now(), owner: String(owner || '') });
}
async function qqWsLockBlocked(owner) {
  var l = await supaGetJson('state/qq-ws-lock.json');
  return !!(l && typeof l.at === 'number' && typeof l.owner === 'string' && l.owner !== String(owner || '') && Date.now() - l.at < QQ_WS_LOCK_TTL);
}

export { loadConfig, tick, handleQqEvent, qqToken, writeHeartbeat, supaGetJson, supaPutJson, loadQqHistory, appendQqHistory, refreshQqWsLock };