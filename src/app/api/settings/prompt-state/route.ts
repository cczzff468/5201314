import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 全局预设管理器 · 服务端状态同步（v63）。
 *
 * POST：客户端把 prompt-entries 状态（开关/编辑/深度/自定义条目）同步进服务端内存缓存
 *       ——phone / memory / moments / forum 等在服务端组装提示词的路由，
 *       下一次请求即可读到用户设置（「实时生效」）。
 * GET ：读取当前缓存（调试/验证用）。
 *
 * 状态本体存客户端 IndexedDB（kv: prompt-entries:state）；本路由只做内存镜像，
 * 单用户沙箱环境无并发问题。服务端重启/热更后缓存丢失 → 客户端 45s 周期重同步补齐。
 */

import { getServerPromptEntryState, setServerPromptEntryState } from '@/lib/prompt-entries';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  setServerPromptEntryState(body);
  return NextResponse.json({ ok: true, rev: getServerPromptEntryState()?.rev ?? 0 });
}

export async function GET() {
  const st = getServerPromptEntryState();
  return NextResponse.json({
    synced: !!st,
    rev: st?.rev ?? 0,
    disabled: st?.disabled.length ?? 0,
    edits: Object.keys(st?.edits ?? {}).length,
    custom: st?.custom.length ?? 0,
  });
}
