package com.z.aiphone;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
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
 * v3（必须同步 bump UserServiceArgs.version）：
 *   - 新增 shScreencap：能力实验室「静默截屏」—— screencap 写临时文件 →
 *     服务端解码降采样（宽≤720）→ JPEG 循环压缩到 ≤ 800K 字符 → base64 dataURL。
 *     在服务端压缩是为了把体积压进 Binder 1MB 事务上限（原始 PNG 可达 1~3MB，
 *     base64 后必然超限，传输层根本回不来）。
 *
 * 注意：此类由 Shizuku 服务进程用本 APP 的 ClassLoader 加载执行 —— 不要引用
 * Android 生命周期相关的东西（Activity/Context 等均不可用）；BitmapFactory/
 * Base64/File 这类纯框架工具类没有问题。逻辑改动时必须同步 bump UserServiceArgs.version。
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

    // ================= v3：静默截屏（能力实验室） =================

    /** 截屏临时文件（shell 权限可写 /data/local/tmp；用完即删） */
    private static final String CAP_TMP = "/data/local/tmp/aiphone_cap.png";
    /** base64 dataURL 字符上限（Binder 1MB 事务上限之下留出包裹开销余量） */
    private static final int CAP_MAX_CHARS = 800_000;

    /**
     * 静默截屏：screencap -p 写临时文件 → BitmapFactory 解码 → 降采样到宽≤720 →
     * JPEG 循环降质压缩直至 base64 长度 ≤ 800K → "data:image/jpeg;base64,..."。
     * 失败（解码空/FLAG_SECURE 黑屏帧仍会成功返回黑图）/异常返回空串。
     */
    @Override
    public String shScreencap(long timeoutMs) {
        try {
            // execFiltered 兼任「带看门狗的进程执行器」：stdout 为空（写到文件了），
            // 进程退出后 readLine 返回 null、waitFor 立即返回
            execFiltered(new String[]{"screencap", "-p", CAP_TMP}, null, 0L, 4, timeoutMs);
            android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeFile(CAP_TMP);
            if (bmp == null || bmp.getWidth() <= 0) return "";
            android.graphics.Bitmap out = bmp;
            final int maxW = 720;
            if (bmp.getWidth() > maxW) {
                int h = Math.max(1, Math.round(bmp.getHeight() * (maxW / (float) bmp.getWidth())));
                out = android.graphics.Bitmap.createScaledBitmap(bmp, maxW, h, true);
            }
            try {
                int quality = 62;
                byte[] bytes = new byte[0];
                while (true) {
                    ByteArrayOutputStream bos = new ByteArrayOutputStream(64 * 1024);
                    out.compress(android.graphics.Bitmap.CompressFormat.JPEG, quality, bos);
                    bytes = bos.toByteArray();
                    // base64 膨胀 4/3：长度足够小或质量已到下限就收手
                    if ((bytes.length * 4L / 3L) + 32 <= CAP_MAX_CHARS || quality <= 18) break;
                    quality -= 14;
                }
                String b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
                if (b64.length() + 23 > CAP_MAX_CHARS) return ""; // 兜底：仍超限就不回传
                return "data:image/jpeg;base64," + b64;
            } finally {
                if (out != bmp) out.recycle();
            }
        } catch (Throwable ignored) {
            return "";
        } finally {
            try {
                new java.io.File(CAP_TMP).delete();
            } catch (Throwable ignored) {
            }
        }
    }
}
