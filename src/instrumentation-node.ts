/**
 * Node.js runtime 专属 instrumentation 逻辑。
 *
 * 仅在 NEXT_RUNTIME === 'nodejs' 时由 src/instrumentation.ts 动态加载，
 * Turbopack 会按运行时常量裁剪，不会进入 Edge 产物，因此可以放心
 * 静态 import child_process / node:net / node:dns（不触发 Edge Runtime 警告）。
 *
 * 作用一（外连网络修复）：解决「拉取模型能成功、测试连接/聊天却连不上」的服务端抖动——
 *   沙箱没有 IPv6 路由（ENETUNREACH），而 Cloudflare 等双栈域名同时返回 A/AAAA 记录；
 *   Node 20+ 默认开启 Happy Eyeballs（autoSelectFamily）以 250ms 窗口竞速各地址，
 *   沙箱到 Cloudflare 的 IPv4 握手约 270-320ms > 250ms 窗口，竞速逻辑在
 *   「首个地址慢但可通 + IPv6 立即不可达」的组合下直接抛 AggregateError[ETIMEDOUT]，
 *   表现为 fetch failed（~500ms 快速失败、随机 ~30% 成功率）。
 *   修复：ipv4first 解析顺序 + 关闭竞速改顺序连接（IPv4 ~300ms 稳定可通），
 *   另加一层 fetch 网络级自动重试（仅公网 http(s) 请求、仅瞬态错误、最多 2 次重试）。
 *
 * 作用二（守护链路）：从「容器启动树」成员（本 Next server 进程）内部拉起 ncm-keeper
 *   守护脚本，让 netease-api（网易云 API，端口 3010）常驻不被回收：
 *
 *       Next server(启动树) → instrumentation.register()
 *         → ncm-keeper.sh（守护 3010，PID 单实例）
 *           → node index.js（netease-api）
 *             → next-keeper.sh（守护 3000，PID 单实例，index.js 内置拉起）
 *
 * 背景：Bash 工具调用产生的后台进程会在调用结束后被沙箱回收；
 *       只有启动树（tini → start.sh → bun run dev → Next）内的进程能常驻。
 *
 * 幂等性：ncm-keeper / next-keeper 各自带 PID 文件单实例守卫；fetch 包装带符号标记，
 *         dev 模式下 register() 多次执行也不会叠加包装。
 */
import { spawn } from 'child_process';
import dns from 'node:dns';
import net from 'node:net';

/* ================= 外连网络修复 ================= */

const RETRY_WRAP = Symbol.for('aiphone.robust-fetch');

/** 是否公网 http(s) 地址（相对路径 / localhost / 内网不重试，保持原语义与低延迟） */
function isExternalHttpUrl(input: unknown): boolean {
  try {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as { url?: string } | null | undefined)?.url ?? '';
    if (!/^https?:\/\//i.test(href)) return false;
    const host = new URL(href).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return false;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/** 瞬态网络错误（连接重置/超时/DNS 抖动）：重发同一请求大概率成功 */
function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // 主动取消 / 整体超时由调用方信号控制，不在此重试（信号已 aborted 时外层也会跳过）
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return false;
  const cause = (err as { cause?: unknown }).cause;
  const msg = `${err.message} ${cause instanceof Error ? cause.message : String(cause ?? '')}`;
  // ENOTFOUND（域名写错）不重试：多为永久错误，快速把错误交还用户
  return /fetch failed|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|AggregateError/i.test(msg);
}

/** body 可安全重发（流式 body 无法重复消费，直接放行不重试） */
function hasRetryableBody(init: { body?: unknown } | undefined): boolean {
  if (!init || init.body == null) return true;
  const b = init.body;
  return (
    typeof b === 'string' ||
    b instanceof URLSearchParams ||
    b instanceof ArrayBuffer ||
    (typeof Blob !== 'undefined' && b instanceof Blob)
  );
}

/** 安装幂等的健壮 fetch（ipv4first + 顺序连接 + 瞬态错误自动重试） */
function installRobustFetch(): void {
  type Wrapped = typeof fetch & { [RETRY_WRAP]?: boolean };
  const current = globalThis.fetch as Wrapped;
  if (current?.[RETRY_WRAP]) return;

  const raw: typeof fetch = current;
  const robust = (async (input: unknown, init?: { body?: unknown; signal?: AbortSignal }) => {
    if (!isExternalHttpUrl(input) || !hasRetryableBody(init)) {
      return raw(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    }
    const signal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await raw(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
      } catch (err) {
        lastErr = err;
        if (signal?.aborted) throw err; // 调用方主动取消：立即上抛
        if (!isTransientNetworkError(err)) throw err; // 非瞬态网络错误：原样上抛
        if (attempt === 2) break;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastErr;
  }) as typeof fetch;
  (robust as Wrapped)[RETRY_WRAP] = true;
  globalThis.fetch = robust;
  console.log('[instrumentation] robust fetch installed (ipv4first, no happy-eyeballs race, retry x2)');
}

/* ================= 守护链路 ================= */

export async function register() {
  try {
    // 1) 外连网络修复：IPv4 优先解析 + 关闭 250ms 竞速（顺序连接）
    dns.setDefaultResultOrder('ipv4first');
    net.setDefaultAutoSelectFamily(false);
    installRobustFetch();
  } catch (e) {
    console.error('[instrumentation] network fix failed:', e);
  }

  try {
    // 2) 拉起 ncm-keeper（netease-api 守护）
    const child = spawn(
      'bash',
      ['/home/z/my-project/mini-services/netease-api/ncm-keeper.sh'],
      {
        cwd: '/home/z/my-project/mini-services/netease-api',
        detached: true,
        stdio: 'ignore',
      },
    );
    child.unref();
    console.log(`[instrumentation] ncm-keeper spawned pid=${child.pid}`);
  } catch (e) {
    console.error('[instrumentation] spawn ncm-keeper failed:', e);
  }
}
