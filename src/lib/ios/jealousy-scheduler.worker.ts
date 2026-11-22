/**
 * 吃醋/查岗·后台准点调度器（v1.9.43，Web Worker）。
 *
 * 为什么需要 Worker：主线程的 setTimeout/setInterval 在页面退后台后被浏览器
 * 节流（普通节流对齐到 ~1s；Chrome 深度节流可压到 ~1 次/分钟）。把节拍器搬进
 * Dedicated Worker 后不受普通节流影响，页面在后台时依然准点唤醒主线程跑
 * runJealousyTick（倒计时到点解锁/暗中观察/强解检测第一时间执行）。
 *
 * 职责极简：只负责「准点敲钟」（每 30s 发一声 tick），所有实际逻辑仍在主线程执行
 * （jealousy-lock 的 tick 内部要访问 window/localStorage/IndexedDB，Worker 里没有）。
 * 这与需求⑥「定时任务放原生前台服务或 Web Worker」的双通道设计互补：真机模式另有
 * 原生 JealousyGuardService 前台服务兜底（WebView 被杀也活），Worker 只兜
 * 「WebView 活着但被节流」的场景。
 *
 * 注：self 在 Worker 上下文即 DedicatedWorkerGlobalScope——用 self.postMessage
 * 兜 TS 的 DOM lib（那里的全局 postMessage 挂在 window 上）。
 */

/** 敲钟间隔（与 JealousyWatcher 主循环节拍一致：30s 一轮） */
const TICK_MS = 30_000;

setInterval(() => {
  (self as unknown as { postMessage: (msg: string) => void }).postMessage('tick');
}, TICK_MS);
