/**
 * 邮箱验证码落库与校验（需求第五节）：
 * - 6 位数字随机生成（node:crypto），库中只存 HMAC-SHA256 哈希（防库泄露被扫描撞码）；
 * - 10 分钟过期、单次使用即作废（used 标记）；
 * - 同邮箱同用途 60 秒内只发一次（防刷）；
 * - 校验：取该邮箱+用途最新一条未用记录，比对哈希与过期时间，成功立即标记作废。
 */

import { createHmac, randomInt } from 'node:crypto';
import { db } from '@/lib/db';

const CODE_TTL_MS = 10 * 60 * 1000;
const SEND_INTERVAL_MS = 60 * 1000;

const AUTH_SECRET = process.env.AUTH_SECRET || 'cove-dev-secret-fallback';

function hashCode(code: string): string {
  return createHmac('sha256', AUTH_SECRET).update(`cove-vc:${code}`).digest('hex');
}

export function generateCode(): string {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

export type CodePurpose = 'register' | 'login' | 'reset';

/** 生成并存入新验证码；60 秒内重复发送返回 null（路由层转「发送太频繁」提示） */
export async function createCode(email: string, purpose: CodePurpose): Promise<string> {
  const recent = await db.verificationCode.findFirst({
    where: { email, purpose, createdAt: { gt: new Date(Date.now() - SEND_INTERVAL_MS) } },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) return '';
  const code = generateCode();
  await db.verificationCode.create({
    data: {
      email,
      codeHash: hashCode(code),
      purpose,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return code;
}

/**
 * 校验验证码：成功（匹配且未用且未过期）立即作废并返回 true；
 * 失败原因不细分（防枚举探测），统一返回 false。
 */
export async function consumeCode(email: string, code: string, purpose: CodePurpose): Promise<boolean> {
  const record = await db.verificationCode.findFirst({
    where: { email, purpose, used: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) return false;
  if (record.expiresAt.getTime() < Date.now()) return false;
  if (record.codeHash !== hashCode(code)) return false;
  await db.verificationCode.update({ where: { id: record.id }, data: { used: true } });
  return true;
}

/** 邀请码生成：COVE-xxxx-xxxx（随机大小写字母+数字，需求第三节） */
const INVITE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateInviteCode(): string {
  const seg = () =>
    Array.from({ length: 4 }, () => INVITE_CHARS[Math.floor(Math.random() * INVITE_CHARS.length)]).join('');
  return `COVE-${seg()}-${seg()}`;
}

/** 批量生成邀请码（库内查重重试，冲突概率极低）；返回创建的明文码列表 */
export async function generateInviteCodes(count: number): Promise<string[]> {
  const created: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = generateInviteCode();
    for (let retry = 0; retry < 5; retry++) {
      const exists = await db.inviteCode.findUnique({ where: { code } });
      if (!exists) break;
      code = generateInviteCode();
    }
    await db.inviteCode.create({ data: { code } });
    created.push(code);
  }
  return created;
}
