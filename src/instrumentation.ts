/**
 * Next.js instrumentation hook —— Next server 启动时执行（dev 模式同样生效）。
 *
 * 采用官方推荐的条件动态导入模式：
 *   NEXT_RUNTIME 是编译期常量，Turbopack 会据此裁剪分支，
 *   instrumentation-node.ts（内含 child_process）只进入 Node.js 产物，
 *   不会触发「node-module-in-edge-runtime」警告。
 *
 * 详见 ./instrumentation-node.ts 头部注释（守护链路说明）。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 动态导入后必须显式调用子模块的 register()——
    // 仅 import 只会加载模块定义而不会执行其中的守护逻辑（拉起 ncm-keeper）。
    const instrumentationNode = await import('./instrumentation-node');
    await instrumentationNode.register();
  }
}
