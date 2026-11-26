/**
 * 账号系统引导脚本（一次性冷启动解死锁）：
 *
 * 问题：管理员还没注册时，没人能生成邀请码；SMTP 授权码未填时邮箱注册也走不通
 *       ——鸡生蛋死锁。
 * 方案：系统中没有任何管理员且没有任何可用邀请码时，生成一个随机引导邀请码
 *       （单次使用）。机主用它注册 → 自动成为超级管理员（register/invite 路由的
 *       引导规则：系统无管理员时首个注册账号即管理员）。
 *
 * 运行：bun scripts/auth-bootstrap.mjs（bun 自动读取 .env 的 DATABASE_URL）
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const seg = () =>
  Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');

async function main() {
  const hasAdmin = await db.authUser.findFirst({ where: { role: 'admin' } });
  if (hasAdmin) {
    console.log('SKIP：系统中已有管理员（' + (hasAdmin.email ?? hasAdmin.name ?? hasAdmin.id) + '），无需引导。');
    return;
  }
  const unused = await db.inviteCode.findFirst({ where: { used: false } });
  if (unused) {
    console.log('已有可用引导邀请码（未使用，可直接注册成为首个管理员）：');
    console.log(unused.code);
    return;
  }
  let code = `COVE-${seg()}-${seg()}`;
  for (let i = 0; i < 5; i++) {
    const exists = await db.inviteCode.findUnique({ where: { code } });
    if (!exists) break;
    code = `COVE-${seg()}-${seg()}`;
  }
  await db.inviteCode.create({ data: { code } });
  console.log('BOOTSTRAP_INVITE_CODE=' + code);
}

main()
  .catch((e) => {
    console.error('引导脚本失败：', e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
