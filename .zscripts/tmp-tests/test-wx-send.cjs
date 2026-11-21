// E2E：完整复刻 sources.ts 的 wxUploadStickerImage + wxSendSticker（生产代码路径）
// 发送一张真实贴纸到用户的微信，然后探测 CDN 下载是否可用
const fs = require('node:fs');
const crypto = require('node:crypto');

const cfg = JSON.parse(fs.readFileSync(__dirname + '/cfg.json', 'utf8'));
const data = cfg.data || cfg;
const botToken = data.wechat.botToken;
const lastctx = JSON.parse(fs.readFileSync(__dirname + '/lastctx.json', 'utf8')).data;
const ILINK = 'https://ilinkai.weixin.qq.com';
const WX_CDN_BASE = 'https://novac2c.cdn.weixin.qq.com/c2c';
const BASE_INFO = { channel_version: '2.4.10', bot_agent: 'OpenClaw' };

// —— 与 sources.ts 完全一致的纯 JS 工具（cloudB64ToBytes / md5 / AES-ECB）——
function cloudB64ToBytes(b64) {
  const bin = Buffer.from(b64, 'base64').toString('binary');
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 0xff;
  return u8;
}
function cloudBytesToB64(u8) { return Buffer.from(u8).toString('base64'); }
function cloudBytesToHex(u8) { return Buffer.from(u8).toString('hex'); }
function wxUin() { return Buffer.from(String(Math.floor(Math.random() * 4294967295))).toString('base64'); }

async function ilinkCall(path, body, timeoutMs) {
  const r = await fetch(ILINK + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + botToken,
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': wxUin(),
      'iLink-App-Id': 'bot',
      'iLink-App-ClientVersion': '132106',
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(Number(timeoutMs) || 50000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || (j && typeof j.error_code === 'number' && j.error_code !== 0 && j.error_code !== -1 && path.indexOf('getupdates') < 0)) {
    throw new Error('iLink ' + path + ' 失败 ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  }
  return j || {};
}

// —— 与 sources.ts 一致的 AES-128-ECB（用 node crypto，行为与纯 JS 实现一致）——
function aesEcbEncrypt(u8, key) {
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(key), null);
  return new Uint8Array(Buffer.concat([cipher.update(Buffer.from(u8)), cipher.final()]));
}

async function testSend(label, imgPath, decryptKey) {
  const plaintext = fs.readFileSync(imgPath);
  const bytes = new Uint8Array(plaintext);
  const rawfilemd5 = crypto.createHash('md5').update(plaintext).digest('hex');
  const filekey = cloudBytesToHex(crypto.randomBytes(16));
  const aesKey = new Uint8Array(crypto.randomBytes(16));
  const ciphertext = aesEcbEncrypt(bytes, aesKey);
  const toUserId = lastctx.fromUserId;
  const contextToken = lastctx.contextToken;

  console.log('== [' + label + '] getuploadurl ==');
  const up = await ilinkCall('/ilink/bot/getuploadurl', {
    filekey,
    media_type: 1,
    to_user_id: toUserId,
    rawsize: bytes.length,
    rawfilemd5,
    filesize: ciphertext.length,
    no_need_thumb: true,
    aeskey: cloudBytesToHex(aesKey),
    base_info: BASE_INFO,
  });
  const full = String((up && up.upload_full_url) || '').trim();
  const param = String((up && up.upload_param) || '').trim();
  console.log('  upload_full_url?', !!full, '| upload_param?', !!param, '| error_code:', up && up.error_code, up && up.errmsg);
  if (!full && !param) throw new Error('no upload url');
  const cdnUrl = full || (WX_CDN_BASE + '/upload?encrypted_query_param=' + encodeURIComponent(param) + '&filekey=' + encodeURIComponent(filekey));
  if (full) console.log('  full url params:', new URL(full).search.slice(0, 80) + '...');

  console.log('== [' + label + '] CDN POST ==');
  const r = await fetch(cdnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: ciphertext,
    signal: AbortSignal.timeout(30000),
  });
  console.log('  HTTP', r.status, 'ct:', r.headers.get('content-type'));
  const dl = r.headers.get('x-encrypted-param');
  console.log('  x-encrypted-param?', !!dl, 'len:', (dl || '').length);
  if (!dl) throw new Error('cdn no param');

  console.log('== [' + label + '] sendmessage image_item ==');
  const sm = await ilinkCall('/ilink/bot/sendmessage', {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: Date.now() + '-' + Math.random().toString(36).slice(2),
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{ type: 2, image_item: { media: { encrypt_query_param: dl, aes_key: cloudBytesToB64(aesKey), encrypt_type: 1 }, mid_size: ciphertext.length } }],
    },
    base_info: BASE_INFO,
  });
  console.log('  resp:', JSON.stringify(sm).slice(0, 200));

  // 发送后再探测 CDN 下载（绑定后应可读？）
  await new Promise((res) => setTimeout(res, 1500));
  const dlUrl = WX_CDN_BASE + '/download?encrypted_query_param=' + encodeURIComponent(dl);
  const r2 = await fetch(dlUrl, { signal: AbortSignal.timeout(20000) }).catch(() => null);
  console.log('== [' + label + '] CDN GET download after send ==');
  console.log('  HTTP', r2 ? r2.status : 'net-err');
  if (r2 && r2.ok) {
    const got = Buffer.from(await r2.arrayBuffer());
    try {
      const d = crypto.createDecipheriv('aes-128-ecb', Buffer.from(aesKey), null);
      const back = Buffer.concat([d.update(got), d.final()]);
      console.log('  解密成功！与原文件一致?', back.equals(plaintext), back.length, 'vs', plaintext.length);
    } catch (e) { console.log('  解密失败:', e.message, 'got', got.length, 'ct', ciphertext.length); }
  }
  return { dl, aesKey, filekey };
}

(async () => {
  const which = process.argv[2] || 'webp';
  if (which === 'webp') {
    await testSend('webp贴纸', '/home/z/my-project/public/stickers/sunny/01.webp');
  } else {
    await testSend('png贴纸', __dirname + '/sticker-test.png');
  }
})().catch((e) => console.log('!! 失败:', e.message));
