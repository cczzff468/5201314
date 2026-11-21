'use client';

/**
 * secret-box —— API Key 等敏感字符串的 AES-GCM 加密落库（B1 任务）。
 *
 * 【密文格式】`enc:v1:<iv-b64>:<cipher-b64>`
 * - 三段式字符串（标准 base64 字母表不含冒号，可安全按 ':' 切分）：
 *   v1 = 算法版本号，将来换算法/轮换密钥时升 v2，旧格式靠前缀识别后迁移，互不干扰；
 *   iv = 12 字节随机 IV（每次加密独立生成，GCM 下 IV 绝不复用）；
 *   cipher-b64 = AES-GCM 密文（含 128bit 认证标签，篡改即解密失败）。
 * - 带 `enc:v1:` 前缀才解密，不带则原样返回——旧版明文数据天然兼容。
 *
 * 【密钥派生】PBKDF2(SHA-256, 120000 迭代) → AES-GCM-256
 * - 「设备种子」：首次使用时用 crypto.getRandomValues 生成 32 字节随机数，
 *   base64 后存 localStorage `ios-kv-seed`，此后固定不变（设备身份）。
 * - 盐与口令均来源于这枚种子：口令 = 种子原始 32 字节；盐 = SHA-256(种子 + 域分隔串) 前 16 字节。
 *   两者同源但域分隔（salt 混入字符串域），种子泄露即等于密钥泄露——与 secure-store
 *   的 IndexedDB 非可提取密钥属同一威胁模型：防的是「存储介质被整库拷走/备份泄露」时
 *   密文与密钥分离（种子在 localStorage、密文在 IndexedDB，两个库不一起丢）。
 * - 派生结果进程内缓存（keyCache），120000 迭代只算一次，之后加解密均为毫秒级。
 *
 * 【降级策略】全部 try-catch，绝不抛错、绝不让设置页崩：
 * - crypto.subtle / localStorage 不可用（极老 WebView、隐私模式）→ encryptSecret 原样
 *   返回明文（等价于旧版明文落盘的现状）、decryptSecret 原样返回输入——优雅退化为明文。
 * - 密文损坏 / 密钥对不上（如种子被清）→ decryptSecret 返回输入原样（上层 JSON.parse
 *   失败即视为「无配置」，用户重新填写即可，不白屏）。
 * - localStorage 不可用时种子退化为进程内存变量：本会话内加解密自洽，刷新后旧密文
 *   解不开 → 同「损坏」路径，安全降级。
 *
 * 【迁移说明】无专门迁移函数：
 * - 读取侧：store.ts 的 load() 兼容三种历史形态（enc:v1 密文串 / secure-store 密文信封
 *   对象 / 纯明文对象），统一解出到内存明文；
 * - 写入侧：任何一次状态写入（设置页保存、开关切换、load() 自愈回写）都走 encryptSecret
 *   落成 enc:v1 密文——旧数据「下次写入自然变密文」，无需批量迁移。
 */

/** localStorage 里设备种子的键名（任务指定） */
const SEED_LS_KEY = 'ios-kv-seed';
/** 密文版本前缀（任务指定格式） */
const ENC_PREFIX = 'enc:v1:';
/** PBKDF2 迭代次数（OWASP 2023 对 SHA-256 的建议值，设备上实测 <100ms） */
const PBKDF2_ITERATIONS = 120_000;
/** GCM 推荐 IV 长度：12 字节 */
const IV_BYTES = 12;
/** 种子长度：32 字节（256bit） */
const SEED_BYTES = 32;
/** 盐的域分隔串：让「盐」与「口令」虽然同源但派生域不同 */
const SALT_DOMAIN = 'ios-phone/secret-box/v1';

// ---------------- base64 辅助（种子与 IV/密文编码共用） ----------------

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

// ---------------- 设备种子 ----------------

/** 进程内存种子（localStorage 不可用时的会话级兜底） */
let memSeed: Uint8Array<ArrayBuffer> | null = null;

/** 取设备种子：首次生成 32 字节随机数存 localStorage `ios-kv-seed`，之后固定复用。
 *  任何失败（隐私模式/极老 WebView）返回 null，调用方降级为明文。 */
function getSeed(): Uint8Array<ArrayBuffer> | null {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    if (!memSeed) {
      const raw = window.localStorage.getItem(SEED_LS_KEY);
      if (raw) {
        const parsed = fromB64(raw);
        // 长度合法即视为有效种子（历史版本如扩过长度也兼容）
        if (parsed.length >= 16) {
          memSeed = parsed;
          return memSeed;
        }
      }
      // 首次：crypto.getRandomValues 生成 32 字节真随机
      const seed = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SEED_BYTES)));
      window.localStorage.setItem(SEED_LS_KEY, toB64(seed));
      memSeed = seed;
    }
    return memSeed;
  } catch {
    // localStorage 读写失败（隐私模式等）：退化为本次会话内存种子（可能为 null → 明文降级）
    if (!memSeed && typeof crypto !== 'undefined' && crypto.getRandomValues) {
      try {
        memSeed = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SEED_BYTES)));
      } catch {
        return null;
      }
    }
    return memSeed;
  }
}

// ---------------- 密钥派生与缓存 ----------------

/** 进程内密钥缓存：120000 轮 PBKDF2 每个会话只算一次 */
let keyCache: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> | null {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null; // WebCrypto 不可用
  const seed = getSeed();
  if (!seed) return null;
  if (!keyCache) {
    keyCache = deriveKey(seed).catch((err) => {
      keyCache = null; // 失败清缓存，下次调用重试派生
      throw err;
    });
  }
  return keyCache;
}

/** PBKDF2 派生 AES-GCM-256 密钥：
 *  口令 = 设备种子原始 32 字节；盐 = SHA-256(域分隔串 || 种子) 前 16 字节。 */
async function deriveKey(seed: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const domainBytes = new TextEncoder().encode(SALT_DOMAIN);
  const saltInput = new Uint8Array(new ArrayBuffer(domainBytes.length + seed.length));
  saltInput.set(domainBytes, 0);
  saltInput.set(seed, domainBytes.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', saltInput));
  const salt = digest.slice(0, 16);
  const material = await crypto.subtle.importKey('raw', seed, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // 非可提取：JS 拿不到派生密钥的原始字节
    ['encrypt', 'decrypt'],
  );
}

// ---------------- 导出接口 ----------------

/** 判断字符串是否为本模块密文（enc:v1: 前缀 + 两段结构） */
export function isEncrypted(s: unknown): boolean {
  if (typeof s !== 'string' || !s.startsWith(ENC_PREFIX)) return false;
  // 去掉 `enc:v1:` 前缀后按 ':' 切分，须恰好为 <iv-b64>:<cipher-b64> 两段且均非空
  const parts = s.slice(ENC_PREFIX.length).split(':');
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}

/** 加密敏感字符串 → `enc:v1:<iv>:<cipher>`。
 *  空串/已是密文/加密环境不可用 → 原样返回（幂等 + 降级）。 */
export async function encryptSecret(plain: string): Promise<string> {
  try {
    if (typeof plain !== 'string' || plain === '' || isEncrypted(plain)) return plain;
    const key = await getKey();
    if (!key) return plain; // 降级：WebCrypto/种子不可用 → 明文原样（等同旧现状）
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
    return `${ENC_PREFIX}${toB64(iv)}:${toB64(cipher)}`;
  } catch {
    return plain; // 降级：绝不抛错
  }
}

/** 解密密文字符串。输入不带 `enc:v1:` 前缀时原样返回——旧版明文与空串天然兼容；
 *  密文损坏/密钥不匹配时也原样返回（上层按「无配置」处理，不抛错不崩页）。 */
export async function decryptSecret(maybe: string): Promise<string> {
  try {
    if (!isEncrypted(maybe)) return maybe;
    const key = await getKey();
    if (!key) return maybe; // 降级：解密环境不可用 → 原样（调用方按解析失败兜底）
    const [ivB64, cipherB64] = maybe.slice(ENC_PREFIX.length).split(':');
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64) },
      key,
      fromB64(cipherB64),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return maybe; // 密文损坏/种子被清：原样返回，安全降级
  }
}
