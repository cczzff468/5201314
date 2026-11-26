/**
 * QQ 邮箱 SMTP 验证码发信（需求第六节）：
 * - 服务器 smtp.qq.com:465 SSL，写死在代码；
 * - 发件账号/授权码从环境变量读取（QQ_SMTP_USER / QQ_SMTP_AUTH_CODE），机主后续自行填入；
 * - 未配置时抛出友好错误（前端提示改用邀请码注册），不静默吞错；
 * - 邮件话术「复杂化、不使用直白明文验证话术」：验证码以「星尘序列」形式分组呈现
 *   （数字间夹圆点），并混入无关叙述——邮件扫描器难以直接抓出"验证码是 xxx"。
 */

import nodemailer from 'nodemailer';

const SMTP_HOST = 'smtp.qq.com';
const SMTP_PORT = 465;

/** 是否已配置发信账号（两个变量都非空才算配置完成） */
export function isSmtpConfigured(): boolean {
  return Boolean(process.env.QQ_SMTP_USER && process.env.QQ_SMTP_AUTH_CODE);
}

let cached: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true, // 465 SSL
    auth: {
      user: process.env.QQ_SMTP_USER as string,
      pass: process.env.QQ_SMTP_AUTH_CODE as string,
    },
  });
  return cached;
}

/**
 * 发送 6 位数字验证码邮件（10 分钟内有效）。
 * 授权码未配置时抛 Error（message 会被前端 toast 直接展示）。
 * purpose：register 注册 | login 验证码登录 | reset 忘记密码重置
 */
export async function sendVerifyCodeEmail(
  email: string,
  code: string,
  purpose: 'register' | 'login' | 'reset',
): Promise<void> {
  if (!isSmtpConfigured()) {
    throw new Error('验证码邮件服务尚未配置（管理员未填入QQ邮箱授权码），请暂时使用邀请码注册或账号密码登录');
  }
  // 星尘序列：数字间夹圆点 + 前后无"验证码"字样，避免被邮件明文扫描直接提取
  const spaced = code.split('').join('·');
  const subject =
    purpose === 'register'
      ? '【Cove 星际通讯】入舰坐标校准信'
      : purpose === 'reset'
        ? '【Cove 星际通讯】密钥重铸信'
        : '【Cove 星际通讯】身份确认信';
  const actionText =
    purpose === 'register'
      ? '为确保这是你本人，请将下方的星尘校准序列转为数字后，在 10 分钟内输入到 Cove 端口。'
      : purpose === 'reset'
        ? '你申请重铸舱门密钥。请将下方的星尘校准序列转为数字后，在 10 分钟内输入到 Cove 端口。重铸成功后旧密钥将立即作废。'
        : '为确保这是你本人，请将下方的星尘校准序列转为数字后，在 10 分钟内输入到 Cove 端口。';
  const text = [
    '你好，星际旅行者：',
    '',
    'Cove 星港刚刚记录到一次与你有关的操作请求。',
    actionText,
    '',
    `星尘序列：${spaced}`,
    '',
    '（去掉圆点，按顺序组合即可；超时后该序列将自动湮灭，需要重新获取）',
    '如果这不是你的操作，请忽略这封信，你的舱门不会被打开。',
    '',
    '—— Cove 星港自动信使',
  ].join('\n');

  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Cove 星港" <${process.env.QQ_SMTP_USER}>`,
    to: email,
    subject,
    text,
  });
}

/**
 * 发验证码（自动适配 SMTP 配置状态）：
 * - 已配置授权码 → 真实发信，返回 { dev: false }
 * - 未配置 → 不发信、返回 { dev: true }，由路由层把验证码直接回显给前端（开发模式），
 *   机主填入 QQ_SMTP_AUTH_CODE 后自动切换为真实邮件发送，无需改代码。
 */
export async function sendCodeOrDev(
  email: string,
  code: string,
  purpose: 'register' | 'login' | 'reset',
): Promise<{ dev: boolean }> {
  if (!isSmtpConfigured()) {
    console.log(`[auth] SMTP 未配置（开发回显模式）→ ${email} ${purpose} 验证码：${code}`);
    return { dev: true };
  }
  await sendVerifyCodeEmail(email, code, purpose);
  return { dev: false };
}
