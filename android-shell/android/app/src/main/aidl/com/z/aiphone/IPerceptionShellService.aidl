// Shizuku UserService：本服务代码将跑在 Shizuku 服务进程（shell/root 权限）里。
// 用于「时长数据源 · Shizuku 引擎」与「Shizuku 能力实验室」：执行 shell 命令读系统账本/操作手机。
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

    /**
     * v3 新增：静默截屏（能力实验室「让 AI 看见」）。
     * 服务端完成 screencap → 降采样(宽≤720) → JPEG → base64 dataURL，
     * 整个字符串控制在约 800K 字符内（Binder 1MB 事务上限之下）。
     * FLAG_SECURE 页面/失败返回空串。
     */
    String shScreencap(long timeoutMs);
}
