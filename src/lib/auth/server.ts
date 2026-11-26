/**
 * 账号系统服务端核心：密码 scrypt 哈希、会话令牌（HMAC 签名 Cookie）、管理员白名单。
 *
 * 设计约束（需求第七节「强制安全规则」）：
 * - 密码加密存储、禁止明文 → scrypt(随机盐) 一次性哈希，格式 "salt:hash"（十六进制）
 * - 账号密码永久登录有效 → 密码登录令牌有效期 10 年（等效永久）
 * - 邮箱验证码临时登录 → 验证码登录令牌有效期 24 小时
 * - 令牌自包含（uid/类型/过期时间）+ HMAC-SHA256 防篡改，服务端无会话表，零额外存储
 * - 管理员白名单写死：ADMIN_QQ_EMAILS（逗号分隔）+ 引导规则（系统无管理员时
 *   第一个注册账号自动成为管理员，避免白名单未填时管理员被锁死在门外）
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

/** 会话 Cookie 名 */
export const SESSION_COOKIE = 'cove_session';

/** 密码登录令牌有效期：10 年（需求：账号密码永久有效） */
const PASSWORD_TOKEN_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;
/** 验证码登录令牌有效期：24 小时（需求：邮箱验证码临时登录） */
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** 签名密钥：env 优先（轮换即全员下线），缺失时回退固定值保证沙箱/自部署可用 */
const AUTH_SECRET = process.env.AUTH_SECRET || 'cove-dev-secret-fallback';

/** 管理员白名单：ADMIN_QQ_EMAILS 逗号分隔（trim + 转小写比较） */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.ADMIN_QQ_EMAILS || '';
  const list = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/** 会话令牌负载 */
interface TokenPayload {
  uid: string;
  /** 'password' 永久 | 'email' 临时（24h） */
  typ: 'password' | 'email';
  iat: number;
  exp: number;
}

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function sign(data: string): string {
  return createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
}

/** 签发会话令牌（HttpOnly Cookie 由路由层写入） */
export function issueToken(uid: string, typ: 'password' | 'email'): { token: string; maxAge: number } {
  const iat = Date.now();
  const ttl = typ === 'password' ? PASSWORD_TOKEN_TTL_MS : EMAIL_TOKEN_TTL_MS;
  const payload: TokenPayload = { uid, typ, iat, exp: iat + ttl };
  const body = b64url(JSON.stringify(payload));
  return { token: `${body}.${sign(body)}`, maxAge: Math.floor(ttl / 1000) };
}

/** 校验令牌签名与有效期；非法/过期返回 null */
export function verifyToken(token: string | undefined | null): TokenPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------- 密码 scrypt 哈希 ----------------

/** 哈希密码："salt:hash"（scrypt N=16384 默认参数，64 字节输出） */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/** 校验密码（哈希长度不匹配/解析失败一律 false，不抛错） */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const actual = scryptSync(password, salt, 64);
    const expect = Buffer.from(hash, 'hex');
    return actual.length === expect.length && timingSafeEqual(actual, expect);
  } catch {
    return false;
  }
}

// ---------------- 会话用户（读 Cookie → 校验 → 载入账号） ----------------

/** 会话用户（脱敏后的公共字段） */
export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
  role: 'user' | 'admin';
  status: 'pending' | 'approved';
  /** 登录方式：password 永久 | email 临时 */
  sessionTyp: 'password' | 'email';
}

/**
 * 从请求读会话用户：校验令牌 → 载入 AuthUser；
 * 白名单邮箱自动升为 admin+approved（管理员账号永久已通过，无需审核）。
 */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const payload = verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  const user = await db.authUser.findUnique({ where: { id: payload.uid } });
  if (!user) return null;
  let { role, status } = user;
  if (isAdminEmail(user.email)) {
    if (role !== 'admin' || status !== 'approved') {
      role = 'admin';
      status = 'approved';
      await db.authUser.update({ where: { id: user.id }, data: { role, status } });
    }
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: role === 'admin' ? 'admin' : 'user',
    status: status === 'approved' ? 'approved' : 'pending',
    sessionTyp: payload.typ,
  };
}

/** 管理员校验：供审核/邀请码接口调用，非管理员返回 null */
export async function getAdminUser(req: NextRequest): Promise<SessionUser | null> {
  const user = await getSessionUser(req);
  return user && user.role === 'admin' ? user : null;
}
