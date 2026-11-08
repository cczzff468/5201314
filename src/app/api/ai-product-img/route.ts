import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * AI 自创商品/菜品/店铺真图·服务端生成（v82 起「需配置」）：
 * - 调用方：客户端 ai-product-img.ts——「设置 › 图像生成」未配置任何模型时走这里；
 * - v82：内置 z-ai-web-dev-sdk 文生图兜底已移除——未配置生图模型时返回明确错误，
 *   客户端回退到本地插画占位（AI 自创内容不再自动获得写实真图）；
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

  return NextResponse.json(
    { error: '还没有配置生图模型：请到「设置 › 图像生成」填写（配置后 AI 自创内容可获得真实配图）' },
    { status: 502 }
  );
}
