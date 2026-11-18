/**
 * 后台保活·准点敲钟 Worker（v80）：只负责每 3s 敲一声钟（postMessage 唤醒主线程），
 * 实际逻辑全在主线程（keepalive.ts 分发给注册的回调——主动消息 tick / 接力轮询等）。
 *
 * 为什么需要 Worker：主线程的 setTimeout/setInterval 在页面退后台后会被浏览器节流
 * （普通节流对齐 ~1s；Chrome 深度节流可压到 ~1 次/分钟），而 Dedicated Worker 线程里
 * 的 interval 不受普通节流影响，跨线程消息投递也不被节流——页面在后台时依然准点
 * 唤醒主线程（jealousy-scheduler.worker 同款思路，节拍加密到 3s 适配秒级轮询场景）。
 *
 * 注：self 在 Worker 上下文即 DedicatedWorkerGlobalScope——用 self.postMessage
 * 兜 TS 的 DOM lib（那里的全局 postMessage 挂在 window 上）。
 */

/** 敲钟间隔（秒级心跳：主动消息 tick 5s / 接力轮询 10s 的公约覆盖节拍）。
 *  命名带前缀：无 import/export 的 worker 文件按全局脚本参与类型检查，
 *  与 jealousy-scheduler.worker 的 TICK_MS 同名会 TS2451 撞车 */
const KEEPALIVE_TICK_MS = 3_000;

setInterval(() => {
  (self as unknown as { postMessage: (msg: string) => void }).postMessage('tick');
}, KEEPALIVE_TICK_MS);
