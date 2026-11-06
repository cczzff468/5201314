// Shizuku UserService：本服务代码将跑在 Shizuku 服务进程（shell/root 权限）里。
// 用于「时长数据源 · Shizuku 引擎」：执行 dumpsys usagestats -c 读系统使用账本。
package com.z.aiphone;

interface IPerceptionShellService {
    /**
     * 执行命令并按行过滤返回：
     * - 只保留「包含所有 mustContain token」的行；
     * - 行内含 time=<毫秒> token 且值小于 minTimeMs 的行丢弃（时间窗预过滤，
     *   控制 Binder 回传体积 —— 回传上限 maxLines 行 / 约 400K 字符）；
     * - timeoutMs 看门狗超时后销毁进程、返回已收集内容（尽力而为）。
     */
    String execFiltered(in String[] cmd, in String[] mustContain, long minTimeMs, int maxLines, long timeoutMs);
}
