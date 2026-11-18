/**
 * 生图 mock 服务（E2E 测试用）：实现 OpenAI 兼容的生图端点，返回纯色测试图。
 *
 * 端点（端口 3031）：
 * - GET  /v1/models                        → { data: [{id}] }
 * - POST /v1/images/generations (JSON)     → { data: [{ b64_json }] }（文生图）
 * - POST /v1/images/edits (multipart)      → { data: [{ b64_json }] }（锁脸图生图；image=参考图）
 * - 全部带 CORS 头（Access-Control-Allow-Origin: *），支持浏览器直连模式测试；OPTIONS 预检 204。
 *
 * 图片：64x64 纯色 PNG，颜色由 prompt hash 决定（同 prompt 同色、不同 prompt 不同色，便于断言）；
 * edits 请求额外在 JSON 响应里回显 received_ref=true（校验参考图确实上传了）。
 */

import { deflateSync } from 'node:zlib';

const PORT = 3031;

// ---------------- 最小 PNG 编码器（纯色 64x64） ----------------

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function solidPng(r, g, b) {
  const w = 64;
  const h = 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function colorFromPrompt(text) {
  let hash = 5381;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  return [(hash & 0xff) % 200 + 30, ((hash >> 8) & 0xff) % 200 + 30, ((hash >> 16) & 0xff) % 200 + 30];
}

// ---------------- HTTP 服务 ----------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (req.method === 'GET' && path === '/v1/models') {
      return json({
        data: [{ id: 'gpt-image-2' }, { id: 'gpt-image-1' }, { id: 'flux-pro' }, { id: 'flux-dev' }],
      });
    }

    if (req.method === 'POST' && path === '/v1/images/generations') {
      const body = await req.json().catch(() => ({}));
      if (!body.prompt) return json({ error: { message: 'prompt 必填' } }, 400);
      const [r, g, b] = colorFromPrompt(body.prompt);
      const b64 = solidPng(r, g, b).toString('base64');
      console.log(`[generations] model=${body.model} size=${body.size} quality=${body.quality} prompt=${String(body.prompt).slice(0, 50)}`);
      return json({ created: Date.now(), data: [{ b64_json: b64 }] });
    }

    if (req.method === 'POST' && path === '/v1/images/edits') {
      const fd = await req.formData();
      const prompt = String(fd.get('prompt') ?? '');
      const image = fd.get('image');
      if (!prompt) return json({ error: { message: 'prompt 必填' } }, 400);
      if (!(image instanceof Blob)) return json({ error: { message: 'image(参考图) 必填' } }, 400);
      const [r, g, b] = colorFromPrompt('ref:' + prompt);
      const b64 = solidPng(r, g, b).toString('base64');
      console.log(`[edits] model=${fd.get('model')} image=${image.size}B prompt=${prompt.slice(0, 50)}`);
      return json({ created: Date.now(), data: [{ b64_json: b64, received_ref: true }] });
    }

    return json({ error: { message: `mock 无此端点: ${req.method} ${path}` } }, 404);
  },
});

console.log(`[imggen-mock] listening on http://localhost:${PORT}`);
