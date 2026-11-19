import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * QQ 官方扫码绑定 lite 接口代理（q.qq.com/lite/*）。
 *
 * 浏览器直连 q.qq.com 的 create_bind_task / poll_bind_result 被部分浏览器/网络的
 * CORS 策略拦截时（TypeError: Failed to fetch）走本代理兜底——服务端到服务端无 CORS
 * 限制；q.qq.com 对海外出口 IP 也放行（实测 200 + retcode:0），代理路径可靠。
 *
 * 安全：路径白名单（create_bind_task / poll_bind_result），转发 body 只透传
 * key / task_id 两个白名单字段，无 SSRF 面（固定 q.qq.com 域名）。
 */

const LITE_HOST = 'https://q.qq.com';
const LITE_PATHS = new Set(['/lite/create_bind_task', '/lite/poll_bind_result']);

interface QqBindRequest {
  path?: string;
  /** create_bind_task：base64 的 AES-256 key（客户端生成） */
  key?: string;
  /** poll_bind_result：创建任务返回的 task_id */
  task_id?: string;
}

export async function POST(req: NextRequest) {
  let p: QqBindRequest;
  try {
    p = (await req.json()) as QqBindRequest;
  } catch {
    return NextResponse.json({ retcode: -1, msg: 'invalid_json' }, { status: 400 });
  }
  const path = typeof p.path === 'string' ? p.path : '';
  if (!LITE_PATHS.has(path)) {
    return NextResponse.json({ retcode: -1, msg: 'bad_path' }, { status: 400 });
  }
  const body: Record<string, string> = {};
  if (path === '/lite/create_bind_task') {
    const key = typeof p.key === 'string' ? p.key : '';
    if (!/^[A-Za-z0-9+/=]{20,200}$/.test(key)) {
      return NextResponse.json({ retcode: -1, msg: 'bad_key' }, { status: 400 });
    }
    body.key = key;
  } else {
    const taskId = typeof p.task_id === 'string' ? p.task_id : '';
    if (!/^[\w-]{8,100}$/.test(taskId)) {
      return NextResponse.json({ retcode: -1, msg: 'bad_task_id' }, { status: 400 });
    }
    body.task_id = taskId;
  }
  try {
    const r = await fetch(`${LITE_HOST}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { 'Content-Type': r.headers.get('content-type') ?? 'application/json' },
    });
  } catch (e) {
    return NextResponse.json(
      { retcode: -1, msg: e instanceof Error ? `unreachable: ${e.message}` : 'unreachable' },
      { status: 502 },
    );
  }
}
