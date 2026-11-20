// 测试 iLink CDN 上传闭环（不发送消息，只上传→下载→解密对比）
// 复刻 sources.ts 的 wxUploadStickerImage 流程，验证 CDN 是否真的存了文件
const fs = require('node:fs');
const crypto = require('node:crypto');

const cfg = JSON.parse(fs.readFileSync(__dirname + '/cfg.json', 'utf8'));
const data = cfg.data || cfg;
const botToken = data.wechat.botToken;
const ILINK = 'https://ilinkai.weixin.qq.com';

// 读取一张站内贴纸（webp）
const stickerPath = '/home/z/my-project/public/stickers/sunny/01.webp';
const plaintext = fs.readFileSync(stickerPath);
console.log('sticker bytes:', plaintext.length, 'magic:', plaintext[0].toString(16), plaintext[1].toString(16));

const rawsize = plaintext.length;
const rawfilemd5 = crypto.createHash('md5').update(plaintext).digest('hex');
const filekey = crypto.randomBytes(16).toString('hex');
const aeskey = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-128-ecb', aeskey, null);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

function wxUin() {
  const s = String(Math.floor(Math.random() * 4294967295));
  return Buffer.from(s).toString('base64');
}

async function ilinkCall(path, body) {
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
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => null);
  console.log('  →', path, 'HTTP', r.status, 'resp keys:', j ? Object.keys(j).join(',') : '(null)');
  return j || {};
}

(async () => {
  const toUserId = data.wechat.botId || 'u';
  console.log('== getuploadurl ==');
  const up = await ilinkCall('/ilink/bot/getuploadurl', {
    filekey,
    media_type: 1,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize: ciphertext.length,
    no_need_thumb: true,
    aeskey: aeskey.toString('hex'),
    base_info: { channel_version: '2.4.10', bot_agent: 'OpenClaw' },
  });
  console.log('upload_full_url?', !!up.upload_full_url, 'upload_param?', !!up.upload_param, 'errcode:', up.error_code, up.errmsg || '');

  const full = String(up.upload_full_url || '').trim();
  const param = String(up.upload_param || '').trim();
  if (!full && !param) {
    console.log('!! getuploadurl 没有回上传地址');
    process.exit(0);
  }
  const cdnUrl = full || 'https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=' + encodeURIComponent(param) + '&filekey=' + encodeURIComponent(filekey);
  console.log('== CDN POST ==');
  console.log('  url host:', new URL(cdnUrl).host, 'path:', new URL(cdnUrl).pathname);
  const r = await fetch(cdnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: ciphertext,
    signal: AbortSignal.timeout(30000),
  });
  console.log('  HTTP', r.status);
  const hdrs = {};
  for (const [k, v] of r.headers.entries()) hdrs[k] = v;
  console.log('  headers:', JSON.stringify(hdrs));
  const dl = r.headers.get('x-encrypted-param');
  console.log('  x-encrypted-param?', !!dl);
  if (!dl) { console.log('!! CDN 没回下载参数'); process.exit(0); }

  console.log('== CDN GET download（读回验证）==');
  const dlUrl = 'https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=' + encodeURIComponent(dl);
  const r2 = await fetch(dlUrl, { signal: AbortSignal.timeout(30000) });
  console.log('  HTTP', r2.status, 'bytes:', r2.ok ? (await r2.arrayBuffer()).byteLength : 0);
  if (r2.ok) {
    const got = Buffer.from(await r2.arrayBuffer());
    try {
      const decipher = crypto.createDecipheriv('aes-128-ecb', aeskey, null);
      const back = Buffer.concat([decipher.update(got), decipher.final()]);
      const same = back.equals(plaintext);
      console.log('  解密成功，与原文件一致?', same, 'back bytes:', back.length, 'orig:', plaintext.length);
    } catch (e) {
      console.log('  解密失败（密文与密钥不匹配）:', e.message, 'got bytes:', got.length, 'ciphertext was:', ciphertext.length);
    }
  }
})();
