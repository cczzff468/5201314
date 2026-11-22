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
 * v33 按用户要求回调：「文字图片里面的文字小一点」——40px 偏大，
 * 字号 40→32（介于 28 与 40 之间），行距 74→60、单行宽 640→600
 * 等比收拢，文字/画布比 5.6%→4.4%：字变小、留白回来一点；
 * 发布弹层与 AI 配图帖同步生效（GEN_VERSION bump 重播种换新图）。
 *
 * v34 图卡尺寸统一（feed.tsx）：用户手发文字图与 AI 配图卡同为
 * w-3/4 方图不裁切（222px 卡片）；显示层变化，渲染参数未动。
 *
 * v35 按用户反馈「文字图片里面的文字为什么那么小」重做字号策略：
 * v33 的 32px 在 222px 卡片上有效字号仅 ~10px（比帖子配文 13px 还小），
 * 且 v34 统一尺寸后用户手发图从整行宽收窄到 75%，视觉再降一档。
 * 改为「自适应字号」：
 * - 基准字号 32→46（文字/画布比 4.4%→6.4%，卡片显示下有效字号
 *   ~10px→~14px，介于 v33(32) 与再上一档之间，不回到被否的 40 整行宽）；
 * - 短句（56px 下单行放得下，实测宽度）升到 56px——金句卡观感，
 *   短文字不再「一根细线漂在白海里」；
 * - 长文自适应降级：LLM 配图描述最长 120 字（engine 侧校验），46px×10行
 *   =840px 会溢出 720 画布——按「文字块高 ≤640px」逐级 -2px 降字号
 *   （下限 34px），120 字约降到 40px，永不溢出、不裁字；
 * - 行距 = 字号 × 1.83（46→84 / 56→102）。
 * 发布弹层与 AI 配图帖同步生效（GEN_VERSION bump 重播种换新图）。
 *
 * 纯前端 canvas 直出 dataURL（PNG）：
 * - 发布弹层「文字图片」：用户输入一句话 → 生成白底居中文字图；
 * - AI 生成帖子按需配图（engine）：LLM 给出 image_description
 *   （以【视角】开头的画面描述，30~100 字），客户端同款渲染零成本上屏。
 */

export const TEXTIMG_MAX_LEN = 60;

/** 文字图片渲染：720×720 纯白底，#999997 文字居中。
 *  v35 自适应字号：基准 46px；短句（56px 下仍单行）升 56px；
 *  长文按块高 ≤640px 逐级降字号（下限 34px，120 字约 40px）；
 *  行距 = 字号×1.83，多行自动换行（每行宽 ≤600px），整块垂直居中；
 *  无任何时间戳/水印。 */
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
  ctx.fillStyle = '#999997';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = 600;
  const body = text.trim();
  const fontOf = (size: number) =>
    `400 ${size}px system-ui, -apple-system, 'PingFang SC', 'Segoe UI', 'Noto Sans SC', sans-serif`;
  /** 按指定字号量宽换行（CJK/西文/emoji 均以 measureText 实测为准） */
  const wrapAt = (size: number): string[] => {
    ctx.font = fontOf(size);
    const ls: string[] = [];
    let cur = '';
    for (const ch of body) {
      if (ctx.measureText(cur + ch).width > maxW && cur) {
        ls.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    if (cur) ls.push(cur);
    return ls.length ? ls : [''];
  };
  // 基准 46px；短句在 56px 下仍是单行 → 升 56px（金句卡）
  let fs = 46;
  let lines = wrapAt(fs);
  if (lines.length === 1) {
    const big = wrapAt(56);
    if (big.length === 1) {
      fs = 56;
      lines = big;
    }
  }
  // 长文防溢出：文字块高 >640px（上下各留 ≥40px）逐级 -2px，下限 34px
  let lh = Math.round(fs * 1.83);
  while (lines.length * lh > 640 && fs > 34) {
    fs -= 2;
    lh = Math.round(fs * 1.83);
    lines = wrapAt(fs);
  }
  ctx.font = fontOf(fs);
  // 整块垂直居中（无时间戳行：正文块中心 = 画布中心）
  const n = lines.length;
  lines.forEach((ln, i) => {
    const cy = H / 2 + (i - (n - 1) / 2) * lh;
    ctx.fillText(ln, W / 2, cy);
  });
  return canvas.toDataURL('image/png');
}
