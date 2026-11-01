'use client';

/**
 * X论坛 · 文字图片渲染（发布弹层与 AI 生成帖子共用）。
 *
 * 观感取自用户参考图（纯白底、中灰 #999997 小字居中、大量留白），
 * v9 按用户要求移除了原先的「iMessage HH:mm」时间戳行——成品只有
 * 正文本身，整块在 1080×1080 画布上垂直居中。
 *
 * 纯前端 canvas 直出 dataURL（PNG）：
 * - 发布弹层「文字图片」：用户输入一句话 → 生成白底居中文字图；
 * - AI 生成帖子按需配图（engine）：LLM 在生成帖子时按内容给出
 *   ≤40 字短句（金句/台词/心情独白），客户端同款渲染零成本上屏。
 */

export const TEXTIMG_MAX_LEN = 60;

/** 文字图片渲染：1080×1080 纯白底，#999997 正文 28px 居中（行距 53px），
 *  多行自动换行（每行宽 ≤960px），整块垂直居中；无任何时间戳/水印。 */
export function renderTextImage(text: string): string {
  const W = 1080;
  const H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 不可用');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const fs = 28;
  const lh = 53;
  ctx.font = `400 ${fs}px system-ui, -apple-system, 'PingFang SC', 'Segoe UI', 'Noto Sans SC', sans-serif`;
  ctx.fillStyle = '#999997';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 自动换行（每行宽 ≤ 960px）
  const maxW = 960;
  const lines: string[] = [];
  let cur = '';
  for (const ch of text.trim()) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  if (!lines.length) lines.push('');
  // 整块垂直居中（无时间戳行：正文块中心 = 画布中心）
  const n = lines.length;
  lines.forEach((ln, i) => {
    const cy = H / 2 + (i - (n - 1) / 2) * lh;
    ctx.fillText(ln, W / 2, cy);
  });
  return canvas.toDataURL('image/png');
}
