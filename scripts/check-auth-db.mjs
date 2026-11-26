const { PrismaClient } = await import('./node_modules/@prisma/client/default.js').catch(() => import('@prisma/client'));
const db = new PrismaClient();
const users = await db.authUser.findMany();
console.log('AuthUser:', JSON.stringify(users.map(u => ({ email: u.email, name: u.name, role: u.role, status: u.status })), null, 2));
const codes = await db.verificationCode.findMany({ orderBy: { createdAt: 'desc' }, take: 8 });
console.log('VerificationCode:', JSON.stringify(codes.map(c => ({ email: c.email, purpose: c.purpose, used: c.used })), null, 2));
await db.$disconnect();
