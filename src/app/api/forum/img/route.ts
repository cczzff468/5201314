import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * X论坛 · 帖子配图生成（引擎自动配图用）。
 * body: { query: string } → { src: dataURL }
 *
 * 内置 z-ai-web-dev-sdk 文生图（仅服务端）：帖子配图要的是「网友随手拍」的
 * 真实感照片，提示词统一追加手机随拍风格；1024x1024（时间线 16:9 裁切展示）。
 * 与 /api/ai-product-img 同管线（返回 { src: dataURL }）。
 */
export async function POST(req: NextRequest) {
  let query = '';
  try {
    const body = (await req.json()) as { query?: unknown };
    query = typeof body.query === 'string' ? body.query.trim().slice(0, 120) : '';
  } catch {
    /* 解析失败按空处理 */
  }
  if (!query) return NextResponse.json({ error: '缺少配图描述' }, { status: 400 });

  try {
    const zai = await ZAI.create();
    const res = await zai.images.generations.create({
      prompt: `${query}，手机随拍照片风格，自然真实，生活感，不要文字水印`,
      size: '1024x1024',
    });
    const b64 = res.data?.[0]?.base64;
    if (!b64) return NextResponse.json({ error: '生图接口没有返回图片' }, { status: 502 });
    return NextResponse.json({ src: `data:image/png;base64,${b64}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '生图请求失败';
    console.error('[forum/img] generate failed:', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
