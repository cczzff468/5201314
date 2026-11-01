'use client';

/**
 * X论坛 · 文字图片渲染（发布弹层与 AI 生成帖子共用）。
 *
 * 观感取自用户参考图（纯白底、中灰 #999997 小字居中、大量留白），
 * v9 按用户要求移除了原先的「iMessage HH:mm」时间戳行——成品只有
 * 正文本身，整块在画布上垂直居中。
 *
 * v32 按用户要求调参：「图片里面的文字大一点，图片小一点」——
 * 画布 1080→720（输出体积减 44%），字号 28→40，行距 53→74，
 * 单行宽 960→640：文字/画布比从 2.6% 提到 5.6%（视觉翻 2.2 倍），
 * 同屏显示下文字明显变大；发布弹层与 AI 配图帖同步生效。
 *
 * 纯前端 canvas 直出 dataURL（PNG）：
 * - 发布弹层「文字图片」：用户输入一句话 → 生成白底居中文字图；
 * - AI 生成帖子按需配图（engine）：LLM 给出 image_description
 *   （以【视角】开头的画面描述，30~100 字），客户端同款渲染零成本上屏。
 */

export const TEXTIMG_MAX_LEN = 60;

/** 文字图片渲染：720×720 纯白底，#999997 正文 40px 居中（行距 74px），
 *  多行自动换行（每行宽 ≤640px），整块垂直居中；无任何时间戳/水印。 */
export function renderTextImage(text: string): string {
  const W = 720;
  const H = 720;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 不可用');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const fs = 40;
  const lh = 74;
  ctx.font = `400 ${fs}px system-ui, -apple-system, 'PingFang SC', 'Segoe UI', 'Noto Sans SC', sans-serif`;
  ctx.fillStyle = '#999997';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 自动换行（每行宽 ≤ 640px）
  const maxW = 640;
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
