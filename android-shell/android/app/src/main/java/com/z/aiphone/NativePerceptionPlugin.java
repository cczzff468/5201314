package com.z.aiphone;

import android.app.Activity;
import android.app.AppOpsManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.media.AudioManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.Process;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 原生感知插件（网页 window.Capacitor.Plugins.NativePerception）：
 *
 * 【v2.0.0 去 Shizuku 化大重构】全部真机能力改由安卓原生系统 API + 无障碍服务实现，
 * Shizuku 相关（binder 授权 / UserService AIDL / shell 白名单执行 / dumpsys /
 * screencap / uiautomator / ime 切换）全部移除：
 *
 * ① UsageStats 真机感知（不变）：getUsageSnapshot —— UsageStatsManager.queryEvents
 *    事件流配对聚合（RESUMED→PAUSED、息屏/锁屏即结算、今日裁剪、桌面排除）。
 *
 * ② 无障碍能力组（新）：accessibilityPermission / openAccessibilitySettings /
 *    a11yScreenshot（API30+ 静默截屏）/ a11yTap / a11ySwipe / a11yKey / a11yInput /
 *    getScreenSize / getForegroundApp（事件流前台，替代 dumpsys window）。
 *
 * ③ 应用锁定遮罩组（新，替代 pm suspend）：lockApp / unlockApp +
 *    jealousyGuardSyncLock / jealousyGuardStatus / jealousyGuardDrainEvents ——
 *    LockOverlayService 以 UsageStats 3s 轮询 + SYSTEM_ALERT_WINDOW 全屏遮罩实现拦截。
 *
 * ④ 主动拉起（新，替代 am start）：bringToFront（FLAG_ACTIVITY_NEW_TASK 拉回本
 *    App 聊天）/ openApp（任意应用 LaunchIntent）。
 *
 * ⑤ 消息读取组（新，替代 content/dumpsys shell）：getRecentSMS（ContentResolver
 *    读短信收件箱）/ getRecentNotifications（MediaListenerService 通知环形缓冲）。
 *
 * ⑥ 原生信息组（新，替代 dumpsys）：getBatteryStatus（BatteryManager 粘性广播）/
 *    getVolume / setVolume（AudioManager）/ listInstalledApps（PackageManager）。
 *
 * ⑦ 媒体感知（不变）：NotificationListenerService（MediaListenerService）正在听什么歌。
 *
 * ⑧ 屏幕抓帧（不变）：MediaProjection 授权流（无障碍截屏的备选通道）。
 *
 * ⑨ 权限中心 11 项（新）：无障碍 / 使用情况 / 悬浮窗 / 通知使用 / 短信 / 通讯录 /
 *    日历 / 闹钟 / 位置 / 媒体文件 / 电池优化 —— 状态查询 + 原生 Intent 直达授权页。
 *
 * ⑩ Mobile Agent 底座（保留）：agentShouldStop / agentResetStop / agentNotify /
 *    agentNotifyEnd / localNotify（点击直达）/ setVolumeKeyTurn。
 */
@CapacitorPlugin(
    name = "NativePerception",
    permissions = {
        // v1.6.1 语音唤起修复：麦克风运行时权限（Manifest 已声明 RECORD_AUDIO）
        @Permission(strings = { android.Manifest.permission.RECORD_AUDIO }, alias = "microphone"),
        // Android 13+ 通知运行时权限（设置页「允许通知」开关用）
        @Permission(strings = { android.Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications"),
        // v1.9.36 位置运行时权限
        @Permission(strings = {
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.ACCESS_COARSE_LOCATION
        }, alias = "location"),
        // v2.0.0 读取短信（危险权限；getRecentSMS 工具与权限中心共用）
        @Permission(strings = { android.Manifest.permission.READ_SMS }, alias = "sms"),
        // v2.0.0 通讯录读写
        @Permission(strings = {
                android.Manifest.permission.READ_CONTACTS,
                android.Manifest.permission.WRITE_CONTACTS
        }, alias = "contacts"),
        // v2.0.0 日历读写
        @Permission(strings = {
                android.Manifest.permission.READ_CALENDAR,
                android.Manifest.permission.WRITE_CALENDAR
        }, alias = "calendar"),
        // v2.0.0 媒体文件（Android 13+ 细分媒体权限组）
        @Permission(strings = {
                android.Manifest.permission.READ_MEDIA_IMAGES,
                android.Manifest.permission.READ_MEDIA_VIDEO,
                android.Manifest.permission.READ_MEDIA_AUDIO
        }, alias = "mediaFiles33"),
        // v2.0.0 媒体文件（Android 12 及以下：旧存储权限）
        @Permission(strings = { android.Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "mediaFilesLegacy")
    }
)
public class NativePerceptionPlugin extends Plugin {

    private static final int REQ_SCREEN_CAPTURE = 2;

    /** 跨零点会话回看窗口：事件查询从「今日 0 点 - 2h」起，聚合时按今日裁剪 */
    private static final long SESSION_LOOKBACK_MS = 2 * 3600_000L;
    /** 同 App 内部 Activity 切换判定阈值：PAUSED→RESUMED 间隔小于此值视为同一次使用 */
    private static final long INTRA_APP_GAP_MS = 3000L;

    private PluginCall pendingCaptureCall;

    // ================= 事件模型（UsageStats 聚合口径） =================

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

    // ================= UsageStats（真机感知 · 原生引擎） =================

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
     * 今日前台会话聚合（v2.0.0 仅原生引擎；source 参数保留兼容但一律走原生）：
     * 事件级配对计时（RESUMED→PAUSED），息屏/锁屏/切走即停止计时；
     * 桌面 Launcher 只用于结算上一会话，自身时长不计入（数字健康口径）；
     * 带回看窗口 + 按今日裁剪（跨零点长会话不丢、不串天）。
     */
    @PluginMethod
    public void getUsageSnapshot(PluginCall call) {
        if (!checkUsagePermission()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("needPermission", true);
            call.resolve(ret);
            return;
        }
        try {
            long now = System.currentTimeMillis();
            long startOfDay = startOfDay(now);
            List<Ev> evs = queryEventsList(startOfDay - SESSION_LOOKBACK_MS, now);
            JSObject ret = buildSnapshot(evs, startOfDay, now);
            ret.put("ok", true);
            ret.put("engine", "native");
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
            out.add(new Ev(ev.getTimeStamp(), t, ev.getPackageName()));
        }
        return out;
    }

    /**
     * 会话聚合：todayApps/current/recentApps/history（v1.2.1 口径）：
     * 回看裁剪 / Launcher 排除 / 同 App 内页面切换不重复计数 /
     * 息屏、锁屏、关机即停 + 解锁后自动续计原 App。
     */
    private JSObject buildSnapshot(List<Ev> evs, long startOfDay, long now) {
        final PackageManager pm = getContext().getPackageManager();
        final String launcherPkg = defaultLauncherPkg();

        final Map<String, Long> durationByApp = new HashMap<>();
        final Map<String, Integer> opensByApp = new HashMap<>();
        final Map<String, Long> lastOpenByApp = new HashMap<>();
        final List<Long> historyTs = new ArrayList<>();
        final List<String> historyPkgs = new ArrayList<>();

        String openApp = null;
        long openStart = 0;
        String lastApp = null;
        long lastAppStart = 0;
        String lastClosedPkg = null;
        long lastClosedTs = 0;
        String autoResumePkg = null;
        boolean keyguardArmed = false;

        String longestApp = null;
        long longestMs = 0;
        int switchCount = 0;

        for (Ev ev : evs) {
            long ts = ev.ts;
            if (ts > now + 60_000L) continue;

            if (ev.type == Ev.T_RESUMED) {
                autoResumePkg = null;
                if (openApp != null && ts > openStart) {
                    long dur = settle(durationByApp, openApp, openStart, ts, startOfDay, now);
                    if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
                    lastClosedPkg = openApp;
                    lastClosedTs = ts;
                }
                if (ev.pkg == null || ev.pkg.equals(launcherPkg)) {
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
            } else if (ev.type == Ev.T_CLOSED) {
                if (openApp != null && openApp.equals(ev.pkg)) {
                    long dur = settle(durationByApp, openApp, openStart, ts, startOfDay, now);
                    if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
                    lastClosedPkg = openApp;
                    lastClosedTs = ts;
                    openApp = null;
                }
            } else if (ev.type == Ev.T_SCREEN_OFF || ev.type == Ev.T_KEYGUARD_SHOWN || ev.type == Ev.T_SHUTDOWN) {
                if (ev.type == Ev.T_KEYGUARD_SHOWN) keyguardArmed = true;
                if (openApp != null && ts > openStart) {
                    long dur = settle(durationByApp, openApp, openStart, ts, startOfDay, now);
                    if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
                    lastClosedPkg = openApp;
                    lastClosedTs = ts;
                    autoResumePkg = openApp;
                    openApp = null;
                }
                if (ev.type == Ev.T_SHUTDOWN) {
                    autoResumePkg = null;
                    keyguardArmed = false;
                }
            } else if (ev.type == Ev.T_KEYGUARD_HIDDEN) {
                keyguardArmed = false;
                if (openApp == null && autoResumePkg != null
                        && (launcherPkg == null || !autoResumePkg.equals(launcherPkg))) {
                    openApp = autoResumePkg;
                    openStart = ts;
                }
                autoResumePkg = null;
            } else if (ev.type == Ev.T_SCREEN_ON) {
                if (!keyguardArmed && openApp == null && autoResumePkg != null
                        && (launcherPkg == null || !autoResumePkg.equals(launcherPkg))) {
                    openApp = autoResumePkg;
                    openStart = ts;
                    autoResumePkg = null;
                }
            } else { // T_BOOT
                openApp = null;
                autoResumePkg = null;
                keyguardArmed = false;
            }
        }

        SimpleDateFormat hhmm = new SimpleDateFormat("HH:mm", Locale.getDefault());

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

    // ================= 无障碍服务（权限 + 能力组） =================

    /** 无障碍服务是否已开启（enabled_accessibility_services 含本服务组件） */
    private boolean checkA11yEnabled() {
        if (AiAccessibilityService.isConnected()) return true;
        try {
            String flat = Settings.Secure.getString(
                    getContext().getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            return flat != null && flat.contains(getContext().getPackageName() + "/.AiAccessibilityService");
        } catch (Exception e) {
            return false;
        }
    }

    /** 无障碍服务权限状态（特殊权限：无运行时弹框，只能引导到系统设置页开启） */
    @PluginMethod
    public void accessibilityPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", checkA11yEnabled());
        ret.put("connected", AiAccessibilityService.isConnected());
        ret.put("canAsk", true); // 随时可跳系统设置页
        call.resolve(ret);
    }

    /** 跳系统「无障碍」设置页（用户手动找到「AI Phone」开启服务） */
    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开系统设置：" + e.getMessage());
        }
    }

    /**
     * 无障碍静默截屏（API 30+）：AiAccessibilityService.takeScreenshot → 宽 ≤720
     * 降采样 JPEG base64 dataURL（与旧 shizukuScreencap 输出同构）。
     * → {ok:true, frame} / {ok:false, reason:no-a11y|not-supported|empty|failed}
     */
    @PluginMethod
    public void a11yScreenshot(PluginCall call) {
        final AiAccessibilityService svc = AiAccessibilityService.instance;
        if (svc == null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "no-a11y");
            call.resolve(ret);
            return;
        }
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<String> frameRef = new AtomicReference<>(null);
        final AtomicReference<String> errRef = new AtomicReference<>("timeout");
        try {
            svc.shootScreenshot((dataUrl, error) -> {
                frameRef.set(dataUrl);
                errRef.set(error);
                latch.countDown();
            });
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "failed");
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            try {
                latch.await(12, TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
            }
            JSObject ret = new JSObject();
            String frame = frameRef.get();
            String err = errRef.get();
            if (frame != null && !frame.isEmpty()) {
                ret.put("ok", true);
                ret.put("frame", frame);
            } else {
                ret.put("ok", false);
                ret.put("reason", err == null ? "failed" : err);
            }
            call.resolve(ret);
        }, "a11y-screenshot").start();
    }

    /** 模拟点击（无障碍 dispatchGesture）→ {ok} / {ok:false, reason:no-a11y} */
    @PluginMethod
    public void a11yTap(PluginCall call) {
        Integer x = call.getInt("x", null);
        Integer y = call.getInt("y", null);
        AiAccessibilityService svc = AiAccessibilityService.instance;
        if (svc == null) {
            resolveA11yUnavailable(call);
            return;
        }
        if (x == null || y == null) {
            call.reject("缺少 x/y 参数");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ok", svc.tap(x, y));
        call.resolve(ret);
    }

    /** 模拟滑动（无障碍 dispatchGesture）→ {ok} */
    @PluginMethod
    public void a11ySwipe(PluginCall call) {
        Integer x1 = call.getInt("x1", null);
        Integer y1 = call.getInt("y1", null);
        Integer x2 = call.getInt("x2", null);
        Integer y2 = call.getInt("y2", null);
        int dur = call.getInt("duration", 300);
        AiAccessibilityService svc = AiAccessibilityService.instance;
        if (svc == null) {
            resolveA11yUnavailable(call);
            return;
        }
        if (x1 == null || y1 == null || x2 == null || y2 == null) {
            call.reject("缺少坐标参数");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ok", svc.swipe(x1, y1, x2, y2, dur));
        call.resolve(ret);
    }

    /** 模拟按键（无障碍 performGlobalAction：back/home/recents/notifications/lock）→ {ok} */
    @PluginMethod
    public void a11yKey(PluginCall call) {
        String key = call.getString("key", "");
        AiAccessibilityService svc = AiAccessibilityService.instance;
        if (svc == null) {
            resolveA11yUnavailable(call);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ok", key != null && svc.globalAction(key));
        call.resolve(ret);
    }

    /**
     * 文本输入（无障碍 ACTION_SET_TEXT：向当前焦点输入框整体注入）。
     * → {ok:true} / {ok:false, reason:no-a11y|no-focus|not-editable|failed}
     */
    @PluginMethod
    public void a11yInput(PluginCall call) {
        String text = call.getString("text", "");
        AiAccessibilityService svc = AiAccessibilityService.instance;
        if (svc == null) {
            resolveA11yUnavailable(call);
            return;
        }
        if (text == null || text.isEmpty()) {
            call.reject("缺少 text 参数");
            return;
        }
        int code = svc.inputText(text);
        JSObject ret = new JSObject();
        ret.put("ok", code == 0);
        ret.put("reason", code == 0 ? "" : (code == 1 ? "no-focus" : code == 2 ? "not-editable" : "failed"));
        call.resolve(ret);
    }

    private void resolveA11yUnavailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("reason", "no-a11y");
        call.resolve(ret);
    }

    /** 屏幕像素尺寸（滑动坐标换算用；无障碍窗口表优先，DisplayMetrics 兜底） */
    @PluginMethod
    public void getScreenSize(PluginCall call) {
        JSObject ret = new JSObject();
        int[] wh = null;
        if (AiAccessibilityService.instance != null) {
            wh = AiAccessibilityService.instance.screenSize();
        }
        if (wh == null) {
            android.util.DisplayMetrics dm = getContext().getResources().getDisplayMetrics();
            if (dm.widthPixels > 0 && dm.heightPixels > 0) wh = new int[]{dm.widthPixels, dm.heightPixels};
        }
        if (wh != null) {
            ret.put("ok", true);
            ret.put("width", wh[0]);
            ret.put("height", wh[1]);
        } else {
            ret.put("ok", false);
            ret.put("reason", "unavailable");
        }
        call.resolve(ret);
    }

    /**
     * 当前前台应用（v2.0.0 替代 dumpsys window）：
     * 无障碍事件流优先（毫秒级实时）；未开无障碍 → UsageStats 近 20s 事件兜底。
     * → {ok:true, app, name, via:'a11y'|'usage'} / {ok:false, reason:no-permission}
     */
    @PluginMethod
    public void getForegroundApp(PluginCall call) {
        final PackageManager pm = getContext().getPackageManager();
        AiAccessibilityService.ForegroundInfo fg = AiAccessibilityService.currentForeground();
        if (fg != null) {
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("app", fg.pkg);
            ret.put("name", appLabel(pm, fg.pkg));
            ret.put("via", "a11y");
            ret.put("at", fg.at);
            call.resolve(ret);
            return;
        }
        // UsageStats 兜底（需「使用情况」权限）
        if (checkUsagePermission()) {
            new Thread(() -> {
                String pkg = lastResumedPkg(System.currentTimeMillis() - 20_000L, System.currentTimeMillis());
                JSObject ret = new JSObject();
                if (pkg != null && !pkg.isEmpty()) {
                    ret.put("ok", true);
                    ret.put("app", pkg);
                    ret.put("name", appLabel(pm, pkg));
                    ret.put("via", "usage");
                } else {
                    ret.put("ok", false);
                    ret.put("reason", "unknown");
                }
                call.resolve(ret);
            }, "fg-usage").start();
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("reason", "no-permission");
        call.resolve(ret);
    }

    /** UsageStats 查询窗口内最近一条 ACTIVITY_RESUMED 的包名 */
    private String lastResumedPkg(long from, long to) {
        try {
            UsageStatsManager usm = (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return null;
            UsageEvents events = usm.queryEvents(from, to);
            UsageEvents.Event ev = new UsageEvents.Event();
            String last = null;
            while (events.hasNextEvent()) {
                events.getNextEvent(ev);
                if (ev.getEventType() == UsageEvents.Event.ACTIVITY_RESUMED) {
                    String p = ev.getPackageName();
                    if (p != null) last = p;
                }
            }
            return last;
        } catch (Throwable t) {
            return null;
        }
    }

    // ================= 主动拉起（替代 am start / monkey） =================

    /**
     * 把本 App 强行拉到前台（吃醋拉回/切回聊天）：FLAG_ACTIVITY_NEW_TASK。
     * MainActivity launchMode=singleTask：已运行只重排到前，不重开实例。
     *
     * v2.2.0 「在别的 App 切不回来」根修：Android 10+ 后台启动 Activity 限制——
     * App 在后台时普通 startActivity 会被系统静默拦截（不抛异常、只是没反应），这正是
     * 机主实测「我让 AI 切回聊天界面，但没切回来」的根因。修复策略：
     * ① App 在前台 → 直接 startActivity；
     * ② App 在后台 + 已授悬浮窗权限（SYSTEM_ALERT_WINDOW）→ 持有 overlay 视图的应用
     *    豁免后台启动限制，startActivity 直达；
     * ③ App 在后台 + 无悬浮窗权限 → 无法绕过（系统安全限制）：立刻发一条高优先级
     *    heads-up 通知（点击直达 App），返回 {ok:true, via:'notification'}——用户点
     *    一下通知即回，绝不足丢。返回 reason='no-overlay-permission' 供 JS 侧指引。
     */
    @PluginMethod
    public void bringToFront(PluginCall call) {
        try {
            boolean appVisible = MainActivity.isAppInForeground();
            boolean hasOverlay = Settings.canDrawOverlays(getContext());
            // 前台 或 后台但有悬浮窗豁免 → 直拉
            if (appVisible || hasOverlay) {
                Intent i = new Intent(getContext(), MainActivity.class);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                getContext().startActivity(i);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("via", appVisible ? "foreground" : "overlay-exempt");
                call.resolve(ret);
                return;
            }
            // 后台且无悬浮窗：系统不允许后台启动 Activity → heads-up 通知兑底
            boolean notified = sendPullbackHeadsUp();
            JSObject ret = new JSObject();
            ret.put("ok", notified);
            ret.put("via", "notification");
            if (!notified) {
                ret.put("reason", "background-blocked-no-overlay");
            }
            call.resolve(ret);
        } catch (Exception e) {
            // startActivity 抛异常（极少数 ROM）→ 通知兑底再试一次
            boolean notified = sendPullbackHeadsUp();
            JSObject ret = new JSObject();
            ret.put("ok", notified);
            ret.put("via", "notification");
            if (!notified) {
                ret.put("reason", e.getMessage() == null ? "start-failed" : e.getMessage());
            }
            call.resolve(ret);
        }
    }

    /** 拉回兑底 heads-up 通知：高优先级渠道横幅，点一下就回 App（通知点击走 localNotify 同款跳转链） */
    private boolean sendPullbackHeadsUp() {
        try {
            Context ctx = getContext();
            NotificationManager nm =
                    (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return false;
            if (Build.VERSION.SDK_INT >= 33
                    && ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
                            != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
            if (!nm.areNotificationsEnabled()) return false;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(
                        PULLBACK_CHANNEL, "拉回提醒", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("AI 把你拉回聊天的高优先级提醒（点一下即可回去）");
                ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(ch);
            }
            Intent contentIntent = new Intent(ctx, MainActivity.class);
            contentIntent.setPackage(ctx.getPackageName());
            contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            contentIntent.putExtra(EXTRA_LOCAL_NOTIFY_URL, "/");
            PendingIntent pi = PendingIntent.getActivity(ctx, 9101, contentIntent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification n = new NotificationCompat.Builder(ctx, PULLBACK_CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("回来陪我说话")
                    .setContentText("点一下这里回到聊天")
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .build();
            nm.notify("pullback", 9101, n);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 打开任意应用（PackageManager LaunchIntent，替代 monkey -p）→ {ok} / {ok:false, reason:not-found}
     *  v2.2.0：本 App 在后台且无悬浮窗权限时后台启动会被系统静默拦截——如实报
     *  no-overlay-permission（Web 侧话术指引进权限页开悬浮窗），不再假装成功。 */
    @PluginMethod
    public void openApp(PluginCall call) {
        final String pkgRaw = call.getString("pkg", "");
        final String pkg = pkgRaw == null ? "" : pkgRaw.trim();
        if (pkg.isEmpty() || !pkg.matches("^[\\w.]+$")) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "bad-pkg");
            call.resolve(ret);
            return;
        }
        // 后台 + 无悬浮窗豁免 = Android 10+ 系统必然拦下（静默失败）——前置如实反馈
        if (!MainActivity.isAppInForeground() && !Settings.canDrawOverlays(getContext())) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "no-overlay-permission");
            call.resolve(ret);
            return;
        }
        try {
            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            if (launch == null) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "not-found");
                call.resolve(ret);
                return;
            }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(launch);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", e.getMessage() == null ? "start-failed" : e.getMessage());
            call.resolve(ret);
        }
    }

    /** 已安装第三方应用清单（PackageManager；替代 pm list packages -3）→ {ok, apps:[{pkg,name}]} */
    @PluginMethod
    public void listInstalledApps(PluginCall call) {
        new Thread(() -> {
            try {
                PackageManager pm = getContext().getPackageManager();
                List<ApplicationInfo> apps = pm.getInstalledApplications(PackageManager.GET_META_DATA);
                JSArray arr = new JSArray();
                int n = 0;
                for (ApplicationInfo ai : apps) {
                    if ((ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0) continue; // 只列第三方
                    JSObject o = new JSObject();
                    o.put("pkg", ai.packageName);
                    o.put("name", pm.getApplicationLabel(ai).toString());
                    arr.put(o);
                    if (++n >= 500) break;
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("apps", arr);
                call.resolve(ret);
            } catch (Throwable t) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "failed");
                call.resolve(ret);
            }
        }, "list-apps").start();
    }

    // ================= 应用锁定遮罩（替代 pm suspend） =================

    /**
     * 锁定应用 lockApp({pkg, unlockAt?, charName?, message?})：
     * LockOverlayService 以「UsageStats 3s 轮询 + 悬浮窗全屏遮罩」拦截（无需 Shizuku）。
     * unlockAt=0/缺省=锁到哄好为止。→ {ok:true} / {ok:false, reason}
     */
    @PluginMethod
    public void lockApp(PluginCall call) {
        syncLockInner(call);
    }

    /** 解锁 unlockApp()：停遮罩停守护（哄好/手动解锁共用） */
    @PluginMethod
    public void unlockApp(PluginCall call) {
        syncLockInner(call);
    }

    /**
     * 吃醋守护锁同步 jealousyGuardSyncLock({pkg, unlockAt?, charName?, message?})：
     * 与 lockApp 同内核（方法名保留：web 侧 jealousy-lock.ts 状态机零改动兼容）。
     * pkg 空 = 解锁停守护。永不 reject，失败 {ok:false, reason}。
     */
    @PluginMethod
    public void jealousyGuardSyncLock(PluginCall call) {
        syncLockInner(call);
    }

    private void syncLockInner(PluginCall call) {
        String pkg = null;
        String charName = null;
        String message = null;
        String contactId = null;
        String appKind = null;
        long unlockAt = 0L;
        try {
            pkg = call.getString("pkg", null);
        } catch (Throwable ignored) {
        }
        try {
            charName = call.getString("charName", null);
        } catch (Throwable ignored) {
        }
        try {
            message = call.getString("message", null);
        } catch (Throwable ignored) {
        }
        // v2.2.0：锁定者联系人 id + 所在 App（拦截窗【去哄哄 TA】按钮拉起本 App 后直达聊天）
        try {
            contactId = call.getString("contactId", null);
        } catch (Throwable ignored) {
        }
        try {
            appKind = call.getString("app", null);
        } catch (Throwable ignored) {
        }
        try {
            unlockAt = call.getLong("unlockAt", 0L);
        } catch (Throwable t) {
            unlockAt = 0L;
        }
        try {
            String fail = LockOverlayService.syncLock(getContext(), pkg, unlockAt, charName, message,
                    contactId, appKind);
            JSObject ret = new JSObject();
            if (fail == null) {
                ret.put("ok", true);
            } else {
                ret.put("ok", false);
                ret.put("reason", fail);
            }
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "同步锁定失败：" + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage()));
            call.resolve(ret);
        }
    }

    /**
     * 守护状态查询 jealousyGuardStatus() → {running, pkg, unlockAt, eventCount,
     * overlayShown, usageAccess, overlayPerm}：overlayShown=遮罩当前是否盖着、
     * usageAccess/overlayPerm=两权限实时状态。查询失败不 reject，给全零安全形态。
     */
    @PluginMethod
    public void jealousyGuardStatus(PluginCall call) {
        try {
            LockOverlayService.Snapshot snap = LockOverlayService.snapshot(getContext());
            JSObject ret = new JSObject();
            ret.put("running", snap.running);
            ret.put("pkg", snap.pkg == null ? JSONObject.NULL : snap.pkg);
            ret.put("unlockAt", snap.unlockAt);
            ret.put("eventCount", snap.eventCount);
            ret.put("overlayShown", snap.overlayShown);
            ret.put("usageAccess", snap.usageAccess);
            ret.put("overlayPerm", snap.overlayPerm);
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("running", false);
            ret.put("pkg", JSONObject.NULL);
            ret.put("unlockAt", 0L);
            ret.put("eventCount", 0);
            ret.put("overlayShown", false);
            ret.put("usageAccess", false);
            ret.put("overlayPerm", false);
            ret.put("reason", t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * 取走守护事件 jealousyGuardDrainEvents() → {events:[{ts,type,pkg,text}...]}：
     * 事件类型：native-unlock（到期自动解锁）/ lock-shown（用户打开锁定 App，遮罩已弹）/
     * lock-attempt（遮罩期间仍想开）/ degrade（权限丢失）。旧事件/脏数据兼容为空数组。
     */
    @PluginMethod
    public void jealousyGuardDrainEvents(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray events = new JSArray();
        try {
            List<JSONObject> list = LockOverlayService.drainEvents(getContext());
            if (list != null) {
                for (JSONObject o : list) {
                    JSObject ev = new JSObject();
                    ev.put("ts", o.optLong("ts", 0L));
                    ev.put("type", o.optString("type", ""));
                    ev.put("pkg", o.isNull("pkg") ? JSONObject.NULL : o.optString("pkg", ""));
                    ev.put("text", o.optString("text", ""));
                    events.put(ev);
                }
            }
        } catch (Throwable ignored) {
            // 兼容旧事件：解析失败 → 空数组（drain 内已清掉脏存储，幂等可重试）
        }
        ret.put("events", events);
        call.resolve(ret);
    }

    // ================= 消息读取（短信 / 通知） =================

    /**
     * 最近短信 getRecentSMS({limit?})：ContentResolver 读收件箱（需 READ_SMS 运行时权限）。
     * → {ok:true, items:[{ts, address, body}]}（新→旧）/ {ok:false, reason:no-permission}
     */
    @PluginMethod
    public void getRecentSMS(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.READ_SMS)
                != PackageManager.PERMISSION_GRANTED) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "no-permission");
            call.resolve(ret);
            return;
        }
        int limit = 20;
        try {
            Integer l = call.getInt("limit", 20);
            if (l != null) limit = Math.max(1, Math.min(50, l));
        } catch (Throwable ignored) {
        }
        final int lim = limit;
        new Thread(() -> {
            JSObject ret = new JSObject();
            JSArray items = new JSArray();
            try {
                Cursor c = getContext().getContentResolver().query(
                        Uri.parse("content://sms/inbox"),
                        new String[]{"address", "body", "date"}, null, null, "date DESC");
                if (c != null) {
                    while (c.moveToNext() && items.length() < lim) {
                        String addr = c.getString(0);
                        String body = c.getString(1);
                        long date = c.getLong(2);
                        JSObject o = new JSObject();
                        o.put("address", addr == null ? "" : addr);
                        o.put("body", body == null ? "" : (body.length() > 300 ? body.substring(0, 300) : body));
                        o.put("ts", date);
                        items.put(o);
                    }
                    c.close();
                }
                ret.put("ok", true);
                ret.put("items", items);
            } catch (Throwable t) {
                ret.put("ok", false);
                ret.put("reason", "failed");
            }
            call.resolve(ret);
        }, "sms-read").start();
    }

    /** 短信权限状态（READ_SMS 运行时权限） */
    @PluginMethod
    public void smsPermission(PluginCall call) {
        boolean granted = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.READ_SMS)
                == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("canAsk", !granted); // 简化口径：未授予即视为可申请（持久拒绝时系统不弹框，回传如实）
        call.resolve(ret);
    }

    /** 申请短信权限（弹系统授权框；持久拒绝时 canAsk=false 引导去应用详情页） */
    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        PermissionState s = getPermissionStates().get("sms");
        if (s == PermissionState.GRANTED) {
            resolvePerm(call, true, false);
            return;
        }
        if (s == PermissionState.PROMPT) {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
            return;
        }
        resolvePerm(call, false, false);
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        boolean granted = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.READ_SMS)
                == PackageManager.PERMISSION_GRANTED;
        resolvePerm(call, granted, false);
    }

    /**
     * 最近通知 getRecentNotifications({limit?})：MediaListenerService 通知环形缓冲
     * （需「通知使用权」）。→ {ok:true, items:[{ts, pkg, app, title, text}]}
     * / {ok:false, reason:no-permission}
     */
    @PluginMethod
    public void getRecentNotifications(PluginCall call) {
        if (!checkMediaPermission()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "no-permission");
            call.resolve(ret);
            return;
        }
        if (MediaListenerService.instance == null) {
            // 有权限但服务还没连上（刚授权/进程重启）：请求重绑，本轮先回空
            try {
                NotificationListenerService.requestRebind(
                        new ComponentName(getContext(), MediaListenerService.class));
            } catch (Throwable ignored) {
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("connecting", true);
            ret.put("items", new JSArray());
            call.resolve(ret);
            return;
        }
        int limit = 20;
        try {
            Integer l = call.getInt("limit", 20);
            if (l != null) limit = Math.max(1, Math.min(50, l));
        } catch (Throwable ignored) {
        }
        PackageManager pm = getContext().getPackageManager();
        JSObject ret = new JSObject();
        JSArray items = new JSArray();
        List<MediaListenerService.NotificationRec> recs = MediaListenerService.recentNotifications(limit);
        for (MediaListenerService.NotificationRec r : recs) {
            JSObject o = new JSObject();
            o.put("ts", r.ts);
            o.put("pkg", r.pkg);
            o.put("app", appLabel(pm, r.pkg));
            o.put("title", r.title);
            o.put("text", r.text);
            items.put(o);
        }
        ret.put("ok", true);
        ret.put("items", items);
        call.resolve(ret);
    }

    // ================= 通讯录 / 日历 / 闹钟 / 媒体文件 权限（权限中心） =================

    /** 通讯录读写权限状态（READ+WRITE 都授予才算 granted） */
    @PluginMethod
    public void contactsPermission(PluginCall call) {
        boolean read = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.READ_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;
        boolean write = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.WRITE_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", read && write);
        ret.put("canAsk", !read || !write);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestContactsPermission(PluginCall call) {
        boolean read = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.READ_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;
        boolean write = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.WRITE_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;
        if (read && write) {
            resolvePerm(call, true, false);
            return;
        }
        PermissionState s = getPermissionStates().get("contacts");
        if (s == PermissionState.DENIED) {
            resolvePerm(call, false, false);
            return;
        }
        requestPermissionForAlias("contacts", call, "contactsPermissionCallback");
    }

    @PermissionCallback
    private void contactsPermissionCallback(PluginCall call) {
        boolean read = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.READ_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;
        boolean write = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.WRITE_CONTACTS)
                == PackageManager.PERMISSION_GRANTED;
        resolvePerm(call, read && write, false);
    }

    /** 日历读写权限状态 */
    @PluginMethod
    public void calendarPermission(PluginCall call) {
        boolean read = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.READ_CALENDAR)
                == PackageManager.PERMISSION_GRANTED;
        boolean write = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.WRITE_CALENDAR)
                == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", read && write);
        ret.put("canAsk", !read || !write);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestCalendarPermission(PluginCall call) {
        boolean read = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.READ_CALENDAR)
                == PackageManager.PERMISSION_GRANTED;
        boolean write = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.WRITE_CALENDAR)
                == PackageManager.PERMISSION_GRANTED;
        if (read && write) {
            resolvePerm(call, true, false);
            return;
        }
        PermissionState s = getPermissionStates().get("calendar");
        if (s == PermissionState.DENIED) {
            resolvePerm(call, false, false);
            return;
        }
        requestPermissionForAlias("calendar", call, "calendarPermissionCallback");
    }

    @PermissionCallback
    private void calendarPermissionCallback(PluginCall call) {
        boolean read = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.READ_CALENDAR)
                == PackageManager.PERMISSION_GRANTED;
        boolean write = ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.WRITE_CALENDAR)
                == PackageManager.PERMISSION_GRANTED;
        resolvePerm(call, read && write, false);
    }

    /**
     * 闹钟与计时器权限状态（API 31+ SCHEDULE_EXACT_ALARM：canScheduleExactAlarms；
     * 31 以下系统默认允许精确闹钟，恒 granted）。
     */
    @PluginMethod
    public void alarmPermission(PluginCall call) {
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                android.app.AlarmManager am = (android.app.AlarmManager)
                        getContext().getSystemService(Context.ALARM_SERVICE);
                granted = am != null && am.canScheduleExactAlarms();
            } catch (Throwable t) {
                granted = false;
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("canAsk", true);
        call.resolve(ret);
    }

    /** 申请闹钟权限（API 31+ 跳系统「闹钟和提醒」授权页；31 以下无概念直通） */
    @PluginMethod
    public void requestAlarmPermission(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        Uri.fromParts("package", getContext().getPackageName(), null));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", e.getMessage() == null ? "start-activity-failed" : e.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * 文件读写与媒体访问权限状态：
     * 33+ = READ_MEDIA_IMAGES/VIDEO/AUDIO 三项；≤32 = READ_EXTERNAL_STORAGE。
     */
    @PluginMethod
    public void mediaFilesPermission(PluginCall call) {
        Context ctx = getContext();
        boolean granted;
        if (Build.VERSION.SDK_INT >= 33) {
            granted = ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.READ_MEDIA_IMAGES)
                    == PackageManager.PERMISSION_GRANTED
                    && ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.READ_MEDIA_VIDEO)
                    == PackageManager.PERMISSION_GRANTED
                    && ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.READ_MEDIA_AUDIO)
                    == PackageManager.PERMISSION_GRANTED;
        } else {
            granted = ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.READ_EXTERNAL_STORAGE)
                    == PackageManager.PERMISSION_GRANTED;
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("canAsk", !granted);
        call.resolve(ret);
    }

    /** 申请媒体文件权限（33+ 弹细分媒体权限框；≤32 弹旧存储权限框） */
    @PluginMethod
    public void requestMediaFilesPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            PermissionState s = getPermissionStates().get("mediaFiles33");
            if (s == PermissionState.GRANTED) {
                resolvePerm(call, true, false);
                return;
            }
            if (s == PermissionState.DENIED) {
                resolvePerm(call, false, false);
                return;
            }
            requestPermissionForAlias("mediaFiles33", call, "mediaFilesPermissionCallback");
            return;
        }
        PermissionState s = getPermissionStates().get("mediaFilesLegacy");
        if (s == PermissionState.GRANTED) {
            resolvePerm(call, true, false);
            return;
        }
        if (s == PermissionState.DENIED) {
            resolvePerm(call, false, false);
            return;
        }
        requestPermissionForAlias("mediaFilesLegacy", call, "mediaFilesPermissionCallback");
    }

    @PermissionCallback
    private void mediaFilesPermissionCallback(PluginCall call) {
        Context ctx = getContext();
        boolean granted;
        if (Build.VERSION.SDK_INT >= 33) {
            granted = ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.READ_MEDIA_IMAGES)
                    == PackageManager.PERMISSION_GRANTED
                    || ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.READ_MEDIA_VIDEO)
                    == PackageManager.PERMISSION_GRANTED
                    || ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.READ_MEDIA_AUDIO)
                    == PackageManager.PERMISSION_GRANTED;
        } else {
            granted = ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.READ_EXTERNAL_STORAGE)
                    == PackageManager.PERMISSION_GRANTED;
        }
        resolvePerm(call, granted, false);
    }

    private void resolvePerm(PluginCall call, boolean granted, boolean canAsk) {
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("canAsk", canAsk);
        call.resolve(ret);
    }

    /** 跳本应用系统详情页（运行时权限被持久拒绝后的兜底入口：手动开启） */
    @PluginMethod
    public void openAppDetailSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getContext().getPackageName(), null));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开系统设置：" + e.getMessage());
        }
    }

    // ================= 原生信息（电量 / 音量） =================

    /** 电量状态（BatteryManager 粘性广播，替代 dumpsys battery）→ {ok, level, charging} */
    @PluginMethod
    public void getBatteryStatus(PluginCall call) {
        try {
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent battery = getContext().registerReceiver(null, ifilter);
            JSObject ret = new JSObject();
            if (battery != null) {
                int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                int pct = scale > 0 ? Math.round(level * 100f / scale) : -1;
                boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING
                        || status == BatteryManager.BATTERY_STATUS_FULL;
                ret.put("ok", true);
                ret.put("level", pct);
                ret.put("charging", charging);
            } else {
                ret.put("ok", false);
                ret.put("reason", "unavailable");
            }
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "failed");
            call.resolve(ret);
        }
    }

    /** 媒体音量（AudioManager，替代 media volume --stream 3）→ {ok, volume, max} */
    @PluginMethod
    public void getVolume(PluginCall call) {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            JSObject ret = new JSObject();
            if (am != null) {
                ret.put("ok", true);
                ret.put("volume", am.getStreamVolume(AudioManager.STREAM_MUSIC));
                ret.put("max", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
            } else {
                ret.put("ok", false);
                ret.put("reason", "unavailable");
            }
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "failed");
            call.resolve(ret);
        }
    }

    /** 设置媒体音量 setVolume({volume})（0~max 自动钳制）→ {ok, volume} */
    @PluginMethod
    public void setVolume(PluginCall call) {
        Integer v = call.getInt("volume", null);
        if (v == null) {
            call.reject("缺少 volume 参数");
            return;
        }
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            JSObject ret = new JSObject();
            if (am != null) {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                int vol = Math.max(0, Math.min(max, v));
                am.setStreamVolume(AudioManager.STREAM_MUSIC, vol, 0);
                ret.put("ok", true);
                ret.put("volume", vol);
            } else {
                ret.put("ok", false);
                ret.put("reason", "unavailable");
            }
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "failed");
            call.resolve(ret);
        }
    }

    // ================= 应用名解析 =================

    /**
     * 应用中文名解析（PackageManager；未安装/失败 → ok:false，网页侧兜底包名）。
     */
    @PluginMethod
    public void getAppLabel(PluginCall call) {
        final String pkgRaw = call.getString("pkg", "");
        final String pkg = pkgRaw == null ? "" : pkgRaw.trim();
        if (pkg.isEmpty() || !pkg.matches("[\\w.]+")) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "bad-pkg");
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            JSObject ret = new JSObject();
            try {
                String label = appLabel(getContext().getPackageManager(), pkg);
                if (label != null && !label.trim().isEmpty() && !label.equals(pkg)) {
                    ret.put("ok", true);
                    ret.put("label", label.trim());
                } else {
                    ret.put("ok", false);
                }
            } catch (Throwable t) {
                ret.put("ok", false);
            }
            call.resolve(ret);
        }, "app-label").start();
    }

    // ================= Mobile Agent 底座（保留，与 Shizuku 无关） =================

    /** Agent 紧急停止广播 action（通知栏「■ 紧急停止」按钮 → 本插件动态 receiver 置位） */
    public static final String AGENT_STOP_ACTION = "com.z.aiphone.AGENT_STOP_ACTION";

    /** Agent 紧急停止标志（static volatile：广播 receiver 线程置位、网页 agentShouldStop 轮询读取） */
    private static volatile boolean AGENT_ABORT = false;

    /** Agent 常驻状态通知 id（agentNotify 刷新 / agentNotifyEnd 撤销共用） */
    private static final int AGENT_NOTIFY_ID = 7788;
    /** Agent 常驻通知渠道 id（仅首次创建） */
    private static final String AGENT_NOTIFY_CHANNEL = "agent_runner";

    private BroadcastReceiver agentStopReceiver;

    /**
     * 插件接入 bridge 的标准初始化点（注册「紧急停止」广播 receiver）。
     */
    @Override
    public void load() {
        super.load();
        instanceRef = this; // v2.2.0 冷启动通知直达兜底用
        if (agentStopReceiver != null) return; // 防重入（每 bridge 实例只 load 一次）
        agentStopReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                AGENT_ABORT = true;
            }
        };
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

    // ================= 麦克风 / 通知运行时权限（保留） =================

    @PluginMethod
    public void micPermission(PluginCall call) {
        PermissionState s = getPermissionStates().get("microphone");
        JSObject ret = new JSObject();
        ret.put("granted", s == PermissionState.GRANTED);
        ret.put("canAsk", s == PermissionState.PROMPT);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestMicPermission(PluginCall call) {
        PermissionState s = getPermissionStates().get("microphone");
        if (s == PermissionState.GRANTED) {
            resolvePerm(call, true, false);
            return;
        }
        if (s == PermissionState.PROMPT) {
            requestPermissionForAlias("microphone", call, "micPermissionCallback");
            return;
        }
        resolvePerm(call, false, false);
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        PermissionState s = getPermissionStates().get("microphone");
        JSObject ret = new JSObject();
        ret.put("granted", s == PermissionState.GRANTED);
        ret.put("canAsk", s == PermissionState.PROMPT);
        call.resolve(ret);
    }

    /** 系统通知权限真实状态（areNotificationsEnabled 覆盖 13+ 运行时权限与全版本总闸） */
    @PluginMethod
    public void notificationPermission(PluginCall call) {
        Context ctx = getContext();
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        boolean granted = nm != null && nm.areNotificationsEnabled();
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("sdk", Build.VERSION.SDK_INT);
        ret.put("canAsk", Build.VERSION.SDK_INT >= 33 && !granted
                && ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33) {
            Context ctx = getContext();
            NotificationManager nm =
                    (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            JSObject ret = new JSObject();
            ret.put("granted", nm != null && nm.areNotificationsEnabled());
            ret.put("canAsk", false);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        Context ctx = getContext();
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        JSObject ret = new JSObject();
        ret.put("granted", nm != null && nm.areNotificationsEnabled());
        ret.put("canAsk", false);
        call.resolve(ret);
    }

    // ================= 悬浮窗 / 电池优化 / 位置（保留） =================

    /** 悬浮窗权限状态：Settings.canDrawOverlays 真实状态 */
    @PluginMethod
    public void overlayPermission(PluginCall call) {
        Context ctx = getContext();
        boolean granted = Settings.canDrawOverlays(ctx);
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("canAsk", true);
        call.resolve(ret);
    }

    /** 悬浮窗权限申请：跳系统「在其他应用上层显示」开关页（本 APP 条目深链直达） */
    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", e.getMessage() == null ? "start-activity-failed" : e.getMessage());
            call.resolve(ret);
        }
    }

    /** 电池优化豁免状态（是否在 Doze 白名单里） */
    @PluginMethod
    public void batteryPermission(PluginCall call) {
        Context ctx = getContext();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        boolean granted = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("canAsk", true);
        call.resolve(ret);
    }

    /** 电池优化豁免申请：系统确认弹窗（ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS） */
    @PluginMethod
    public void requestBatteryPermission(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", e.getMessage() == null ? "start-activity-failed" : e.getMessage());
            call.resolve(ret);
        }
    }

    /** 位置权限状态（精确/粗略任一授予即 granted） */
    @PluginMethod
    public void locationPermission(PluginCall call) {
        Context ctx = getContext();
        boolean fine = ContextCompat.checkSelfPermission(ctx,
                android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(ctx,
                android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", fine || coarse);
        ret.put("fine", fine);
        ret.put("coarse", coarse);
        ret.put("canAsk", !fine && !coarse);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestLocationPermission(PluginCall call) {
        boolean fine = ContextCompat.checkSelfPermission(getContext(),
                android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(getContext(),
                android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (fine || coarse) {
            resolvePerm(call, true, false);
            return;
        }
        requestPermissionForAlias("location", call, "locationPermissionCallback");
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        boolean fine = ContextCompat.checkSelfPermission(getContext(),
                android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(getContext(),
                android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", fine || coarse);
        ret.put("fine", fine);
        ret.put("coarse", coarse);
        ret.put("canAsk", false);
        call.resolve(ret);
    }

    // ================= Agent 常驻通知 + 本地通知（保留） =================

    /** Agent 执行期常驻状态通知（id 7788，渠道 agent_runner，IMPORTANCE_LOW 静默） */
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
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(
                        AGENT_NOTIFY_CHANNEL, "Agent 执行状态", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Mobile Agent 任务执行期间的常驻状态通知");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            Intent stopIntent = new Intent(AGENT_STOP_ACTION).setPackage(ctx.getPackageName());
            PendingIntent stopPi = PendingIntent.getBroadcast(ctx, 0, stopIntent,
                    PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder builder =
                    new NotificationCompat.Builder(ctx, AGENT_NOTIFY_CHANNEL)
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

    // ---------------- 本地通知（页面后台提醒统一出口） ----------------

    /** 本地通知渠道 id（与 Agent 常驻通知分开） */
    private static final String LOCAL_NOTIFY_CHANNEL = "local_notify";
    /** v2.2.0 拉回 heads-up 兑底通知渠道 */
    private static final String PULLBACK_CHANNEL = "pullback_reminder";
    /** 无 tag 本地通知的自增 id 起点（避开 Agent 常驻通知 id 7788） */
    private static final java.util.concurrent.atomic.AtomicInteger LOCAL_NOTIFY_SEQ =
            new java.util.concurrent.atomic.AtomicInteger(8100);

    /** v2.2.0 已发出的带 tag 通知登记（localNotifyCancelByTagPrefix 按前缀批量撤销用；
     * 进程内有效——重启后通知本身也被系统清了，无对账需求） */
    private static final java.util.Set<String> issuedTags =
            java.util.Collections.synchronizedSet(new java.util.HashSet<>());

    /** localNotify 可选 url / target extra 键（点击直达） */
    private static final String EXTRA_LOCAL_NOTIFY_URL = "local_notify_url";
    private static final String EXTRA_LOCAL_NOTIFY_TARGET = "local_notify_target";

    /** 本地通知 localNotify({title, body, tag?, url?, target?})：页面后台时的即时提醒 */
    @PluginMethod
    public void localNotify(PluginCall call) {
        String title = call.getString("title", "");
        String body = call.getString("body", "");
        String tag = call.getString("tag", null);
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
            if (Build.VERSION.SDK_INT >= 33
                    && ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
                            != PackageManager.PERMISSION_GRANTED) {
                ret.put("ok", false);
                ret.put("reason", "no-notification-permission");
                call.resolve(ret);
                return;
            }
            if (!nm.areNotificationsEnabled()) {
                ret.put("ok", false);
                ret.put("reason", "notifications-disabled");
                call.resolve(ret);
                return;
            }
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(
                        LOCAL_NOTIFY_CHANNEL, "应用提醒", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("页面在后台时的提醒通知（Agent 完成 / AI 来电 / 情侣小家动态等）");
                nm.createNotificationChannel(ch);
            }
            int id = (tag == null || tag.isEmpty()) ? LOCAL_NOTIFY_SEQ.getAndIncrement() : tag.hashCode();
            if (tag != null && !tag.isEmpty()) {
                issuedTags.add(tag); // v2.2.0 登记：按前缀批量撤销用
            }
            Intent contentIntent = new Intent(ctx, MainActivity.class);
            contentIntent.setPackage(ctx.getPackageName());
            contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            boolean hasDest = (url != null && !url.isEmpty()) || (target != null && !target.isEmpty());
            if (url != null && !url.isEmpty()) {
                contentIntent.putExtra(EXTRA_LOCAL_NOTIFY_URL, url);
            }
            if (target != null && !target.isEmpty()) {
                contentIntent.putExtra(EXTRA_LOCAL_NOTIFY_TARGET, target);
            }
            PendingIntent contentPi = PendingIntent.getActivity(ctx, id, contentIntent,
                    hasDest
                            ? (PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
                            : PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder builder =
                    new NotificationCompat.Builder(ctx, LOCAL_NOTIFY_CHANNEL)
                            .setSmallIcon(android.R.drawable.ic_dialog_info)
                            .setContentTitle(title == null || title.isEmpty() ? "提醒" : title)
                            .setAutoCancel(true)
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

    /** 撤销一条本地通知 localNotifyCancel({tag}) */
    @PluginMethod
    public void localNotifyCancel(PluginCall call) {
        String tag = call.getString("tag", null);
        JSObject ret = new JSObject();
        try {
            if (tag != null && !tag.isEmpty()) {
                NotificationManager nm =
                        (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.cancel(tag, tag.hashCode());
                    issuedTags.remove(tag);
                }
            }
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * v2.2.0 按前缀批量撤销本地通知 localNotifyCancelByTagPrefix({prefix})：
     * 进聊天界面后清掉所有未读的聊天消息通知（等价 LocalNotifications.removeAll，但只清
     * 本 App 发的聊天通知——常驻守护/锁定守护等系统常驻通知不受影响）。
     */
    @PluginMethod
    public void localNotifyCancelByTagPrefix(PluginCall call) {
        String prefix = call.getString("prefix", "");
        JSObject ret = new JSObject();
        try {
            int n = 0;
            if (prefix != null && !prefix.isEmpty()) {
                NotificationManager nm =
                        (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    String[] snapshot;
                    synchronized (issuedTags) {
                        snapshot = issuedTags.toArray(new String[0]);
                    }
                    for (String t : snapshot) {
                        if (t != null && t.startsWith(prefix)) {
                            nm.cancel(t, t.hashCode());
                            issuedTags.remove(t);
                            n++;
                        }
                    }
                }
            }
            ret.put("ok", true);
            ret.put("canceled", n);
            call.resolve(ret);
        } catch (Throwable t) {
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
            call.resolve(ret);
        }
    }

    // ---------------- 通知点击 → 目的地回传 WebView ----------------

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null) return;
        String url = intent.getStringExtra(EXTRA_LOCAL_NOTIFY_URL);
        String targetJson = intent.getStringExtra(EXTRA_LOCAL_NOTIFY_TARGET);
        boolean hasUrl = url != null && !url.isEmpty();
        boolean hasTarget = targetJson != null && !targetJson.isEmpty();
        if (!hasUrl && !hasTarget) return;
        injectLocalNotifyOpen(hasUrl ? url : null, hasTarget ? targetJson : null);
    }

    /** 向 WebView 注入 'local-notify-open' 事件（权限闸/渠道/去重等既有逻辑全部不变） */
    private void injectLocalNotifyOpen(String url, String targetJson) {
        try {
            Bridge bridge = getBridge();
            if (bridge == null) return;
            StringBuilder js = new StringBuilder("(function(){try{var d={");
            js.append(url != null ? "url:" + JSONObject.quote(url) : "");
            js.append("};");
            if (targetJson != null) {
                try {
                    Object parsed = new JSONTokener(targetJson).nextValue();
                    if (parsed instanceof JSONObject) {
                        js.append("try{var t=JSON.parse(")
                                .append(JSONObject.quote(targetJson))
                                .append(");if(t&&typeof t==='object')d.target=t;}catch(e){}");
                    }
                } catch (Throwable ignore) {
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
            // 注入失败静默
        }
    }

    /**
     * v2.2.0 冷启动通知直达兜底（MainActivity.onCreate 延迟调用）：
     * App 被杀后点通知拉起时 handleOnNewIntent 不会触发——这里经插件实例补注入。
     * 首个插件实例延迟 1.8s 后 bridge 已就绪；找不到实例时静默（用户落在首页）。
     */
    public static void injectPendingOpenFromColdBoot(String url, String targetJson) {
        try {
            if ((url == null || url.isEmpty()) && (targetJson == null || targetJson.isEmpty())) return;
            NativePerceptionPlugin plugin = instanceRef;
            if (plugin == null || plugin.getBridge() == null) {
                // bridge 未就绪：再等 1.5s 兜一次（WebView 加载慢的机器）
                final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
                h.postDelayed(() -> {
                    try {
                        NativePerceptionPlugin p2 = instanceRef;
                        if (p2 != null && p2.getBridge() != null) {
                            p2.injectLocalNotifyOpen(url, targetJson);
                        }
                    } catch (Throwable ignored) {
                    }
                }, 1500L);
                return;
            }
            plugin.injectLocalNotifyOpen(url, targetJson);
        } catch (Throwable ignored) {
            // 冷启动兜底绝不 crash
        }
    }

    /** v2.2.0 插件实例引用（冷启动注入兜底用；load 赋值 / unload 清空） */
    private static volatile NativePerceptionPlugin instanceRef;

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

    /** 「通知使用权」是否已授予本 APP */
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

    /** 当前正在播放的媒体（歌名/歌手/专辑/状态） */
    @PluginMethod
    public void getNowPlaying(PluginCall call) {
        if (!checkMediaPermission()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("needPermission", true);
            call.resolve(ret);
            return;
        }
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

    // ================= v2.1.0 修改系统设置（WRITE_SETTINGS：亮度/铃声）+ 常驻守护 + 开机自启 =================

    /** 修改系统设置权限状态（Settings.System.canWrite；WRITE_SETTINGS 特殊权限经系统开关页授予） */
    @PluginMethod
    public void writeSettingsPermission(PluginCall call) {
        boolean granted = Settings.System.canWrite(getContext());
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("canAsk", true); // 特殊权限：随时可跳系统开关页
        call.resolve(ret);
    }

    /** 跳系统「可修改系统设置」开关页（本 APP 条目深链直达） */
    @PluginMethod
    public void openWriteSettings(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent i = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS,
                    Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开系统设置：" + e.getMessage());
        }
    }

    /**
     * 读当前屏幕亮度 getBrightness() → {ok, percent(1-100), auto(自动亮度开)}。
     * 统一按「修改系统设置」权限门控（权限没开时给一致的降级口径引导开启）。
     */
    @PluginMethod
    public void getBrightness(PluginCall call) {
        try {
            if (!Settings.System.canWrite(getContext())) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "no-write-settings");
                call.resolve(ret);
                return;
            }
            int mode = Settings.System.getInt(getContext().getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS_MODE, 0);
            int raw = Settings.System.getInt(getContext().getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS, 128);
            int percent = Math.max(1, Math.min(100, Math.round(raw * 100f / 255f)));
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("percent", percent);
            ret.put("auto", mode == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC);
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? "read-failed" : t.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * 调屏幕亮度 setBrightness({percent:1-100})：先切手动亮度模式（自动模式下系统会盖掉
     * 手动值）再写 SCREEN_BRIGHTNESS（2-255 钳制，防全黑）。需「修改系统设置」权限。
     */
    @PluginMethod
    public void setBrightness(PluginCall call) {
        try {
            if (!Settings.System.canWrite(getContext())) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "no-write-settings");
                call.resolve(ret);
                return;
            }
            int percent = 50;
            try {
                percent = call.getInt("percent", 50);
            } catch (Throwable ignored) {
            }
            percent = Math.max(1, Math.min(100, percent));
            int raw = Math.max(2, Math.min(255, Math.round(percent * 255f / 100f)));
            // 自动亮度 → 手动（个别 ROM 拒绝时仍尝试直接写亮度值）
            try {
                Settings.System.putInt(getContext().getContentResolver(),
                        Settings.System.SCREEN_BRIGHTNESS_MODE,
                        Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
            } catch (Throwable ignored) {
            }
            boolean ok = Settings.System.putInt(getContext().getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS, raw);
            JSObject ret = new JSObject();
            ret.put("ok", ok);
            if (ok) ret.put("percent", percent);
            else ret.put("reason", "write-failed");
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? "write-failed" : t.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * 设置铃声模式 setRingerMode({mode: silent|vibrate|normal})：
     * 优先 AudioManager.setRingerMode（Android 24+ 静音需「勿扰/通知策略访问」，部分 ROM 才放开）；
     * 校验未生效 → 降级 setStreamVolume(STREAM_RING)（静音=零铃声量、正常=六成音量恢复；
     * vibrate 无音量等价物只能走 ringerMode）。
     */
    @PluginMethod
    public void setRingerMode(PluginCall call) {
        String mode = "normal";
        try {
            mode = call.getString("mode", "normal");
        } catch (Throwable ignored) {
        }
        if (mode == null) mode = "normal";
        mode = mode.trim().toLowerCase(Locale.ROOT);
        if (!mode.equals("silent") && !mode.equals("vibrate") && !mode.equals("normal")) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", "bad-mode");
            call.resolve(ret);
            return;
        }
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "no-audio-manager");
                call.resolve(ret);
                return;
            }
            int target = mode.equals("silent") ? AudioManager.RINGER_MODE_SILENT
                    : mode.equals("vibrate") ? AudioManager.RINGER_MODE_VIBRATE
                    : AudioManager.RINGER_MODE_NORMAL;
            String via = "ringer-mode";
            boolean ok = false;
            try {
                am.setRingerMode(target);
                ok = am.getRingerMode() == target;
            } catch (Throwable ignored) {
                ok = false;
            }
            if (!ok && !mode.equals("vibrate")) {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_RING);
                int v = mode.equals("silent") ? 0 : Math.max(1, Math.round(max * 0.6f));
                try {
                    am.setStreamVolume(AudioManager.STREAM_RING, v, 0);
                    via = "ring-volume";
                    ok = true;
                } catch (Throwable ignored) {
                    ok = false;
                }
            }
            JSObject ret = new JSObject();
            ret.put("ok", ok);
            if (ok) {
                ret.put("mode", mode);
                ret.put("via", via);
            } else {
                ret.put("reason", "set-failed");
            }
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? "set-failed" : t.getMessage());
            call.resolve(ret);
        }
    }

    // ---------------- 常驻守护（前台服务）+ 开机自启动 ----------------

    /** 开启常驻守护（拉起 KeepAliveService「AI Phone 正在守候」前台服务 + 记自启开关） */
    @PluginMethod
    public void keepAliveStart(PluginCall call) {
        String fail = KeepAliveService.start(getContext());
        JSObject ret = new JSObject();
        ret.put("ok", fail == null);
        if (fail != null) ret.put("reason", fail);
        call.resolve(ret);
    }

    /** 关闭常驻守护（停服务 + 清自启开关，BootReceiver 不再自启） */
    @PluginMethod
    public void keepAliveStop(PluginCall call) {
        KeepAliveService.stop(getContext());
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** 守护状态快照：{running(服务存活), enabled(开机自启开关), bootPerm(RECEIVE_BOOT_COMPLETED 已授予)} */
    @PluginMethod
    public void keepAliveStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("running", KeepAliveService.isRunning());
        ret.put("enabled", KeepAliveService.isEnabled(ctx));
        ret.put("bootPerm", bootPermGranted(ctx));
        call.resolve(ret);
    }

    /** 开机自启动权限状态：granted=RECEIVE_BOOT_COMPLETED（普通权限安装即授予）；
     *  enabled=常驻守护开关（BootReceiver 只在 enabled 时拉起服务）。
     *  国产 ROM 的自启动管理在 ROM 侧，需用户在系统设置里手动允许。 */
    @PluginMethod
    public void bootAutoStartStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", bootPermGranted(getContext()));
        ret.put("enabled", KeepAliveService.isEnabled(getContext()));
        ret.put("canAsk", true);
        call.resolve(ret);
    }

    private boolean bootPermGranted(Context ctx) {
        try {
            return ctx.getPackageManager().checkPermission(
                    "android.permission.RECEIVE_BOOT_COMPLETED", ctx.getPackageName())
                    == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    // ================= 屏幕抓帧（MediaProjection 备选通道） =================

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

    /** 音量键翻页直通开关（阅读 App 进/出阅读器与开关联动时同步） */
    @PluginMethod
    public void setVolumeKeyTurn(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled"));
        MainActivity.volumeKeyTurn = enabled;
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("enabled", enabled);
        call.resolve(ret);
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
