'use client';

/**
 * 敏感配置加密存储（API Key 等）：
 *
 * - 密钥：WebCrypto 生成 AES-GCM-256 **非可提取** CryptoKey（extractable=false，
 *   JS 永远拿不到原始密钥字节），CryptoKey 对象本身持久化在 IndexedDB settings.cryptoKey
 *   （浏览器底层保护；数据库文件被拷走也无法导出密钥）。
 * - 落盘形态：{ __enc: true, iv: base64, ct: base64 }（AES-GCM 密文 + 随机 IV），
 *   IndexedDB 里不再有明文 apiKey。
 * - 兼容：读到旧版明文记录原样返回（load 流程会用后立即加密回写，静默升级）。
 * - 边界（如实说明）：本机同源脚本仍可通过 CryptoKey 解密（无法用纯前端方案防住，
 *   本方案防的是「明文落盘」——数据库文件泄露/被同步备份时密钥与密文分离不在一起）。
 */

import { localDB, type AppSettingRecord } from './db';

interface EncEnvelope {
  __enc: true;
  /** 随机 IV（base64） */
  iv: string;
 /** AES-GCM 密文（base64） */
  ct: string;
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let keyPromise: Promise<CryptoKey> | null = null;

/** 取（或首次生成并落库）AES-GCM 非可提取密钥
 * #61：进程内 keyPromise 仅用于并发去重——同一 tick 内多调用共享同一个 async 操作；
 * 操作落定后立即清掉缓存，下次调用会重新读 IndexedDB。
 * 这样既保留了「并发单飞」语义，又能检测到 IndexedDB 中密钥被外部清掉的情况：
 * 清掉后再调用 getKey 会读到无 key → 重新生成一把新 key 落库，
 * 调用方拿到的密文与新 key 配套（旧密文 decryptValue 会静默返回 null 走默认值）。 */
function getKey(): Promise<CryptoKey> {
  if (keyPromise) return keyPromise;
  const p = (async () => {
    const rec = (await localDB.get('settings', 'cryptoKey')) as AppSettingRecord | undefined;
    if (rec && rec.value instanceof CryptoKey) return rec.value;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await localDB.put('settings', { key: 'cryptoKey', value: key });
    return key;
  })();
  keyPromise = p;
  // 落定后清掉缓存，下次调用重新读 IndexedDB——若密钥被外部清掉，会重新生成。
  void p.then(
    () => { if (keyPromise === p) keyPromise = null; },
    () => { if (keyPromise === p) keyPromise = null; },
  );
  return p;
}

function isEnvelope(v: unknown): v is EncEnvelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as EncEnvelope).__enc === true &&
    typeof (v as EncEnvelope).iv === 'string' &&
    typeof (v as EncEnvelope).ct === 'string'
  );
}

/** 加密任意 JSON 值为落盘信封 */
export async function encryptValue(value: unknown): Promise<EncEnvelope> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);
  return { __enc: true, iv: toB64(iv), ct: toB64(ct) };
}

/** 解密落盘信封；入参不是信封（旧明文）时原样返回 null 表示「非密文」 */
export async function decryptValue<T>(v: unknown): Promise<T | null> {
  if (!isEnvelope(v)) return null;
  try {
    const key = await getKey();
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(v.iv) },
      key,
      fromB64(v.ct)
    );
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    // 密钥丢失/密文损坏：返回 null，上层回退默认值（用户重新配置即可）
    return null;
  }
}
