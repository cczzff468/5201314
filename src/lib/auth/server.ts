/**
 * 账号系统服务端核心：密码 scrypt 哈希、会话令牌（HMAC 签名 Cookie）、超级管理员写死。
 *
 * 角色三级（机主第 44 轮定夺）：
 * - super_admin 超级管理员：QQ 邮箱写死在代码（机主专属，自动建号、永久已通过、可设/撤管理员）
 * - admin 管理员：可审核用户、生成邀请码，但不能设管理员（只有超管能设）
 * - user 普通用户：邮箱注册需审核（pending），邀请码注册直接 approved
 *
 * 会话策略（机主第 44 轮修订）：
 * - 账号密码登录：永久（10 年）
 * - 邮箱验证码登录：同样是正式登录（永久 10 年）——不是临时会话；忘记密码时可直接凭验证码登录
 *
 * 安全约束：
 * - 密码 scrypt(随机盐) 一次性哈希，格式 "salt:hex"，禁止明文
 * - 令牌自包含（uid/类型/过期时间）+ HMAC-SHA256 防篡改，服务端无会话表
 * - 超管邮箱写死：任何人在任何时机都无法抢注/冒充（ensureSuperAdmin 先建号占位）
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

/** 会话 Cookie 名 */
export const SESSION_COOKIE = 'cove_session';

/** 登录令牌有效期：10 年（账号密码与邮箱验证码登录同为永久——机主第 44 轮定夺） */
const PASSWORD_TOKEN_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/** 签名密钥：env 优先（轮换即全员下线），缺失时回退固定值保证沙箱/自部署可用 */
const AUTH_SECRET = process.env.AUTH_SECRET || 'cove-dev-secret-fallback';

// ---------------- 超级管理员（机主·写死） ----------------

/** 机主 QQ 邮箱（写死：最高级管理员，永久已通过，只有此账号能设/撤管理员） */
export const SUPER_ADMIN_EMAIL = '3024996594@qq.com';
/** 机主用户名（登录账号） */
const SUPER_ADMIN_NAME = '20060620';
/** 机主密码（建号初始密码，可直接登录） */
const SUPER_ADMIN_PASSWORD = '123456';

/** 是否机主邮箱（超管判定唯一来源，写死不可配） */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.trim().toLowerCase() === SUPER_ADMIN_EMAIL);
}

/**
 * 确保超管账号存在且规格正确（写死邮箱占位 → 任何人无法抢注）：
 * - 不存在 → 直接建号（email/name/password/role=super_admin/status=approved，免审核直接通过）
 * - 存在但角色/状态/密码被改坏 → 强制归位（机主规格写死）
 * - 每进程只做一次重量级校正（scrypt 验密），之后轻量检查
 */
async function doEnsureSuperAdmin(): Promise<void> {
  const existing = await db.authUser.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
  if (!existing) {
    const nameTaken = await db.authUser.findFirst({ where: { name: SUPER_ADMIN_NAME } });
    await db.authUser.create({
      data: {
        email: SUPER_ADMIN_EMAIL,
        name: nameTaken ? null : SUPER_ADMIN_NAME,
        password: hashPassword(SUPER_ADMIN_PASSWORD),
        role: 'super_admin',
        status: 'approved',
      },
    });
    return;
  }
  const patch: { role?: string; status?: string; password?: string; name?: string | null } = {};
  if (existing.role !== 'super_admin') patch.role = 'super_admin';
  if (existing.status !== 'approved') patch.status = 'approved';
  if (!verifyPassword(SUPER_ADMIN_PASSWORD, existing.password)) patch.password = hashPassword(SUPER_ADMIN_PASSWORD);
  if (!existing.name) {
    const nameTaken = await db.authUser.findFirst({ where: { name: SUPER_ADMIN_NAME } });
    if (!nameTaken) patch.name = SUPER_ADMIN_NAME;
  }
  if (Object.keys(patch).length > 0) {
    await db.authUser.update({ where: { id: existing.id }, data: patch });
  }
}

/** ensure 结果缓存：同进程内「已确认无误」的账号不再重复跑 scrypt 验密 */
let ensureOkUid: string | null = null;

export async function ensureSuperAdmin(): Promise<void> {
  const existing = await db.authUser.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
  if (existing && ensureOkUid === existing.id) return;
  await doEnsureSuperAdmin();
  const fresh = await db.authUser.findUnique({ where: { email: SUPER_ADMIN_EMAIL } });
  if (fresh) ensureOkUid = fresh.id;
}

/** 管理员白名单（env 附加普通管理员，逗号分隔；超管邮箱独立写死不受此项影响） */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  if (isSuperAdminEmail(email)) return false; // 超管走独立判定
  const raw = process.env.ADMIN_QQ_EMAILS || '';
  const list = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

// ---------------- 会话令牌 ----------------

/** 会话令牌负载 */
interface TokenPayload {
  uid: string;
  /** 'password' 密码登录 | 'email' 验证码登录（两者同为永久会话） */
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
  role: 'user' | 'admin' | 'super_admin';
  status: 'pending' | 'approved';
  /** 登录方式：password 密码 | email 验证码（两者同为永久会话） */
  sessionTyp: 'password' | 'email';
}

/** 角色归一（未知值一律按 user 处理，防脏数据提权） */
export function normalizeRole(role: string): 'user' | 'admin' | 'super_admin' {
  if (role === 'super_admin') return 'super_admin';
  if (role === 'admin') return 'admin';
  return 'user';
}

/** DB 行 → 会话用户（各登录/注册路由共用） */
export function toSessionUser(
  user: { id: string; email: string | null; name: string | null; role: string; status: string },
  sessionTyp: 'password' | 'email',
): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: normalizeRole(user.role),
    status: user.status === 'approved' ? 'approved' : 'pending',
    sessionTyp,
  };
}

/**
 * 从请求读会话用户：先确保超管账号在位（防抢注/防丢号）→ 校验令牌 → 载入 AuthUser；
 * 超管邮箱强制归位 super_admin+approved；env 白名单邮箱自动升 admin+approved。
 */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  await ensureSuperAdmin();
  const payload = verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  const user = await db.authUser.findUnique({ where: { id: payload.uid } });
  if (!user) return null;
  let { role, status } = user;
  if (isSuperAdminEmail(user.email)) {
    if (role !== 'super_admin' || status !== 'approved') {
      role = 'super_admin';
      status = 'approved';
      await db.authUser.update({ where: { id: user.id }, data: { role, status } });
    }
  } else if (isAdminEmail(user.email) && (role !== 'admin' || status !== 'approved')) {
    role = 'admin';
    status = 'approved';
    await db.authUser.update({ where: { id: user.id }, data: { role, status } });
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: normalizeRole(role),
    status: status === 'approved' ? 'approved' : 'pending',
    sessionTyp: payload.typ,
  };
}

/** 管理员校验（admin 或 super_admin）：审核/邀请码接口用 */
export async function getAdminUser(req: NextRequest): Promise<SessionUser | null> {
  const user = await getSessionUser(req);
  return user && (user.role === 'admin' || user.role === 'super_admin') ? user : null;
}

/** 超级管理员校验：设/撤管理员接口专用（管理员不可以设管理员——机主定夺） */
export async function getSuperAdminUser(req: NextRequest): Promise<SessionUser | null> {
  const user = await getSessionUser(req);
  return user && user.role === 'super_admin' ? user : null;
}
