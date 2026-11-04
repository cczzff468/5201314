import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * AI 自创商品/菜品/店铺真图·服务端兜底生成（第十四轮）：
 * - 调用方：客户端 ai-product-img.ts——「设置 › 图像生成」未配置任何模型时走这里，
 *   让 AI 自主创建的淘宝宝贝/美团菜品/店铺门头开箱即得写实真图（沙箱/未配置场景不缺图）；
 * - 内置 z-ai-web-dev-sdk 文生图（仅服务端），1024x1024，返回 { src: dataURL } 或 { error }；
 * - 用户配置了生图模型时客户端直走 /api/imggen 管线（用户自己的模型优先），不经过本路由。
 */
export async function POST(req: NextRequest) {
  let prompt = '';
  try {
    const body = (await req.json()) as { prompt?: unknown };
    prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  } catch {
    /* 解析失败按空处理 */
  }
  if (!prompt) return NextResponse.json({ error: '缺少生图提示词' }, { status: 400 });

  try {
    const zai = await ZAI.create();
    const res = await zai.images.generations.create({ prompt, size: '1024x1024' });
    const b64 = res.data?.[0]?.base64;
    if (!b64) return NextResponse.json({ error: '生图接口没有返回图片' }, { status: 502 });
    return NextResponse.json({ src: `data:image/png;base64,${b64}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '生图请求失败';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
