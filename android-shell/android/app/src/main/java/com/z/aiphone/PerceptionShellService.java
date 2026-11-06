package com.z.aiphone;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayDeque;

/**
 * Shizuku UserService 实现（跑在 Shizuku 服务进程，shell/root 权限）：
 * 执行 dumpsys usagestats -c 并在服务端做行级预过滤，把 Binder 回传体积压到今日事件规模。
 *
 * v2（ UserServiceArgs.version 必须 bump 才会重新加载本类）：
 *   - 超过行数/字符上限时改为「保留最新的事件」——事件按时间顺序输出，
 *     旧的截头策略会把晚间/最近的使用记录丢掉，导致时长统计莫名偏小；
 *   - 时间过滤（minTimeMs）不变：窗口外的旧行依旧直接丢弃，不占环形缓冲。
 *
 * 注意：此类由 Shizuku 服务进程用本 APP 的 ClassLoader 加载执行 —— 不要引用
 * Android 生命周期相关的东西；逻辑改动时必须同步 bump UserServiceArgs.version。
 */
public class PerceptionShellService extends IPerceptionShellService.Stub {

    /** 回传字符串硬上限（字符数；Parcel 走 modified UTF-8，安全低于 Binder 1MB 事务上限） */
    private static final int MAX_OUTPUT_CHARS = 400_000;

    @Override
    public String execFiltered(String[] cmd, String[] mustContain, long minTimeMs, int maxLines, long timeoutMs) {
        if (cmd == null || cmd.length == 0) return "";
        StringBuilder sb = new StringBuilder();
        Process p = null;
        Thread watchdog = null;
        try {
            p = Runtime.getRuntime().exec(cmd);
            final Process proc = p;
            watchdog = new Thread(() -> {
                try {
                    Thread.sleep(Math.max(1000L, timeoutMs));
                    proc.destroy();
                } catch (Throwable ignored) {
                }
            }, "shell-watchdog");
            watchdog.setDaemon(true);
            watchdog.start();

            // 环形缓冲：行数/字符超限时从头（=最旧）淘汰，保住最新事件
            ArrayDeque<String> keptLines = new ArrayDeque<>();
            long keptChars = 0;
            try (BufferedReader r = new BufferedReader(new InputStreamReader(proc.getInputStream()), 1 << 16)) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (mustContain != null && mustContain.length > 0) {
                        boolean hasAll = true;
                        for (String tok : mustContain) {
                            if (tok != null && tok.length() > 0 && !line.contains(tok)) {
                                hasAll = false;
                                break;
                            }
                        }
                        if (!hasAll) continue;
                    }
                    if (minTimeMs > 0) {
                        long ts = extractTimeToken(line);
                        if (ts >= 0 && ts < minTimeMs) continue; // 时间窗外的旧行直接丢
                    }
                    keptLines.addLast(line);
                    keptChars += line.length() + 1;
                    while (keptLines.size() > Math.max(1, maxLines) || keptChars > MAX_OUTPUT_CHARS) {
                        String dropped = keptLines.pollFirst();
                        if (dropped == null) break;
                        keptChars -= dropped.length() + 1;
                    }
                }
            }
            for (String l : keptLines) {
                sb.append(l).append('\n');
            }
            try {
                proc.waitFor();
            } catch (InterruptedException ignored) {
            }
        } catch (Throwable ignored) {
            // 尽力而为：返回已收集内容（进程启动失败等场景为空串）
        } finally {
            if (watchdog != null) {
                watchdog.interrupt();
            }
            if (p != null) {
                try {
                    p.destroy();
                } catch (Throwable ignored) {
                }
            }
        }
        return sb.toString();
    }

    /** 抽取行内「time=<数字>」token 的毫秒值（没有/非法返回 -1） */
    private static long extractTimeToken(String line) {
        if (line == null) return -1;
        int i = line.indexOf("time=");
        if (i < 0) return -1;
        int s = i + 5;
        int e = s;
        int len = line.length();
        while (e < len && Character.isDigit(line.charAt(e))) e++;
        if (e == s) return -1;
        try {
            return Long.parseLong(line.substring(s, e));
        } catch (NumberFormatException ex) {
            return -1;
        }
    }
}
