/**
 * Node.js runtime 专属 instrumentation 逻辑。
 *
 * 仅在 NEXT_RUNTIME === 'nodejs' 时由 src/instrumentation.ts 动态加载，
 * Turbopack 会按运行时常量裁剪，不会进入 Edge 产物，因此可以放心
 * 静态 import child_process（不再触发 Edge Runtime 警告）。
 *
 * 作用：从「容器启动树」成员（本 Next server 进程）内部拉起 ncm-keeper 守护脚本，
 *       让 netease-api（网易云 API，端口 3010）常驻不被回收：
 *
 *       Next server(启动树) → instrumentation.register()
 *         → ncm-keeper.sh（守护 3010，PID 单实例）
 *           → node index.js（netease-api）
 *             → next-keeper.sh（守护 3000，PID 单实例，index.js 内置拉起）
 *
 * 背景：Bash 工具调用产生的后台进程会在调用结束后被沙箱回收；
 *       只有启动树（tini → start.sh → bun run dev → Next）内的进程能常驻。
 *
 * 幂等性：ncm-keeper / next-keeper 各自带 PID 文件单实例守卫，重复拉起自动退出。
 */
import { spawn } from 'child_process';

export async function register() {
  try {
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
