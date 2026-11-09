package com.z.aiphone;

import android.app.Activity;
import android.app.AppOpsManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.Process;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import rikka.shizuku.Shizuku;

/**
 * 原生感知插件（网页 window.Capacitor.Plugins.NativePerception）：
 *
 * ① UsageStats 真机感知（时长数据源双引擎，v1.2.1）：
 *    - getUsageSnapshot({source})：
 *      · source=standard（默认）：UsageStatsManager.queryEvents 事件流配对
 *        （RESUMED→PAUSED）；v1.2.1 口径修正：息屏（SCREEN_NON_INTERACTIVE 16）/
 *        锁屏（KEYGUARD_SHOWN 17）/关机（26）立即结算当前会话——否则安卓账本里
 *        前台 App 息屏后一直「挂着 RESUMED」，整晚睡眠时间会被算成使用时长；
 *        解锁（KEYGUARD_HIDDEN 18）后若仍停留在锁屏前那个 App，自动续计同一会话
 *        （系统对同一 Activity 不会补发 RESUMED）；其余同 v1.2：查询窗口带 2h 回看、
 *        时长按「今日」裁剪、桌面 Launcher 不计入、3s 内同 App 页面切换不重复计打开；
 *      · source=shizuku：经 Shizuku 以 shell 权限执行 dumpsys usagestats -c，
 *        解析系统事件账本 → 同一套配对聚合（免「使用情况」授权、不受锁屏查询限制）；
 *        Shizuku 未运行/未授权/超时失败时自动降级 standard 并以 engineNote 标注；
 *    - 网页端另一引擎 Cap-go（@capgo/capacitor-android-usagestatsmanager，插件
 *      CapacitorUsageStatsManager）由 JS 侧调用，本插件为其提供能力底座（权限同源）。
 *
 * ② 媒体感知（正在听什么歌）：NotificationListenerService（MediaListenerService）
 *    - hasMediaPermission / openMediaPermissionSettings / getNowPlaying；
 *
 * ③ 屏幕抓帧：requestScreenCapture（MediaProjection 授权）→ ScreenCaptureService
 *    前台服务建流 → grabScreenFrame（dataURL）→ stopScreenCapture。
 *
 * ④ Shizuku 状态：shizukuStatus（binder 活性/授权/版本）+ requestShizukuPermission
 *    （拉起 Shizuku 授权页，结果经监听器回传）。
 *
 * ⑤ Shizuku 能力实验室（v1.3）：
 *    - shizukuExec({cmd, mustContain?, maxLines?, timeoutMs?})：通用 shell 命令执行，
 *      argv[0] 必须命中白名单（默认拒绝 rm/dd/reboot/mount 等一切危险二进制）；
 *      网页侧在此基础上拼出全部能力（点按/滑动/输入/按键/打开App/强杀/冻结/
 *      安装卸载/媒体音量/网络开关/通知快照/前台App/电量/剪贴板/短信/通话/logcat/
 *      自授权……），加能力只改网页、不用重新打包 APK；
 *    - shizukuScreencap()：静默截屏（服务端降采样 JPEG base64，免 MediaProjection 授权弹窗）。
 *
 * ⑥ Mobile Agent（v1.5）：Agent 动作执行底座（网页侧 Agent 运行时全部经本组方法操作手机）：
 *    - executeShell({cmd, timeoutMs?})：白名单 shell 执行（与 shizukuExec 同内核
 *      runWhitelistedShell，无行过滤、maxLines 4000、默认 15s / 硬顶 30s）；
 *    - getScreenResolution()：wm size 解析屏幕分辨率（Override 优先 / Physical 兜底），
 *      网页侧滑动坐标换算用；
 *    - dumpUi()：uiautomator dump --compressed 落盘 → cat 取控件树 XML 全文回传
 *      （dump 失败等 900ms 自动重试一次），网页侧解析控件树做「看屏幕」；
 *    - inputChinese({text})：中文/emoji 输入 —— 纯 ASCII 直接 input text（空格转 %s）；
 *      含非 ASCII 自动 ime enable+set 切到本应用无 UI 输入法（AdbImeService，
 *      见 AdbImeService.java）后经广播 commitText 注入（原生支持中文/emoji）；
 *      不在方法内恢复原输入法（Agent 多步输入只切一次，任务结束由前端调 restoreIme）；
 *    - restoreIme({imeId})：恢复任务前的原输入法；
 *    - agentShouldStop() / agentResetStop()：紧急停止标志（static volatile，
 *      通知栏「■ 紧急停止」按钮置位、网页每步动作前轮询）；
 *    - agentNotify({title, text?}) / agentNotifyEnd()：执行期常驻状态通知
 *      （id 7788，渠道 agent_runner，IMPORTANCE_LOW 静默），带紧急停止按钮。
 */
@CapacitorPlugin(name = "NativePerception")
public class NativePerceptionPlugin extends Plugin {

    private static final int REQ_SCREEN_CAPTURE = 2;
    private static final int REQ_SHIZUKU_PERMISSION = 7;

    /** 跨零点会话回看窗口：事件查询从「今日 0 点 - 2h」起，聚合时按今日裁剪 */
    private static final long SESSION_LOOKBACK_MS = 2 * 3600_000L;
    /** 同 App 内部 Activity 切换判定阈值：PAUSED→RESUMED 间隔小于此值视为同一次使用 */
    private static final long INTRA_APP_GAP_MS = 3000L;
    /** Shizuku dumpsys 看门狗超时 */
    private static final long SHIZUKU_DUMP_TIMEOUT_MS = 8000L;
    /** dumpsys 解析保留的事件上限（防异常巨大输出） */
    private static final int DUMP_EVENT_LIMIT = 60_000;

    /** shizukuExec 允许执行的二进制白名单（argv[0]，默认拒绝一切其余命令：
     *  rm/dd/reboot/mount/kill/sh 等均不在名单内；Runtime.exec 数组参数不经 shell，
     *  不存在拼接注入间道，白名单首元即足够拦截） */
    private static final Set<String> SHIZUKU_ALLOWED_BINARIES = new HashSet<>(Arrays.asList(
            "input",      // 点按/滑动/打字/按键
            "am",         // 打开App/强杀
            "pm",         // 冻结/解冻/安装/卸载/包列表
            "monkey",     // 按包名拉起 App（免 Activity 名）
            "svc",        // wifi/流量/蓝牙开关
            "media",      // 媒体按键/音量
            "dumpsys",    // 通知/前台App/媒体会话/电量/剪贴板等只读快照
            "cmd",        // appops 自授权 / notification allow_listener
            "settings",   // 系统设置读写（实验室谨慎用）
            "content",    // 短信/通话记录/日历 provider 查询
            "logcat",     // 系统日志（排查真机 bug）
            "screencap",  // 截屏（配合 shScreencap）
            "wm",         // 屏幕尺寸（滑动坐标计算用）
            "cat",        // 读文件（仅限 shell 可读路径）
            "uiautomator",// 控件树倾倒（Agent「看屏幕」：dump --compressed 落盘后 cat 读取）
            "ime"         // 输入法管理（Agent 中文输入：ime enable/set 切换无 UI 输入法）
    ));

    private PluginCall pendingCaptureCall;

    // ================= 事件模型（双引擎共用聚合口径） =================

    /* 事件类型（归一化后）：
     *   1 = 前台（ACTIVITY_RESUMED / MOVE_TO_FOREGROUND）
     *   2 = 失焦（ACTIVITY_PAUSED / ACTIVITY_STOPPED，即 MOVE_TO_BACKGROUND）
     *   3 = 息屏（SCREEN_NON_INTERACTIVE 16）
     *   4 = 亮屏（SCREEN_INTERACTIVE 15）
     *   5 = 锁屏显示（KEYGUARD_SHOWN 17）
     *   6 = 锁屏解除/解锁（KEYGUARD_HIDDEN 18）
     *   7 = 关机（DEVICE_SHUTDOWN 26）
     *   8 = 开机（DEVICE_STARTUP 27）
     * 3~8 为「门控事件」：pkg 可能为空（系统事件无归属包）。 */
    private static final class Ev {
        static final int T_RESUMED = 1;
        static final int T_CLOSED = 2;
        static final int T_SCREEN_OFF = 3;
        static final int T_SCREEN_ON = 4;
        static final int T_KEYGUARD_SHOWN = 5;
        static final int T_KEYGUARD_HIDDEN = 6;
        static final int T_SHUTDOWN = 7;
        static final int T_BOOT = 8;

        final long ts;
        final int type;
        final String pkg; // 门控事件可为 null

        Ev(long ts, int type, String pkg) {
            this.ts = ts;
            this.type = type;
            this.pkg = pkg;
        }
    }

    // ================= UsageStats（真机感知 · 双引擎） =================

    @PluginMethod
    public void hasUsagePermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", checkUsagePermission());
        ret.put("supported", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void openUsagePermissionSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开系统设置：" + e.getMessage());
        }
    }

    /**
     * 今日前台会话聚合（v1.2 双引擎）：
     *
     * 事件级配对计时（RESUMED→PAUSED），息屏/锁屏/切走即停止计时；
     * 桌面 Launcher 只用于结算上一会话，自身时长不计入（数字健康口径）；
     * 带回看窗口 + 按今日裁剪（跨零点长会话不丢、不串天）。
     */
    @PluginMethod
    public void getUsageSnapshot(PluginCall call) {
        String source = "standard";
        try {
            String s = call.getString("source", "standard");
            if (s != null) source = s;
        } catch (Throwable ignored) {
        }

        if ("shizuku".equals(source)) {
            // Shizuku 引擎：binder 活着 + 已授权才走 dumpsys，否则自动降级标准
            String note = null;
            if (!shizukuBinderAlive()) {
                note = "shizuku-not-running";
            } else if (!shizukuPermissionGranted()) {
                note = "shizuku-no-permission";
            }
            if (note != null) {
                resolveStandardSnapshot(call, note);
                return;
            }
            final long now = System.currentTimeMillis();
            final long startOfDay = startOfDay(now);
            final long from = startOfDay - SESSION_LOOKBACK_MS;
            new Thread(() -> {
                try {
                    List<Ev> evs = shizukuDumpEvents(from, now);
                    if (evs == null || evs.isEmpty()) {
                        resolveStandardSnapshot(call, "shizuku-empty");
                        return;
                    }
                    JSObject ret = buildSnapshot(evs, startOfDay, now);
                    ret.put("ok", true);
                    ret.put("engine", "shizuku");
                    call.resolve(ret);
                } catch (Throwable t) {
                    resolveStandardSnapshot(call, "shizuku-error");
                }
            }, "shizuku-usage").start();
            return;
        }

        // 标准引擎
        if (!checkUsagePermission()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("needPermission", true);
            call.resolve(ret);
            return;
        }
        resolveStandardSnapshot(call, null);
    }

    /** 标准引擎数据（UsageStatsManager.queryEvents；engineNote 非空表示从 Shizuku 降级而来） */
    private void resolveStandardSnapshot(PluginCall call, String engineNote) {
        if (!checkUsagePermission()) {
            // Shizuku 失效降级 + 「使用情况」也未授权：如实回报需要授权
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("needPermission", true);
            if (engineNote != null) ret.put("engineNote", engineNote);
            call.resolve(ret);
            return;
        }
        try {
            long now = System.currentTimeMillis();
            long startOfDay = startOfDay(now);
            List<Ev> evs = queryEventsList(startOfDay - SESSION_LOOKBACK_MS, now);
            JSObject ret = buildSnapshot(evs, startOfDay, now);
            ret.put("ok", true);
            ret.put("engine", "standard");
            if (engineNote != null) ret.put("engineNote", engineNote);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("查询使用情况失败：" + e.getMessage());
        }
    }

    /** 今日 0 点（本地时区） */
    private long startOfDay(long now) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(now);
        cal.set(Calendar.HOUR_OF_DAY, 0);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        return cal.getTimeInMillis();
    }

    /** UsageStatsManager 事件流 → Ev 列表（前台/失焦 + 息屏/锁屏/开关机门控事件） */
    private List<Ev> queryEventsList(long from, long to) {
        List<Ev> out = new ArrayList<>();
        android.app.usage.UsageStatsManager usm =
                (android.app.usage.UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
        android.app.usage.UsageEvents events = usm.queryEvents(from, to);
        android.app.usage.UsageEvents.Event ev = new android.app.usage.UsageEvents.Event();
        while (events.hasNextEvent()) {
            events.getNextEvent(ev);
            int type = ev.getEventType();
            int t;
            if (type == android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED) {          // 1
                t = Ev.T_RESUMED;
            } else if (type == android.app.usage.UsageEvents.Event.ACTIVITY_PAUSED       // 2
                    || type == android.app.usage.UsageEvents.Event.ACTIVITY_STOPPED) {    // 23
                t = Ev.T_CLOSED;
            } else if (type == android.app.usage.UsageEvents.Event.SCREEN_NON_INTERACTIVE // 16
                    || type == android.app.usage.UsageEvents.Event.KEYGUARD_SHOWN         // 17
                    || type == android.app.usage.UsageEvents.Event.DEVICE_SHUTDOWN) {     // 26
                t = (type == android.app.usage.UsageEvents.Event.KEYGUARD_SHOWN)
                        ? Ev.T_KEYGUARD_SHOWN
                        : (type == android.app.usage.UsageEvents.Event.DEVICE_SHUTDOWN)
                        ? Ev.T_SHUTDOWN : Ev.T_SCREEN_OFF;
            } else if (type == android.app.usage.UsageEvents.Event.SCREEN_INTERACTIVE     // 15
                    || type == android.app.usage.UsageEvents.Event.KEYGUARD_HIDDEN        // 18
                    || type == android.app.usage.UsageEvents.Event.DEVICE_STARTUP) {      // 27
                t = (type == android.app.usage.UsageEvents.Event.KEYGUARD_HIDDEN)
                        ? Ev.T_KEYGUARD_HIDDEN
                        : (type == android.app.usage.UsageEvents.Event.DEVICE_STARTUP)
                        ? Ev.T_BOOT : Ev.T_SCREEN_ON;
            } else {
                continue; // SHUTDOWN 之外其余系统事件（CONFIGURATION_CHANGE 等）无关
            }
            // 门控事件（息屏/锁屏等）无归属包，packageName 可能为 null，照样保留
            out.add(new Ev(ev.getTimeStamp(), t, ev.getPackageName()));
        }
        return out;
    }

    /**
     * 双引擎共用的会话聚合：产出与 v1.1 同构的快照（todayApps/current/recentApps/…），
     * 口径升级（v1.2.1）：回看裁剪 / Launcher 排除 / 同 App 内页面切换不重复计数 /
     * 息屏、锁屏、关机即停 + 解锁后自动续计原 App。
     */
    private JSObject buildSnapshot(List<Ev> evs, long startOfDay, long now) {
        final PackageManager pm = getContext().getPackageManager();
        final String launcherPkg = defaultLauncherPkg();

        final Map<String, Long> durationByApp = new HashMap<>();   // 前台总时长（今日裁剪后）
        final Map<String, Integer> opensByApp = new HashMap<>();   // 打开次数（App 级）
        final Map<String, Long> lastOpenByApp = new HashMap<>();   // 最近一次打开时间
        final List<Long> historyTs = new ArrayList<>();
        final List<String> historyPkgs = new ArrayList<>();

        String openApp = null;        // 当前打开中的会话
        long openStart = 0;
        String lastApp = null;        // 最后一个非桌面 App（「最近用过」）
        long lastAppStart = 0;
        String lastClosedPkg = null;  // 上一个被关闭的会话（同 App 内切换判定）
        long lastClosedTs = 0;
        String autoResumePkg = null;  // 息屏/锁屏前正在用的 App（解锁后自动续计同一会话）
        boolean keyguardArmed = false; // 拉起过锁屏（决定亮屏时是否自动续计）

        String longestApp = null;
        long longestMs = 0;
        int switchCount = 0;

        for (Ev ev : evs) {
            long ts = ev.ts;
            if (ts > now + 60_000L) continue; // 时钟跳变产生的未来事件忽略

            if (ev.type == Ev.T_RESUMED) { // RESUMED
                // 显式前台事件接管一切：清掉解锁自动续计的候补
                autoResumePkg = null;
                // 结算当前打开中的会话（部分 ROM 不发 PAUSED，切走即结束）
                if (openApp != null && ts > openStart) {
                    long dur = settle(durationByApp, openApp, openStart, ts, startOfDay, now);
                    if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
                    lastClosedPkg = openApp;
                    lastClosedTs = ts;
                }
                if (ev.pkg == null || ev.pkg.equals(launcherPkg)) {
                    // 桌面停留：只结束上一会话，自身不计入任何 App
                    openApp = null;
                    continue;
                }
                boolean inToday = ts >= startOfDay;
                boolean intraAppSwitch = openApp == null
                        && ev.pkg.equals(lastClosedPkg)
                        && ts - lastClosedTs <= INTRA_APP_GAP_MS;
                openApp = ev.pkg;
                openStart = ts;
                if (inToday) {
                    if (!intraAppSwitch) {
                        opensByApp.merge(ev.pkg, 1, Integer::sum);
                        switchCount++;
                        lastOpenByApp.put(ev.pkg, ts);
                    }
                    lastApp = ev.pkg;
                    lastAppStart = ts;
                    historyTs.add(ts);
                    historyPkgs.add(ev.pkg);
                }
            } else if (ev.type == Ev.T_CLOSED) { // PAUSED / STOPPED（关闭）
                if (openApp != null && openApp.equals(ev.pkg)) {
                    long dur = settle(durationByApp, openApp, openStart, ts, startOfDay, now);
                    if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
                    lastClosedPkg = openApp;
                    lastClosedTs = ts;
                    openApp = null; // 息屏/切走：停止计时
                }
            } else if (ev.type == Ev.T_SCREEN_OFF || ev.type == Ev.T_KEYGUARD_SHOWN || ev.type == Ev.T_SHUTDOWN) {
                // 息屏/锁屏/关机：当前会话立刻结算（账本里 App 会一直「挂着 RESUMED」，
                // 不结算的话整段睡眠时间都会被算成使用时长 —— v1.2.1 修正）
                if (ev.type == Ev.T_KEYGUARD_SHOWN) keyguardArmed = true;
                if (openApp != null && ts > openStart) {
                    long dur = settle(durationByApp, openApp, openStart, ts, startOfDay, now);
                    if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
                    lastClosedPkg = openApp;
                    lastClosedTs = ts;
                    autoResumePkg = openApp; // 记住锁屏前在用的 App，解锁后自动续计
                    openApp = null;
                }
                if (ev.type == Ev.T_SHUTDOWN) {
                    autoResumePkg = null; // 关机后不存在「还在原 App」
                    keyguardArmed = false;
                }
            } else if (ev.type == Ev.T_KEYGUARD_HIDDEN) {
                // 解锁：若仍停留在锁屏前那个 App（系统不会为同一 Activity 补发
                // RESUMED），自动续计同一会话；随后若真是别的 App 前台，会有
                // RESUMED 事件来结算这个短暂误开（误差 <1s）
                keyguardArmed = false;
                if (openApp == null && autoResumePkg != null
                        && (launcherPkg == null || !autoResumePkg.equals(launcherPkg))) {
                    openApp = autoResumePkg;
                    openStart = ts;
                }
                autoResumePkg = null;
            } else if (ev.type == Ev.T_SCREEN_ON) {
                // 亮屏：仅当锁屏从未拉起（无锁屏/保持解锁的设备）才自动续计；
                // 有锁屏时等 KEYGUARD_HIDDEN（解锁）再续，避免「亮屏看锁屏」被计费。
                // 若本事件先于 KEYGUARD_SHOWN 到达导致误开，随后的 KEYGUARD_SHOWN
                // 会立即结算掉（误差 <1s）。
                if (!keyguardArmed && openApp == null && autoResumePkg != null
                        && (launcherPkg == null || !autoResumePkg.equals(launcherPkg))) {
                    openApp = autoResumePkg;
                    openStart = ts;
                    autoResumePkg = null;
                }
            } else { // T_BOOT：开机，一切状态清零
                openApp = null;
                autoResumePkg = null;
                keyguardArmed = false;
            }
        }

        SimpleDateFormat hhmm = new SimpleDateFormat("HH:mm", Locale.getDefault());

        // 分 App 时长列表（降序；带打开次数与最近打开时间，最多 30 个）
        JSArray todayApps = new JSArray();
        List<Map.Entry<String, Long>> sorted = new ArrayList<>(durationByApp.entrySet());
        sorted.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
        long totalMs = 0;
        int appCount = 0;
        for (Map.Entry<String, Long> e : sorted) {
            totalMs += e.getValue();
            if (appCount++ >= 30) continue;
            JSObject o = new JSObject();
            o.put("app", e.getKey());
            o.put("name", appLabel(pm, e.getKey()));
            o.put("ms", e.getValue());
            o.put("opens", opensByApp.getOrDefault(e.getKey(), 0));
            Long lastOpen = lastOpenByApp.get(e.getKey());
            o.put("lastOpenTs", lastOpen == null ? 0 : lastOpen);
            todayApps.put(o);
        }

        // 近 3 小时打开过的 App（最近在前）
        JSArray recentApps = new JSArray();
        final long RECENT_WINDOW = 3 * 60 * 60 * 1000L;
        List<String> recentPkgs = new ArrayList<>();
        for (Map.Entry<String, Long> e : lastOpenByApp.entrySet()) {
            if (now - e.getValue() <= RECENT_WINDOW) recentPkgs.add(e.getKey());
        }
        recentPkgs.sort((a, b) -> Long.compare(lastOpenByApp.get(b), lastOpenByApp.get(a)));
        int recentCount = 0;
        for (String pkg : recentPkgs) {
            if (recentCount++ >= 10) break;
            JSObject o = new JSObject();
            o.put("app", pkg);
            o.put("name", appLabel(pm, pkg));
            Long ts = lastOpenByApp.get(pkg);
            o.put("hhmm", hhmm.format(new Date(ts == null ? now : ts)));
            o.put("opens", opensByApp.getOrDefault(pkg, 0));
            o.put("ms", durationByApp.getOrDefault(pkg, 0L));
            recentApps.put(o);
        }

        // 近期切换时间线（最后 24 条，仅今日）
        JSArray hist = new JSArray();
        int from = Math.max(0, historyPkgs.size() - 24);
        for (int i = from; i < historyPkgs.size(); i++) {
            JSObject o = new JSObject();
            o.put("hhmm", hhmm.format(new Date(historyTs.get(i))));
            o.put("app", historyPkgs.get(i));
            o.put("name", appLabel(pm, historyPkgs.get(i)));
            hist.put(o);
        }

        JSObject ret = new JSObject();
        if (openApp != null && openStart > 0) {
            JSObject cur = new JSObject();
            cur.put("app", openApp);
            cur.put("name", appLabel(pm, openApp));
            cur.put("ongoingMs", Math.max(0, now - openStart));
            cur.put("at", openStart);
            ret.put("current", cur);
        } else if (lastApp != null && lastAppStart > 0) {
            JSObject cur = new JSObject();
            cur.put("app", lastApp);
            cur.put("name", appLabel(pm, lastApp));
            cur.put("ongoingMs", 0);
            cur.put("at", lastAppStart);
            cur.put("closed", true);
            ret.put("current", cur);
        }
        ret.put("todayApps", todayApps);
        ret.put("todayTotalMs", totalMs);
        ret.put("switchCount", switchCount);
        ret.put("history", hist);
        ret.put("recentApps", recentApps);
        if (longestApp != null) {
            JSObject lg = new JSObject();
            lg.put("app", appLabel(pm, longestApp));
            lg.put("ms", longestMs);
            ret.put("longest", lg);
        }
        return ret;
    }

    /** 会话结算：[openStart, closeTs] ∩ [startOfDay, now]，返回计入的时长 */
    private long settle(Map<String, Long> durationByApp, String pkg, long openStart, long closeTs,
                        long startOfDay, long now) {
        long cs = Math.max(openStart, startOfDay);
        long ce = Math.min(closeTs, now);
        if (ce <= cs) return 0;
        long dur = ce - cs;
        durationByApp.merge(pkg, dur, Long::sum);
        return dur;
    }

    /** 默认桌面 Launcher 包名（解析失败返回 null = 不排除） */
    private String defaultLauncherPkg() {
        try {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            ResolveInfo ri = getContext().getPackageManager()
                    .resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
            if (ri != null && ri.activityInfo != null) return ri.activityInfo.packageName;
        } catch (Throwable ignored) {
        }
        return null;
    }

    // ================= Shizuku 引擎（dumpsys usagestats） =================

    /** binder 活性（getVersion 在未运行时抛异常） */
    private boolean shizukuBinderAlive() {
        try {
            Shizuku.getVersion();
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private boolean shizukuPermissionGranted() {
        try {
            return Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    @PluginMethod
    public void shizukuStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", true);
        boolean running = shizukuBinderAlive();
        ret.put("running", running);
        int version = 0;
        int uid = -1;
        if (running) {
            try {
                version = Shizuku.getVersion();
                uid = Shizuku.getUid();
            } catch (Throwable ignored) {
            }
        }
        ret.put("version", version);
        ret.put("uid", uid);
        ret.put("granted", running && shizukuPermissionGranted());
        call.resolve(ret);
    }

    /** 拉起 Shizuku 授权（结果经 OnRequestPermissionResultListener 回传，30s 兜底） */
    @PluginMethod
    public void requestShizukuPermission(PluginCall call) {
        if (!shizukuBinderAlive()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "not-running");
            call.resolve(ret);
            return;
        }
        if (shizukuPermissionGranted()) {
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (shizukuPermListener != null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "busy");
            call.resolve(ret);
            return;
        }
        final PluginCall[] holder = new PluginCall[]{call};
        shizukuPermListener = (requestCode, resultCode) -> {
            if (requestCode != REQ_SHIZUKU_PERMISSION) return;
            try {
                Shizuku.removeRequestPermissionResultListener(shizukuPermListener);
            } catch (Throwable ignored) {
            }
            shizukuPermListener = null;
            PluginCall c = holder[0];
            if (c == null) return;
            holder[0] = null;
            JSObject ret = new JSObject();
            boolean granted = resultCode == PackageManager.PERMISSION_GRANTED;
            ret.put("ok", granted);
            ret.put("granted", granted);
            c.resolve(ret);
        };
        try {
            Shizuku.addRequestPermissionResultListener(shizukuPermListener);
            Shizuku.requestPermission(REQ_SHIZUKU_PERMISSION);
        } catch (Throwable t) {
            try {
                Shizuku.removeRequestPermissionResultListener(shizukuPermListener);
            } catch (Throwable ignored) {
            }
            shizukuPermListener = null;
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "error");
            call.resolve(ret);
            return;
        }
        // 授权对话框挂着不动（用户没点）时 30s 兜底释放，防桥挂起
        final Shizuku.OnRequestPermissionResultListener listenerRef = shizukuPermListener;
        new Thread(() -> {
            try {
                Thread.sleep(30_000L);
            } catch (InterruptedException ignored) {
                return;
            }
            if (shizukuPermListener != null && shizukuPermListener == listenerRef) {
                try {
                    Shizuku.removeRequestPermissionResultListener(listenerRef);
                } catch (Throwable ignored) {
                }
                shizukuPermListener = null;
                PluginCall c = holder[0];
                if (c == null) return;
                holder[0] = null;
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "timeout");
                c.resolve(ret);
            }
        }, "shizuku-perm-timeout").start();
    }

    private Shizuku.OnRequestPermissionResultListener shizukuPermListener;

    // ================= Shizuku 能力实验室（v1.3：通用 shell 执行 + 静默截屏） =================

    /** Shizuku 就绪态检查：未运行/未授权时返回对应 reason，否则 null */
    private String shizukuGateReason() {
        if (!shizukuBinderAlive()) return "shizuku-not-running";
        if (!shizukuPermissionGranted()) return "shizuku-no-permission";
        return null;
    }

    /** argv 数组参数提取（null/空数组返回 null） */
    private String[] stringArrayArg(PluginCall call, String key) {
        try {
            JSArray arr = call.getArray(key, null);
            if (arr == null || arr.length() == 0) return null;
            String[] out = new String[arr.length()];
            for (int i = 0; i < arr.length(); i++) {
                Object o = arr.opt(i);
                if (o == null) return null;
                out[i] = String.valueOf(o).trim();
                if (out[i].isEmpty()) return null;
            }
            return out;
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * 通用 shell 命令执行（能力实验室底座）：
     * - cmd：argv 数组，argv[0] 必须命中 SHIZUKU_ALLOWED_BINARIES 白名单；
     * - mustContain：可选行过滤 token（全部命中的行才保留，控制回传体积）；
     * - maxLines：回传行数上限（默认 1000，硬顶 20000；服务端另有 400K 字符环形上限）；
     * - timeoutMs：看门狗超时（默认 8s，硬顶 30s）；
     * 返回 { ok, out } / { ok:false, reason }（reason：shizuku-not-running /
     * shizuku-no-permission / bind-* / 不在白名单时直接 reject）。
     */
    @PluginMethod
    public void shizukuExec(PluginCall call) {
        final String[] cmd = stringArrayArg(call, "cmd");
        if (cmd == null) {
            call.reject("缺少或非法的 cmd 参数（非空字符串数组）");
            return;
        }
        final String[] mustContain = stringArrayArg(call, "mustContain");
        int ml;
        long tm;
        try {
            ml = call.getInt("maxLines", 1000);
        } catch (Throwable t) {
            ml = 1000;
        }
        try {
            tm = call.getLong("timeoutMs", 8000L);
        } catch (Throwable t) {
            tm = 8000L;
        }
        final int maxLines = Math.max(1, Math.min(20_000, ml));
        final long timeoutMs = Math.max(1000L, Math.min(30_000L, tm));
        // 内核抽出为 runWhitelistedShell（v1.5，与 executeShell 共用；对外行为完全不变）
        runWhitelistedShell(call, cmd, mustContain, maxLines, timeoutMs);
    }

    /**
     * 白名单 shell 执行共用内核（v1.5 从 shizukuExec 抽出，shizukuExec / executeShell 共用）：
     * 白名单检查 → 二进制安全检查 → Shizuku gate → 后台线程 execFiltered → resolve。
     * 对外行为与原 shizukuExec 完全一致（含 reject/resolve 形态与线程名）。
     * cmd 由调用方保证非空（stringArrayArg 产出）。
     */
    private void runWhitelistedShell(PluginCall call, String[] cmd, String[] mustContain,
                                     int maxLines, long timeoutMs) {
        if (cmd == null || cmd.length == 0) {
            call.reject("缺少或非法的 cmd 参数（非空字符串数组）");
            return;
        }
        if (!SHIZUKU_ALLOWED_BINARIES.contains(cmd[0])) {
            call.reject("命令不在白名单：" + cmd[0]);
            return;
        }
        for (String a : cmd) {
            if (a.indexOf('\0') >= 0) { // 防御性：二进制安全
                call.reject("cmd 含非法字符");
                return;
            }
        }
        String gate = shizukuGateReason();
        if (gate != null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", gate);
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            try {
                IPerceptionShellService svc = requireShellService(6000);
                String out = svc.execFiltered(cmd, mustContain, 0L, maxLines, timeoutMs);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("out", out == null ? "" : out);
                call.resolve(ret);
            } catch (Throwable t) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", t instanceof IllegalStateException ? t.getMessage() : "exec-error");
                call.resolve(ret);
            }
        }, "shizuku-exec").start();
    }

    /**
     * 静默截屏（免 MediaProjection 授权弹窗）：screencap → 服务端降采样 JPEG base64 dataURL。
     * FLAG_SECURE 页面/失败 → { ok:false, reason:'empty' }。
     */
    @PluginMethod
    public void shizukuScreencap(PluginCall call) {
        String gate = shizukuGateReason();
        if (gate != null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", gate);
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            try {
                IPerceptionShellService svc = requireShellService(6000);
                String frame = svc.shScreencap(10_000L);
                JSObject ret = new JSObject();
                if (frame != null && !frame.isEmpty()) {
                    ret.put("ok", true);
                    ret.put("frame", frame);
                } else {
                    ret.put("ok", false);
                    ret.put("reason", "empty");
                }
                call.resolve(ret);
            } catch (Throwable t) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", t instanceof IllegalStateException ? t.getMessage() : "exec-error");
                call.resolve(ret);
            }
        }, "shizuku-screencap").start();
    }

    // ================= Mobile Agent（v1.5：Agent 动作执行底座） =================

    /** Agent 紧急停止广播 action（通知栏「■ 紧急停止」按钮 → 本插件动态 receiver 置位） */
    public static final String AGENT_STOP_ACTION = "com.z.aiphone.AGENT_STOP_ACTION";

    /** Agent 紧急停止标志（static volatile：广播 receiver 线程置位、网页 agentShouldStop
     *  轮询读取，跨 bridge/插件实例共享；agentResetStop 复位） */
    private static volatile boolean AGENT_ABORT = false;

    /** Agent 常驻状态通知 id（agentNotify 刷新 / agentNotifyEnd 撤销共用） */
    private static final int AGENT_NOTIFY_ID = 7788;
    /** Agent 常驻通知渠道 id（仅首次创建） */
    private static final String AGENT_NOTIFY_CHANNEL = "agent_runner";
    /** Agent 无 UI 输入法的 ime id（flattenToShortString 形态） */
    private static final String AGENT_IME_ID = "com.z.aiphone/.AdbImeService";
    /** uiautomator dump 的固定落盘路径（shell 权限可写） */
    private static final String UI_DUMP_PATH = "/sdcard/window_dump.xml";

    private BroadcastReceiver agentStopReceiver;

    /**
     * 插件接入 bridge 的标准初始化点（注册「紧急停止」广播 receiver）：
     * 注：Capacitor 8 的 Plugin 基类没有 pluginInitialize() 钩子（v3 时代已移除），
     * load() 是插件连接 bridge 之后、任何 @PluginMethod 调用之前的初始化回调，
     * 此时 getContext() 已注入可用 —— 比构造函数可靠（构造时 bridge/context 尚未就绪）。
     */
    @Override
    public void load() {
        super.load();
        if (agentStopReceiver != null) return; // 防重入（每 bridge 实例只 load 一次）
        agentStopReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                AGENT_ABORT = true;
            }
        };
        // 通知按钮的 PendingIntent 由本应用自己创建并发送（同 UID 自发自收），
        // RECEIVER_NOT_EXPORTED 足够且更安全；若个别 ROM 拦截自发自收导致按钮失效，
        // 可降级 RECEIVER_EXPORTED（intent 已 setPackage 限定本应用，暴露面等同）。
        ContextCompat.registerReceiver(getContext(), agentStopReceiver,
                new IntentFilter(AGENT_STOP_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        if (agentStopReceiver != null) {
            try {
                getContext().unregisterReceiver(agentStopReceiver);
            } catch (Throwable ignored) {
            }
            agentStopReceiver = null;
        }
        super.handleOnDestroy();
    }

    /**
     * Agent 通用 shell 执行（executeShell）：与 shizukuExec 同内核（runWhitelistedShell），
     * 面向 Agent 运行时的简化封装 —— 无行过滤、maxLines 固定 4000、默认 15s / 硬顶 30s。
     * 入参 { cmd: string[], timeoutMs?: number } → { ok:true, out } / { ok:false, reason }
     * （cmd 缺失/不在白名单时 reject，与 shizukuExec 口径一致）。
     */
    @PluginMethod
    public void executeShell(PluginCall call) {
        final String[] cmd = stringArrayArg(call, "cmd");
        if (cmd == null) {
            call.reject("缺少或非法的 cmd 参数（非空字符串数组）");
            return;
        }
        long tm;
        try {
            tm = call.getLong("timeoutMs", 15_000L);
        } catch (Throwable t) {
            tm = 15_000L;
        }
        final long timeoutMs = Math.max(1000L, Math.min(30_000L, tm));
        runWhitelistedShell(call, cmd, null, 4000, timeoutMs);
    }

    /**
     * 屏幕分辨率（滑动坐标换算用）：wm size 输出解析 ——
     * 优先 "Override size: WxH" 行（用户改过显示设置后的覆盖值，点击/滑动按这个来），
     * 其次 "Physical size: WxH"（出厂物理分辨率）。
     * → { ok:true, width, height, raw } / { ok:false, reason:'parse'|gate }
     */
    @PluginMethod
    public void getScreenResolution(PluginCall call) {
        String gate = shizukuGateReason();
        if (gate != null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", gate);
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            try {
                IPerceptionShellService svc = requireShellService(6000);
                String out = svc.execFiltered(new String[]{"wm", "size"}, null, 0L, 50, 8000L);
                int[] wh = parseWmSize(out);
                JSObject ret = new JSObject();
                if (wh == null) {
                    ret.put("ok", false);
                    ret.put("reason", "parse");
                } else {
                    ret.put("ok", true);
                    ret.put("width", wh[0]);
                    ret.put("height", wh[1]);
                }
                ret.put("raw", out == null ? "" : out);
                call.resolve(ret);
            } catch (Throwable t) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", t instanceof IllegalStateException ? t.getMessage() : "exec-error");
                call.resolve(ret);
            }
        }, "shizuku-resolution").start();
    }

    /** wm size 数值对正则：抓取形如 1080x2400 */
    private static final Pattern WM_SIZE_RX = Pattern.compile("(\\d+)x(\\d+)");

    /** 解析 wm size 输出：Override 优先、Physical 兜底；返回 [width, height] 或 null */
    private int[] parseWmSize(String out) {
        if (out == null || out.isEmpty()) return null;
        int[] wh = matchSizeLine(out, "Override size:");
        if (wh != null) return wh;
        return matchSizeLine(out, "Physical size:");
    }

    /** 在指定前缀的行里抓第一个 WxH 数值对（无则 null） */
    private int[] matchSizeLine(String out, String prefix) {
        for (String line : out.split("\n")) {
            String t = line.trim();
            if (!t.startsWith(prefix)) continue;
            Matcher m = WM_SIZE_RX.matcher(t);
            if (m.find()) {
                try {
                    int w = Integer.parseInt(m.group(1));
                    int h = Integer.parseInt(m.group(2));
                    if (w > 0 && h > 0) return new int[]{w, h};
                } catch (NumberFormatException ignored) {
                }
            }
        }
        return null;
    }

    /**
     * 控件树倾倒（Agent「看屏幕」）：uiautomator dump --compressed 写入
     * /sdcard/window_dump.xml → cat 取 XML 全文回传，网页侧自行解析控件树
     * （可点节点/文本/坐标）。dump 失败（常见 "could not get idle state"，
     * 页面动画未停）等 900ms 重试一次；cat 为空重试一次。
     * → { ok:true, xml } / { ok:false, reason:'dump-failed', out:输出片段 }
     */
    @PluginMethod
    public void dumpUi(PluginCall call) {
        String gate = shizukuGateReason();
        if (gate != null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", gate);
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            try {
                IPerceptionShellService svc = requireShellService(6000);
                String[] dumpCmd = {"uiautomator", "dump", "--compressed", UI_DUMP_PATH};
                String dumpOut = svc.execFiltered(dumpCmd, null, 0L, 50, 15_000L);
                if (dumpOut == null || !dumpOut.contains("dumped")) {
                    // 成功输出形如 "UI hierchary dumped to: ..."（AOSP 原生拼写如此）
                    try {
                        Thread.sleep(900L);
                    } catch (InterruptedException ignored) {
                    }
                    dumpOut = svc.execFiltered(dumpCmd, null, 0L, 50, 15_000L);
                }
                if (dumpOut == null || !dumpOut.contains("dumped")) {
                    JSObject ret = new JSObject();
                    ret.put("ok", false);
                    ret.put("reason", "dump-failed");
                    String frag = dumpOut == null ? "" : dumpOut;
                    ret.put("out", frag.length() > 400 ? frag.substring(0, 400) : frag);
                    call.resolve(ret);
                    return;
                }
                String[] catCmd = {"cat", UI_DUMP_PATH};
                // XML 为单行超长文本，execFiltered 环形缓冲按行算，maxLines 给大没关系
                String xml = svc.execFiltered(catCmd, null, 0L, 400, 10_000L);
                if (xml == null || xml.trim().isEmpty()) {
                    // 偶发：文件落盘可见性延迟 → 等 300ms 重试 cat 一次
                    try {
                        Thread.sleep(300L);
                    } catch (InterruptedException ignored) {
                    }
                    xml = svc.execFiltered(catCmd, null, 0L, 400, 10_000L);
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("xml", xml == null ? "" : xml);
                call.resolve(ret);
            } catch (Throwable t) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", t instanceof IllegalStateException ? t.getMessage() : "exec-error");
                call.resolve(ret);
            }
        }, "shizuku-dumpui").start();
    }

    /**
     * 中文/emoji 输入（inputChinese）：
     * - 纯 ASCII 文本：直接 input text（空格转 %s），不动输入法
     *   → { ok:true, via:'ascii', switched:false, currentIme:'' }；
     * - 含非 ASCII（中文/emoji）：读取当前默认输入法 → 首次经 ime enable+set 切到
     *   本应用无 UI 输入法（com.z.aiphone/.AdbImeService，见 AdbImeService.java）
     *   后广播 AGENT_IME_INPUT 注入 commitText（原生支持中文/emoji）
     *   → { ok:true, via:'ime', switched, currentIme }。
     * 注意：不在此恢复原输入法 —— Agent 多步输入只切一次，任务结束由前端调 restoreIme。
     */
    @PluginMethod
    public void inputChinese(PluginCall call) {
        final String text = call.getString("text", "");
        if (text == null || text.isEmpty()) {
            call.reject("缺少或非法的 text 参数（非空字符串）");
            return;
        }
        String gate = shizukuGateReason();
        if (gate != null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", gate);
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            try {
                IPerceptionShellService svc = requireShellService(6000);
                if (isPureAscii(text)) {
                    // 纯 ASCII：input text 直注（%s 是 input 命令的空格转义约定）
                    svc.execFiltered(new String[]{"input", "text", text.replace(" ", "%s")},
                            null, 0L, 50, 8000L);
                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    ret.put("via", "ascii");
                    ret.put("switched", false);
                    ret.put("currentIme", "");
                    call.resolve(ret);
                    return;
                }
                // 含中文/emoji：读取当前默认输入法 → 首次切换到 Agent IME → 广播注入
                String cur = svc.execFiltered(
                        new String[]{"settings", "get", "secure", "default_input_method"},
                        null, 0L, 20, 5000L);
                cur = cur == null ? "" : cur.trim();
                boolean switched = false;
                if (!AGENT_IME_ID.equals(cur)) {
                    svc.execFiltered(new String[]{"ime", "enable", AGENT_IME_ID},
                            null, 0L, 50, 8000L);
                    svc.execFiltered(new String[]{"ime", "set", AGENT_IME_ID},
                            null, 0L, 50, 8000L);
                    switched = true;
                    // ime set 是异步绑定：给 IMMS 一点时间绑上本 IME（含 onStartInput 流程），
                    // 否则紧随的广播到达时 getCurrentInputConnection() 还是 null，首个输入会丢
                    try {
                        Thread.sleep(800L);
                    } catch (InterruptedException ignored) {
                    }
                }
                svc.execFiltered(new String[]{"am", "broadcast", "-a", "com.z.aiphone.AGENT_IME_INPUT",
                        "--es", "text", text}, null, 0L, 50, 8000L);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("via", "ime");
                ret.put("switched", switched);
                ret.put("currentIme", cur);
                call.resolve(ret);
            } catch (Throwable t) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", t instanceof IllegalStateException ? t.getMessage() : "exec-error");
                call.resolve(ret);
            }
        }, "shizuku-input").start();
    }

    /** 纯 ASCII 判定（无任何 >0x7F 字符）：决定 input text 直注 vs 切 IME 注入 */
    private static boolean isPureAscii(String s) {
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) > 0x7F) return false;
        }
        return true;
    }

    /**
     * 恢复原输入法（Agent 任务结束收尾；inputChinese 切换时前端先存下 currentIme）。
     * 入参 { imeId: string }；为空 → { ok:false, reason:'no-ime' }。
     */
    @PluginMethod
    public void restoreIme(PluginCall call) {
        String imeId = call.getString("imeId", "");
        if (imeId == null || imeId.trim().isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "no-ime");
            call.resolve(ret);
            return;
        }
        final String id = imeId.trim();
        String gate = shizukuGateReason();
        if (gate != null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", gate);
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            try {
                IPerceptionShellService svc = requireShellService(6000);
                svc.execFiltered(new String[]{"ime", "set", id}, null, 0L, 50, 8000L);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Throwable t) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", t instanceof IllegalStateException ? t.getMessage() : "exec-error");
                call.resolve(ret);
            }
        }, "shizuku-ime").start();
    }

    /** Agent 是否已被要求紧急停止（网页侧每步动作前轮询） */
    @PluginMethod
    public void agentShouldStop(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("stop", AGENT_ABORT);
        call.resolve(ret);
    }

    /** 复位紧急停止标志（新任务开始时调用） */
    @PluginMethod
    public void agentResetStop(PluginCall call) {
        AGENT_ABORT = false;
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /**
     * Agent 执行期常驻状态通知（id 7788，渠道 agent_runner，IMPORTANCE_LOW 静默不打扰）：
     * 带「■ 紧急停止」按钮 → 广播 AGENT_STOP_ACTION → 本插件动态 receiver 置位
     * AGENT_ABORT（PendingIntent 由本应用自发自收，receiver 为 NOT_EXPORTED）。
     * 先 cancel 再 notify，支持任务中刷新文案。POST_NOTIFICATIONS 运行时权限由前端在
     * 开启 Agent 总开关时引导授权；未授权（Android 13+）时 notify 抛 SecurityException →
     * { ok:false, reason:'no-notification-permission' }，不 crash。
     */
    @PluginMethod
    public void agentNotify(PluginCall call) {
        String title = call.getString("title", "AI Agent 执行中");
        if (title == null || title.trim().isEmpty()) title = "AI Agent 执行中";
        String text = call.getString("text", "");
        try {
            Context ctx = getContext();
            NotificationManager nm =
                    (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "no-notification-service");
                call.resolve(ret);
                return;
            }
            if (Build.VERSION.SDK_INT >= 26) { // NotificationChannel 需 API 26+（minSdk 24 做版本闸）
                NotificationChannel ch = new NotificationChannel(
                        AGENT_NOTIFY_CHANNEL, "Agent 执行状态", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Mobile Agent 任务执行期间的常驻状态通知");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch); // 仅首次创建生效，重复调用幂等
            }
            Intent stopIntent = new Intent(AGENT_STOP_ACTION).setPackage(ctx.getPackageName());
            PendingIntent stopPi = PendingIntent.getBroadcast(ctx, 0, stopIntent,
                    PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder builder =
                    new NotificationCompat.Builder(ctx, AGENT_NOTIFY_CHANNEL)
                            // 项目无自定义通知图标（res/drawable 仅 splash），用框架信息图标
                            .setSmallIcon(android.R.drawable.ic_dialog_info)
                            .setContentTitle(title)
                            .setOngoing(true)
                            .setOnlyAlertOnce(true)
                            .addAction(new NotificationCompat.Action.Builder(
                                    0, "■ 紧急停止", stopPi).build());
            if (text != null && !text.isEmpty()) {
                builder.setContentText(text);
            }
            nm.cancel(AGENT_NOTIFY_ID);
            nm.notify(AGENT_NOTIFY_ID, builder.build());
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (SecurityException se) {
            // Android 13+ 未授予 POST_NOTIFICATIONS 运行时权限
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "no-notification-permission");
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
            call.resolve(ret);
        }
    }

    /** Agent 结束：撤销常驻状态通知 */
    @PluginMethod
    public void agentNotifyEnd(PluginCall call) {
        try {
            NotificationManager nm =
                    (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(AGENT_NOTIFY_ID);
        } catch (Throwable ignored) {
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    // ---------------- 本地通知（C2：页面后台提醒统一出口，网页 notifyIfHidden 的原生通道） ----------------

    /** 本地通知渠道 id（与 Agent 常驻通知 agent_runner 分开，用户可在系统设置单独静音/关闭） */
    private static final String LOCAL_NOTIFY_CHANNEL = "local_notify";
    /** 无 tag 本地通知的自增 id 起点（避开 Agent 常驻通知 id 7788） */
    private static final java.util.concurrent.atomic.AtomicInteger LOCAL_NOTIFY_SEQ =
            new java.util.concurrent.atomic.AtomicInteger(8100);

    // ---------------- C5 点击直达：通知带目的地回传 WebView ----------------

    /** localNotify 可选 url（落地页路径字符串，如 "/"）extra 键：
     *  塞进通知 contentIntent，点击通知回到本 Activity 时读出并注入 WebView（见 handleOnNewIntent） */
    private static final String EXTRA_LOCAL_NOTIFY_URL = "local_notify_url";
    /** localNotify 可选 target（island-notify NotifyTarget 同构对象的 JSON 字符串，如 {"app":"phone"}）extra 键 */
    private static final String EXTRA_LOCAL_NOTIFY_TARGET = "local_notify_target";

    /**
     * 本地通知 localNotify({title, body, tag?, url?, target?})：页面在后台时的即时提醒
     * （Agent 任务完成 / AI 来电 / 情侣小家动态等事件源调用）。与 agentNotify 的差异：
     * 不带「紧急停止」action、不常驻（autoCancel + 非 ongoing，可被滑动清除）、tag 用于同 tag
     * 去重（后发替换先发）与 localNotifyCancel 定向撤销；点击通知打开应用主 Activity
     * （launchMode=singleTask，带回前台不重开实例）。
     * C5 点击直达：可选 url（落地页路径）/ target（NotifyTarget 同构对象的 JSON 字符串）
     * 塞进 contentIntent extra —— 点击通知回到本 Activity 时由 handleOnNewIntent 读出，
     * 以 MessageEvent('local-notify-open') 注入 WebView 回传页面导航。
     * Android 13+ POST_NOTIFICATIONS 运行时权限（AndroidManifest 已声明）+ 全版本「应用通知
     * 总开关」双检查：未授予/已关闭时静默返回 {ok:false}（通知是增强能力，不 crash 不打扰）。
     */
    @PluginMethod
    public void localNotify(PluginCall call) {
        String title = call.getString("title", "");
        String body = call.getString("body", "");
        String tag = call.getString("tag", null);
        // C5 点击直达（可选）：url = 落地页路径字符串；target = island-notify NotifyTarget 的 JSON 字符串
        String url = call.getString("url", null);
        String target = call.getString("target", null);
        JSObject ret = new JSObject();
        try {
            Context ctx = getContext();
            NotificationManager nm =
                    (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) {
                ret.put("ok", false);
                ret.put("reason", "no-notification-service");
                call.resolve(ret);
                return;
            }
            // Android 13+（API 33）运行时权限检查：未授予 POST_NOTIFICATIONS → 静默放弃
            if (Build.VERSION.SDK_INT >= 33
                    && ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
                            != PackageManager.PERMISSION_GRANTED) {
                ret.put("ok", false);
                ret.put("reason", "no-notification-permission");
                call.resolve(ret);
                return;
            }
            // 应用级通知总开关（低版本 ROM 也覆盖；13+ 关权限时同样为 false，双保险）
            if (!nm.areNotificationsEnabled()) {
                ret.put("ok", false);
                ret.put("reason", "notifications-disabled");
                call.resolve(ret);
                return;
            }
            if (Build.VERSION.SDK_INT >= 26) { // NotificationChannel 需 API 26+（minSdk 24 做版本闸）
                NotificationChannel ch = new NotificationChannel(
                        LOCAL_NOTIFY_CHANNEL, "应用提醒", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("页面在后台时的提醒通知（Agent 完成 / AI 来电 / 情侣小家动态等）");
                nm.createNotificationChannel(ch); // 仅首次创建生效，重复调用幂等
            }
            // 有 tag：id 取 tag.hashCode()，与 tag 组成稳定 (tag,id) 对 → 同 tag 后发替换先发（去重）、
            // localNotifyCancel 按同对撤销；无 tag：自增 id，多条互不替换
            int id = (tag == null || tag.isEmpty()) ? LOCAL_NOTIFY_SEQ.getAndIncrement() : tag.hashCode();
            Intent contentIntent = new Intent(ctx, MainActivity.class);
            contentIntent.setPackage(ctx.getPackageName());
            contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            // C5 点击直达：带目的地时塞 extra（handleOnNewIntent 读出后注入 WebView 回传页面）
            boolean hasDest = (url != null && !url.isEmpty()) || (target != null && !target.isEmpty());
            if (url != null && !url.isEmpty()) {
                contentIntent.putExtra(EXTRA_LOCAL_NOTIFY_URL, url);
            }
            if (target != null && !target.isEmpty()) {
                contentIntent.putExtra(EXTRA_LOCAL_NOTIFY_TARGET, target);
            }
            // 带 extra 时加 FLAG_UPDATE_CURRENT：同 requestCode 复用既有 PendingIntent 时 extras
            // 也会刷新为本次最新目的地（否则旧目的地残留）；不带 extra 保持原样（零行为变化）
            PendingIntent contentPi = PendingIntent.getActivity(ctx, id, contentIntent,
                    hasDest
                            ? (PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
                            : PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder builder =
                    new NotificationCompat.Builder(ctx, LOCAL_NOTIFY_CHANNEL)
                            // 项目无自定义通知图标（res/drawable 仅 splash），用框架信息图标（与 agentNotify 一致）
                            .setSmallIcon(android.R.drawable.ic_dialog_info)
                            .setContentTitle(title == null || title.isEmpty() ? "提醒" : title)
                            .setAutoCancel(true) // 点击后自动消失；非常驻，也可被滑动清除
                            .setContentIntent(contentPi);
            if (body != null && !body.isEmpty()) {
                builder.setContentText(body);
            }
            if (tag != null && !tag.isEmpty()) {
                nm.notify(tag, id, builder.build());
            } else {
                nm.notify(id, builder.build());
            }
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
            call.resolve(ret);
        }
    }

    /** 撤销一条本地通知 localNotifyCancel({tag})：按与 localNotify 相同的 (tag, tag.hashCode()) 配对 cancel */
    @PluginMethod
    public void localNotifyCancel(PluginCall call) {
        String tag = call.getString("tag", null);
        JSObject ret = new JSObject();
        try {
            if (tag != null && !tag.isEmpty()) {
                NotificationManager nm =
                        (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.cancel(tag, tag.hashCode());
            }
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
            call.resolve(ret);
        }
    }

    // ---------------- C5 点击直达：通知点击 → 目的地回传 WebView（事件契约供并行任务 2-c 监听） ----------------

    /**
     * Capacitor 生命周期钩子：每个 Intent 进入 MainActivity 时由 Bridge 逐插件回调
     * （Bridge.onNewIntent → plugin.handleOnNewIntent）。两个场景都会到达这里：
     * ① 热回前台 —— 应用在后台，用户点通知，singleTask 走 Activity.onNewIntent；
     * ② 冷启动 —— 进程已死时点通知，BridgeActivity.load() 里会 onNewIntent(getIntent())，
     *    启动 Intent 里的 extra 同样能被读到（此时页面尚未就绪，见 injectLocalNotifyOpen 的就绪闸）。
     * 带目的地 extra（EXTRA_LOCAL_NOTIFY_URL / EXTRA_LOCAL_NOTIFY_TARGET）的 Intent =
     * 用户点击了 localNotify 发出的通知 → 向 WebView 注入事件；普通启动/其他通知无 extra，
     * 第一行就返回，对既有启动链路零打扰。
     *
     * 事件契约（2-c 按此实现监听）：
     *   事件名 'local-notify-open'（window.dispatchEvent(new MessageEvent(...))）；
     *   event.data = { url: string, target?: object }
     *   url 为落地页路径字符串；target 为 island-notify NotifyTarget 同构对象
     *   （extra JSON 解析失败时只带 url）。
     */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null) return;
        String url = intent.getStringExtra(EXTRA_LOCAL_NOTIFY_URL);
        String targetJson = intent.getStringExtra(EXTRA_LOCAL_NOTIFY_TARGET);
        boolean hasUrl = url != null && !url.isEmpty();
        boolean hasTarget = targetJson != null && !targetJson.isEmpty();
        if (!hasUrl && !hasTarget) return; // 无目的地 extra（普通启动/其他通知）→ 不打扰页面
        injectLocalNotifyOpen(hasUrl ? url : null, hasTarget ? targetJson : null);
    }

    /**
     * 向 WebView 注入 'local-notify-open' 事件（只读 extra 并派发，不做业务判断；
     * 权限闸/渠道/去重等既有逻辑全部不变）。注入脚本等页面 ready 后再派发：
     * - 页面已加载完（热回前台）→ 60ms 后派发；
     * - 冷启动早注入（页面脚本/监听器尚未挂）→ 等 window load + 350ms 派发，并把目的地
     *   暂存 window.__localNotifyPendingOpen（监听方若错过事件可在挂载时消费该槽兜底；
     *   纯增强项，不消费也不影响事件契约）。
     * target 的 JSON 只在注入前用 JSONTokener 验证一次（非法则只带 url，事件契约口径）；
     * JS 侧再 JSON.parse 一次（quote 转义安全嵌入，解析失败同样只带 url）。
     */
    private void injectLocalNotifyOpen(String url, String targetJson) {
        try {
            Bridge bridge = getBridge();
            if (bridge == null) return;
            StringBuilder js = new StringBuilder("(function(){try{var d={");
            js.append(url != null ? "url:" + JSONObject.quote(url) : "");
            js.append("};");
            if (targetJson != null) {
                // target 必须是 JSON 对象（island-notify NotifyTarget 同构）：非法/非对象 → 只带 url。
                // 局部 try：解析失败只降级 target，绝不连 url 一起丢（事件契约口径）
                try {
                    Object parsed = new JSONTokener(targetJson).nextValue();
                    if (parsed instanceof JSONObject) {
                        js.append("try{var t=JSON.parse(")
                                .append(JSONObject.quote(targetJson))
                                .append(");if(t&&typeof t==='object')d.target=t;}catch(e){}");
                    }
                } catch (Throwable ignore) {
                    // 非法 JSON：按事件契约只带 url
                }
            }
            js.append("var fire=function(){try{window.dispatchEvent(")
                    .append("new MessageEvent('local-notify-open',{data:d}))}catch(e){}};");
            js.append("if(document.readyState==='complete'){setTimeout(fire,60);}")
                    .append("else{try{window.__localNotifyPendingOpen=d;}catch(e){}")
                    .append("window.addEventListener('load',function(){setTimeout(fire,350);},{once:true});}");
            js.append("}catch(e){}})();");
            bridge.eval(js.toString(), null);
        } catch (Throwable t) {
            // 注入失败静默：目的地丢失只影响点击直达体验，不影响通知主链路
        }
    }

    // ---------------- Shizuku UserService（shell 权限命令执行） ----------------

    private Shizuku.UserServiceArgs shellServiceArgs;
    private ServiceConnection shellServiceConn;
    private IPerceptionShellService shellSvc;

    /** 取（或绑定）跑在 Shizuku 进程里的 shell 服务（6s 绑定超时；失败抛异常） */
    private IPerceptionShellService requireShellService(long waitMs) throws Exception {
        if (shellSvc != null) return shellSvc;
        if (!shizukuBinderAlive()) throw new IllegalStateException("shizuku-not-running");
        if (!shizukuPermissionGranted()) throw new IllegalStateException("shizuku-no-permission");
        if (shellServiceArgs == null) {
            shellServiceArgs = new Shizuku.UserServiceArgs(
                            new ComponentName(getContext(), PerceptionShellService.class))
                    .processNameSuffix("perception_shell")
                    .daemon(false)
                    .version(3); // v3：AIDL 新增 shScreencap（静默截屏）；v2 曾改为「超限保留最新事件」；逻辑/AIDL 改动必须 bump
        }
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<IPerceptionShellService> ref = new AtomicReference<>(null);
        ServiceConnection conn = new ServiceConnection() {
            @Override
            public void onServiceConnected(ComponentName name, IBinder service) {
                ref.set(IPerceptionShellService.Stub.asInterface(service));
                latch.countDown();
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                shellSvc = null;
                shellServiceConn = null;
            }
        };
        try {
            Shizuku.bindUserService(shellServiceArgs, conn);
        } catch (Throwable t) {
            throw new IllegalStateException("bind-failed");
        }
        shellServiceConn = conn;
        if (!latch.await(waitMs, TimeUnit.MILLISECONDS)) {
            try {
                Shizuku.unbindUserService(shellServiceArgs, conn, true);
            } catch (Throwable ignored) {
            }
            shellServiceConn = null;
            throw new IllegalStateException("bind-timeout");
        }
        shellSvc = ref.get();
        if (shellSvc == null) throw new IllegalStateException("bind-null");
        return shellSvc;
    }

    /**
     * 经 Shizuku（shell 权限）读 dumpsys usagestats -c 的事件账本（-c 为 compact 模式：
     * 事件行 time=<epoch毫秒> type=<事件名> package=<包名|无>；事件段为「Last 24
     * hour events」，窗口足以覆盖今日-2h 回看）：
     * 服务端已按 mustContain 与时间窗预过滤（控制 Binder 回传体积，超限时保留最新事件）；
     * 事件类型兼容字符串（ACTIVITY_RESUMED/MOVE_TO_FOREGROUND）与数字（1/2/23）两种形态，
     * 并保留息屏/锁屏/开关机门控事件（v1.2.1）；
     * 多 interval 段可能重复倾倒同一事件 → 按 (ts|type|pkg) 去重。
     */
    private List<Ev> shizukuDumpEvents(long fromTs, long toTs) throws Exception {
        IPerceptionShellService svc = requireShellService(6000);
        String out = svc.execFiltered(
                new String[]{"dumpsys", "usagestats", "-c"},
                new String[]{"time=", "type="},
                fromTs,
                DUMP_EVENT_LIMIT,
                SHIZUKU_DUMP_TIMEOUT_MS);
        List<Ev> outList = new ArrayList<>();
        if (out == null || out.isEmpty()) return outList;
        Set<String> seen = new HashSet<>();
        for (String line : out.split("\n")) {
            Ev ev = parseDumpEventLine(line);
            if (ev == null) continue;
            if (ev.ts < fromTs || ev.ts > toTs + 60_000L) continue;
            String key = ev.ts + "|" + ev.type + "|" + (ev.pkg == null ? "" : ev.pkg);
            if (!seen.add(key)) continue;
            outList.add(ev);
        }
        outList.sort((a, b) -> Long.compare(a.ts, b.ts));
        return outList;
    }

    /** 解析单行 dumpsys 事件（非事件行/无关类型返回 null；门控事件可无 package） */
    private Ev parseDumpEventLine(String line) {
        if (line == null || line.length() < 10) return null;
        String time = null, type = null, pkg = null;
        for (String tok : line.trim().split("\\s+")) {
            int eq = tok.indexOf('=');
            if (eq <= 0) continue;
            String k = tok.substring(0, eq);
            String v = tok.substring(eq + 1);
            if (k.length() == 4 && k.equals("time")) {
                time = v;
            } else if (k.equals("type")) {
                type = v;
            } else if (k.equals("package")) {
                pkg = v;
            }
        }
        if (time == null || type == null) return null;
        if (pkg == null || pkg.isEmpty() || "null".equals(pkg)) pkg = null; // 系统事件无归属包
        int t;
        switch (type) {
            case "ACTIVITY_RESUMED":
            case "MOVE_TO_FOREGROUND":
            case "1":
                t = Ev.T_RESUMED;
                break;
            case "ACTIVITY_PAUSED":
            case "MOVE_TO_BACKGROUND":
            case "2":
            case "ACTIVITY_STOPPED":
            case "23":
                t = Ev.T_CLOSED;
                break;
            // ---- 门控事件（v1.2.1：息屏/锁屏即停 + 解锁续计）----
            case "SCREEN_NON_INTERACTIVE":
            case "16":
                t = Ev.T_SCREEN_OFF;
                break;
            case "SCREEN_INTERACTIVE":
            case "15":
                t = Ev.T_SCREEN_ON;
                break;
            case "KEYGUARD_SHOWN":
            case "17":
                t = Ev.T_KEYGUARD_SHOWN;
                break;
            case "KEYGUARD_HIDDEN":
            case "18":
                t = Ev.T_KEYGUARD_HIDDEN;
                break;
            case "DEVICE_SHUTDOWN":
            case "26":
                t = Ev.T_SHUTDOWN;
                break;
            case "DEVICE_STARTUP":
            case "27":
                t = Ev.T_BOOT;
                break;
            default:
                return null; // CONFIGURATION_CHANGE/NOTIFICATION_SEEN/USER_INTERACTION 等
        }
        if (pkg == null && t <= Ev.T_CLOSED) return null; // 前台/失焦事件必须有包名
        long ts;
        try {
            ts = Long.parseLong(time);
        } catch (NumberFormatException e) {
            return null;
        }
        return new Ev(ts, t, pkg);
    }

    // ================= 权限与工具 =================

    private boolean checkUsagePermission() {
        try {
            AppOpsManager aom = (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
            int mode = aom.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(), getContext().getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            return false;
        }
    }

    private String appLabel(PackageManager pm, String pkg) {
        try {
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            CharSequence label = pm.getApplicationLabel(ai);
            return label != null ? label.toString() : pkg;
        } catch (Exception e) {
            return pkg;
        }
    }

    // ================= 媒体感知（正在听什么歌） =================

    /** 「通知使用权」是否已授予本 APP（读取 enabled_notification_listeners） */
    private boolean checkMediaPermission() {
        try {
            String flat = Settings.Secure.getString(
                    getContext().getContentResolver(), "enabled_notification_listeners");
            return flat != null && flat.contains(getContext().getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void hasMediaPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", checkMediaPermission());
        ret.put("supported", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void openMediaPermissionSettings(PluginCall call) {
        try {
            // 先尝试让系统（重新）绑定监听服务，再跳设置页
            try {
                if (Build.VERSION.SDK_INT >= 24) {
                    NotificationListenerService.requestRebind(
                            new ComponentName(getContext(), MediaListenerService.class));
                }
            } catch (Throwable ignored) {
            }
            Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开系统设置：" + e.getMessage());
        }
    }

    /** 当前正在播放的媒体（歌名/歌手/专辑/状态）；无权限或暂无媒体时相应标记 */
    @PluginMethod
    public void getNowPlaying(PluginCall call) {
        if (!checkMediaPermission()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("needPermission", true);
            call.resolve(ret);
            return;
        }
        // 有权限但服务还没连上（刚授权/进程重启）：请求系统重绑，本轮先回空
        if (MediaListenerService.instance == null) {
            try {
                if (Build.VERSION.SDK_INT >= 24) {
                    NotificationListenerService.requestRebind(
                            new ComponentName(getContext(), MediaListenerService.class));
                }
            } catch (Throwable ignored) {
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("connecting", true);
            call.resolve(ret);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        MediaListenerService.Info info = MediaListenerService.latest();
        if (info != null) {
            JSObject p = new JSObject();
            p.put("app", appLabel(getContext().getPackageManager(), info.pkg));
            p.put("pkg", info.pkg);
            p.put("title", info.title == null ? "" : info.title);
            p.put("artist", info.artist == null ? "" : info.artist);
            p.put("album", info.album == null ? "" : info.album);
            p.put("state", info.state == null ? "" : info.state);
            p.put("updatedAt", info.updatedAt);
            ret.put("playing", p);
        } else {
            ret.put("playing", null);
        }
        call.resolve(ret);
    }

    // ================= 屏幕抓帧（TA 看到我的屏幕） =================

    @PluginMethod
    public void requestScreenCapture(PluginCall call) {
        try {
            android.media.projection.MediaProjectionManager mpm =
                    (android.media.projection.MediaProjectionManager) getContext()
                            .getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            Intent intent = mpm.createScreenCaptureIntent();
            pendingCaptureCall = call;
            startActivityForResult(call, intent, REQ_SCREEN_CAPTURE);
        } catch (Exception e) {
            call.reject("无法发起屏幕捕获：" + e.getMessage());
        }
    }

    @PluginMethod
    public void grabScreenFrame(PluginCall call) {
        ScreenCaptureService svc = ScreenCaptureService.instance;
        if (svc == null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("needSession", true);
            call.resolve(ret);
            return;
        }
        // 抓帧在后台线程（像素拷贝 + JPEG 压缩），resolve 回 JS 主线程
        new Thread(() -> {
            try {
                String dataUrl = svc.grabFrameDataUrl();
                JSObject ret = new JSObject();
                if (dataUrl != null) {
                    ret.put("ok", true);
                    ret.put("frame", dataUrl);
                    call.resolve(ret);
                } else {
                    ret.put("ok", false);
                    call.resolve(ret);
                }
            } catch (Exception e) {
                call.reject("抓帧失败：" + e.getMessage());
            }
        }, "grab-frame").start();
    }

    @PluginMethod
    public void stopScreenCapture(PluginCall call) {
        ScreenCaptureService.stopCapture();
        call.resolve();
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SCREEN_CAPTURE) {
            PluginCall call = pendingCaptureCall;
            pendingCaptureCall = null;
            if (call == null) return;
            JSObject ret = new JSObject();
            if (resultCode == Activity.RESULT_OK && data != null) {
                Intent svc = new Intent(getContext(), ScreenCaptureService.class);
                svc.putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode);
                svc.putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data);
                if (Build.VERSION.SDK_INT >= 26) {
                    getContext().startForegroundService(svc);
                } else {
                    getContext().startService(svc);
                }
                ret.put("ok", true);
            } else {
                ret.put("ok", false);
                ret.put("canceled", true);
            }
            call.resolve(ret);
        }
    }
}
