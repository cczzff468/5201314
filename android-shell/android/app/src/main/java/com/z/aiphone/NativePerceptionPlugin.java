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
import android.view.WindowManager;

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
        @Permission(strings = { android.Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "mediaFilesLegacy"),
        // v2.3.0 发送短信（SmsManager 静默发送）
        @Permission(strings = { android.Manifest.permission.SEND_SMS }, alias = "sendSms"),
        // v2.3.0 直接拨打电话（ACTION_CALL；未授权时降级拉拨号盘）
        @Permission(strings = { android.Manifest.permission.CALL_PHONE }, alias = "callPhone")
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
        final boolean appVisible = MainActivity.isAppInForeground();
        final boolean hasOverlayPerm = Settings.canDrawOverlays(getContext());
        // 前台 → 直拉；后台但有悬浮窗权限 → v2.2.5 F-8 根修：先垫一个即时小悬浮窗，
        // 让本 App 在 startActivity 那一刻持有「可见窗口」——Android 10+ 后台启动
        // Activity 的豁免条件是「调用瞬间存在可见窗口」，光有悬浮窗权限不算数
        // （这正是机主实测「显示[switchToChat]但手机没反应」的根因：startActivity
        // 被系统静默吞掉、旧代码还回 ok:true）；无悬浮窗权限 → heads-up 通知兑底。
        if (appVisible || hasOverlayPerm) {
            final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
            main.post(() -> {
                final android.view.View balWin = appVisible ? null : addBalExemptionOverlay();
                boolean launched = true;
                try {
                    Intent i = new Intent(getContext(), MainActivity.class);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    getContext().startActivity(i);
                } catch (Throwable t) {
                    launched = false;
                }
                if (!launched) {
                    if (balWin != null) removeViewQuietly(balWin);
                    sendPullbackHeadsUp(); // 极个别 ROM 仍拦 → 高优先级通知兑底
                } else if (balWin != null) {
                    // 豁免窗口使命完成（startActivity 已放行），800ms 后撤下
                    main.postDelayed(() -> removeViewQuietly(balWin), 800L);
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("via", appVisible ? "foreground" : (launched ? "overlay-window" : "notification"));
                call.resolve(ret);
            });
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
    }

    /**
     * v2.2.5 F-8：BAL 豁免小悬浮窗——1dp 全透明 TYPE_APPLICATION_OVERLAY 窗口，
     * addView 即刻生效（悬浮窗不需要后台启动豁免），随后 startActivity 因本 App
     * 持有可见窗口被系统放行。必须在主线程调用（WindowManager 视图线程亲和）。
     * 返回 null=添加失败（权限被回收等），调用方按实际结果走兑底。
     */
    private android.view.View addBalExemptionOverlay() {
        try {
            if (!Settings.canDrawOverlays(getContext())) return null;
            WindowManager wm = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
            if (wm == null) return null;
            android.view.View v = new android.view.View(getContext());
            v.setBackgroundColor(android.graphics.Color.TRANSPARENT);
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    1, 1,
                    Build.VERSION.SDK_INT >= 26
                            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                            : WindowManager.LayoutParams.TYPE_PHONE,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                    android.graphics.PixelFormat.TRANSLUCENT);
            wm.addView(v, lp);
            return v;
        } catch (Throwable t) {
            return null;
        }
    }

    /** 静默移除一个 WindowManager 视图（豁免窗收尾；失败忽略） */
    private void removeViewQuietly(android.view.View v) {
        try {
            WindowManager wm = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
            if (wm != null) wm.removeView(v);
        } catch (Throwable ignored) {
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
     *  no-overlay-permission（Web 侧话术指引进权限页开悬浮窗），不再假装成功。
     *  v2.2.5：有悬浮窗权限时与 bringToFront 同款 BAL 豁免小窗垫底，startActivity
     *  才真正放行（旧版有权限但无可见窗口同样被静默吞）。 */
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
        final boolean appVisible = MainActivity.isAppInForeground();
        if (!appVisible && !Settings.canDrawOverlays(getContext())) {
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
            if (!appVisible) {
                // v2.2.5 BAL 豁免：先垫可见小悬浮窗再 startActivity（同 bringToFront）
                final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
                main.post(() -> {
                    android.view.View balWin = addBalExemptionOverlay();
                    try {
                        getContext().startActivity(launch);
                    } catch (Throwable t) {
                        if (balWin != null) removeViewQuietly(balWin);
                        JSObject ret1 = new JSObject();
                        ret1.put("ok", false);
                        ret1.put("reason", t.getMessage() == null ? "start-failed" : t.getMessage());
                        call.resolve(ret1);
                        return;
                    }
                    if (balWin != null) main.postDelayed(() -> removeViewQuietly(balWin), 800L);
                    JSObject ret2 = new JSObject();
                    ret2.put("ok", true);
                    call.resolve(ret2);
                });
                return;
            }
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

    /** v2.3.0：AudioManager 流名 → STREAM 常量（setVolume/getVolume 的 stream 参数） */
    private int streamOfName(String stream) {
        if (stream == null) return AudioManager.STREAM_MUSIC;
        switch (stream.trim().toLowerCase(Locale.ROOT)) {
            case "alarm": case "闹钟": return AudioManager.STREAM_ALARM;
            case "ring": case "铃声": case "来电": return AudioManager.STREAM_RING;
            case "call": case "通话": case "voice": case "电话": return AudioManager.STREAM_VOICE_CALL;
            case "system": case "系统": return AudioManager.STREAM_SYSTEM;
            case "notification": case "通知": return AudioManager.STREAM_NOTIFICATION;
            default: return AudioManager.STREAM_MUSIC;
        }
    }

    /** 设置音量 setVolume({volume, stream, percentMode})：
     *  percentMode=true 时 volume 按 0-100 百分比解释（内部按该流实际最大档换算）；
     *  否则按绝对档位（旧协议，媒体流百分比换算在 Web 侧完成后传入）。
     *  stream 可选：media（默认）/ alarm / ring / call → {ok, volume, max, stream} */
    @PluginMethod
    public void setVolume(PluginCall call) {
        Integer v = call.getInt("volume", null);
        final String streamName = call.getString("stream", "media");
        final boolean percentMode = Boolean.TRUE.equals(call.getBoolean("percentMode", Boolean.FALSE));
        if (v == null) {
            call.reject("缺少 volume 参数");
            return;
        }
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            JSObject ret = new JSObject();
            if (am != null) {
                int stream = streamOfName(streamName);
                int max = am.getStreamMaxVolume(stream);
                int vol;
                if (percentMode) {
                    int pct = Math.max(0, Math.min(100, v));
                    vol = Math.max(0, Math.min(max, (int) Math.round(pct / 100.0 * max)));
                } else {
                    vol = Math.max(0, Math.min(max, v));
                }
                am.setStreamVolume(stream, vol, 0);
                ret.put("ok", true);
                ret.put("volume", vol);
                ret.put("max", max);
                ret.put("stream", streamName == null ? "media" : streamName.trim().toLowerCase(Locale.ROOT));
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

    // ================= v2.3.0 原生系统级工具（机主「AI 系统管家」需求）· v2.4.1 setRealAlarm 加固 =================

    /** 国产 ROM 时钟包候选（标准 action 解析不到 handler 时逐个 setPackage 再试） */
    private static final String[] CLOCK_PKG_CANDIDATES = {
            "com.android.deskclock",            // AOSP / 小米 / 华为 / 荣耀（多数魔改仍沿用）
            "com.sec.android.app.clockpackage", // 三星
            "com.coloros.alarmclock",           // OPPO / 一加（ColorOS）
            "com.coloros.clock",                // OPPO 新版
            "com.android.BBKClock",             // vivo（BBK）
            "com.vivo.clock",                   // vivo 新版
    };

    /**
     * 参数强健化（parseInt）：弱模型常把 hour/minute 发成浮点（19.0）、字符串（"19"）、
     * 甚至拼接时间（"19:58"）。Capacitor 的 call.getInt 遇到字符串/浮点会抛异常或返 null
     * ——这里全部手撸解析：Integer/Long → intValue；Double/Float → Math.round；
     * 字符串 → 剥空白/「点」后 parseInt；"19:58" 拆两半。绝不让参数形态毁掉定闹钟。
     */
    private static Integer coerceInt(Object raw) {
        try {
            if (raw == null || raw == org.json.JSONObject.NULL) return null;
            if (raw instanceof Integer || raw instanceof Long || raw instanceof Short || raw instanceof Byte) {
                return ((Number) raw).intValue();
            }
            if (raw instanceof Double || raw instanceof Float) {
                return (int) Math.round(((Number) raw).doubleValue());
            }
            if (raw instanceof Boolean) return null;
            String s = raw.toString().trim();
            if (s.isEmpty()) return null;
            // 纯数字（可能带小数尾巴 "19.0"）
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("^(\\d+)(?:\\.0+)?$").matcher(s);
            if (m.matches()) return Integer.parseInt(m.group(1));
            return null;
        } catch (Throwable t) {
            return null;
        }
    }

    /** "19:58" / "19：58" / "19点58" → [19, 58]；解析不到返回 null */
    private static int[] parseHmString(String s) {
        try {
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("^(\\d{1,2})\\s*[:：点时]\\s*(\\d{1,2})$").matcher(s.trim());
            if (!m.matches()) return null;
            return new int[]{Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2))};
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * 系统闹钟（AlarmClock.ACTION_SET_ALARM 标准协议，直接拉起系统时钟的闹钟设置）。
     *
     * v2.4.1 加固（机主规格三连）：
     * ① Intent 规范：AlarmClock.ACTION_SET_ALARM + EXTRA_HOUR / EXTRA_MINUTES 两个
     *    Integer Extras（绝不用字符串拼接时间——系统不认）；EXTRA_MESSAGE 备注直传。
     * ② 参数 parseInt 强转（coerceInt/parseHmString），非法 resolve ok:false + reason
     *    'bad-params'（不再 call.reject —— JS 侧拿到的是友好话术，不再是红色系统错误）。
     * ③ 国产 ROM 兼容链：标准 action resolveActivity 为空（阉割/包可见性过滤）→
     *    已知厂商时钟包逐个 setPackage 再试 → 仍不行 ACTION_SHOW_ALARMS 打开闹钟
     *    列表（reason='show-alarms'，让 JS 引导机主手动允许闹钟权限）→ 全失败
     *    reason='no-handler'。全链 try/catch，任何异常都 resolve 结构化结果。
     */
    @PluginMethod
    public void setRealAlarm(PluginCall call) {
        Integer hour = null;
        Integer minute = null;
        try {
            org.json.JSONObject data = call.getData();
            Object hourRaw = data == null ? null : data.opt("hour");
            Object minuteRaw = data == null ? null : data.opt("minute");
            hour = coerceInt(hourRaw);
            minute = coerceInt(minuteRaw);
            // 字符串拼接时间兜底：hour 发成 "19:58" 且 minute 缺失 → 拆两半补齐
            if ((hour == null || minute == null) && hourRaw != null && !(hourRaw instanceof Number)) {
                int[] hm = parseHmString(String.valueOf(hourRaw));
                if (hm != null) {
                    if (hour == null) hour = hm[0];
                    if (minute == null) minute = hm[1];
                }
            }
        } catch (Throwable t) {
            hour = null;
            minute = null;
        }
        final String label = call.getString("label", "");
        final boolean skipUi = Boolean.TRUE.equals(call.getBoolean("skipUi", Boolean.TRUE));
        if (hour == null || minute == null || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            call.resolve(alarmFail("bad-params"));
            return;
        }
        try {
            final Intent i = new Intent(android.provider.AlarmClock.ACTION_SET_ALARM)
                    .putExtra(android.provider.AlarmClock.EXTRA_HOUR, hour)      // Integer Extra（0-23）
                    .putExtra(android.provider.AlarmClock.EXTRA_MINUTES, minute) // Integer Extra（0-59）
                    .putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, label == null ? "" : label)
                    .putExtra(android.provider.AlarmClock.EXTRA_SKIP_UI, skipUi)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            // ② 国产 ROM 兜底链：标准解析 → 厂商包候选 → 闹钟列表
            Intent resolved = resolveAlarmIntent(i);
            if (resolved == null) {
                call.resolve(alarmFail("no-handler"));
                return;
            }
            boolean appVisible = MainActivity.isAppInForeground();
            // 列表兜底 ≠ 定成功：只打开了闹钟页，如实上报 show-alarms（JS 引导手动允许权限）
            boolean showAlarmsOnly = android.provider.AlarmClock.ACTION_SHOW_ALARMS.equals(resolved.getAction());
            final Intent fi = resolved;
            if (!appVisible) {
                android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
                main.post(() -> {
                    android.view.View bal = addBalExemptionOverlay();
                    try {
                        getContext().startActivity(fi);
                    } finally {
                        if (bal != null) main.postDelayed(() -> removeViewQuietly(bal), 800L);
                    }
                });
            } else {
                getContext().startActivity(fi);
            }
            if (showAlarmsOnly) {
                call.resolve(alarmFail("show-alarms"));
                return;
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("hour", hour);
            ret.put("minute", minute);
            call.resolve(ret);
        } catch (android.content.ActivityNotFoundException anf) {
            call.resolve(alarmFail("no-handler"));
        } catch (SecurityException se) {
            call.resolve(alarmFail("security"));
        } catch (Throwable t) {
            call.resolve(alarmFail("start-failed"));
        }
    }

    /** setRealAlarm 失败结构（resolve 不 reject：JS 侧换友好话术，绝不闪红色系统错误） */
    private static JSObject alarmFail(String reason) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("reason", reason);
        return ret;
    }

    /**
     * 定闹钟 Intent 解析链：标准 action 全局解析 → 已知厂商时钟包 setPackage 再试 →
     * ACTION_SHOW_ALARMS（只打开闹钟列表，标记 show-alarms 由 JS 引导手动允许权限）。
     * 返回可直接 startActivity 的 Intent（已吸收 setPackage）；全链不通返回 null。
     */
    private Intent resolveAlarmIntent(Intent proto) {
        try {
            PackageManager pm = getContext().getPackageManager();
            if (proto.resolveActivity(pm) != null) return proto;
            // 国产 ROM：action 被 ROM 改名/包可见性过滤解析不到 → 显式点名厂商时钟包
            for (String pkg : CLOCK_PKG_CANDIDATES) {
                try {
                    Intent cand = new Intent(proto)
                            .setPackage(pkg)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    if (cand.resolveActivity(pm) != null) return cand;
                } catch (Throwable ignored) {
                    // 候选包不存在/不可见：试下一个
                }
            }
            // 最后兜底：打不开「直接定」通道，至少把系统闹钟列表打开（JS 引导机主允许权限）
            Intent show = new Intent(android.provider.AlarmClock.ACTION_SHOW_ALARMS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (show.resolveActivity(pm) != null) {
                return show;
            }
        } catch (Throwable ignored) {
            // 解析链绝不抛
        }
        return null;
    }

    /**
     * 系统倒计时/计时器（AlarmClock.ACTION_SET_TIMER 标准协议）。
     * 参数：seconds（>0）、label（可选）。返回 ok / reason。
     */
    @PluginMethod
    public void startCountdown(PluginCall call) {
        Integer seconds = call.getInt("seconds", null);
        final String label = call.getString("label", "");
        if (seconds == null || seconds <= 0 || seconds > 24 * 3600 * 100) {
            call.reject("seconds 参数不合法（正整数秒）");
            return;
        }
        try {
            Intent i = new Intent(android.provider.AlarmClock.ACTION_SET_TIMER)
                    .putExtra(android.provider.AlarmClock.EXTRA_LENGTH, seconds)
                    .putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, label == null ? "" : label)
                    .putExtra(android.provider.AlarmClock.EXTRA_SKIP_UI, true)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (i.resolveActivity(getContext().getPackageManager()) == null) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "no-handler");
                call.resolve(ret);
                return;
            }
            boolean appVisible = MainActivity.isAppInForeground();
            final Intent fi = i;
            if (!appVisible) {
                android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
                main.post(() -> {
                    android.view.View bal = addBalExemptionOverlay();
                    try {
                        getContext().startActivity(fi);
                    } finally {
                        if (bal != null) main.postDelayed(() -> removeViewQuietly(bal), 800L);
                    }
                });
            } else {
                getContext().startActivity(i);
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("seconds", seconds);
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? "start-failed" : t.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * 写入系统日历（CalendarContract 直写 ContentResolver，静默无 UI）：
     * 找第一个可见日历账号 → INSERT Events。需要 WRITE_CALENDAR 运行时权限。
     * 参数：title（必填）、beginTs/endTs（毫秒时间戳，缺 end 用 begin+1h）、location（可选）、
     * allDay（可选：跨天日程）。直写失败（无默认日历/权限拒绝）降级 ACTION_INSERT
     * 意图（拉起日历应用预填好让机主确认）。
     */
    @PluginMethod
    public void createCalendarEvent(PluginCall call) {
        final String title = call.getString("title", "");
        Long beginTs = call.getLong("beginTs", null);
        Long endTs = call.getLong("endTs", null);
        final String location = call.getString("location", "");
        final boolean allDay = Boolean.TRUE.equals(call.getBoolean("allDay", Boolean.FALSE));
        if (title == null || title.trim().isEmpty()) {
            call.reject("缺少 title 参数");
            return;
        }
        final long begin = beginTs != null && beginTs > 0 ? beginTs : System.currentTimeMillis();
        final long end = endTs != null && endTs > begin ? endTs : begin + 3600_000L;
        final PluginCall fcall = call;
        new Thread(() -> {
            JSObject ret = new JSObject();
            try {
                Context ctx = getContext();
                // ① 找第一个可写的可见日历
                long calId = -1;
                String calName = "";
                try (Cursor c = ctx.getContentResolver().query(
                        android.provider.CalendarContract.Calendars.CONTENT_URI,
                        new String[]{android.provider.CalendarContract.Calendars._ID,
                                android.provider.CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                                android.provider.CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL},
                        android.provider.CalendarContract.Calendars.VISIBLE + "=1", null,
                        android.provider.CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + " DESC")) {
                    if (c != null) {
                        while (c.moveToNext()) {
                            int access = c.getInt(2);
                            if (access >= android.provider.CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) {
                                calId = c.getLong(0);
                                calName = c.getString(1);
                                break;
                            }
                        }
                        if (calId < 0 && c.getCount() > 0) {
                            c.moveToFirst();
                            calId = c.getLong(0);
                            calName = c.getString(1);
                        }
                    }
                }
                if (calId > 0) {
                    // ② 直写 Events（静默）
                    android.content.ContentValues cv = new android.content.ContentValues();
                    cv.put(android.provider.CalendarContract.Events.CALENDAR_ID, calId);
                    cv.put(android.provider.CalendarContract.Events.TITLE, title.trim());
                    cv.put(android.provider.CalendarContract.Events.DTSTART, begin);
                    if (allDay) {
                        cv.put(android.provider.CalendarContract.Events.ALL_DAY, 1);
                        cv.put(android.provider.CalendarContract.Events.DTSTART, beginOfDay(begin));
                        cv.put(android.provider.CalendarContract.Events.DTEND, beginOfDay(end));
                    } else {
                        cv.put(android.provider.CalendarContract.Events.ALL_DAY, 0);
                        cv.put(android.provider.CalendarContract.Events.DTSTART, begin);
                        cv.put(android.provider.CalendarContract.Events.DTEND, end);
                    }
                    if (location != null && !location.trim().isEmpty()) {
                        cv.put(android.provider.CalendarContract.Events.EVENT_LOCATION, location.trim());
                    }
                    cv.put(android.provider.CalendarContract.Events.EVENT_TIMEZONE,
                            java.util.TimeZone.getDefault().getID());
                    Uri uri = ctx.getContentResolver()
                            .insert(android.provider.CalendarContract.Events.CONTENT_URI, cv);
                    if (uri != null) {
                        ret.put("ok", true);
                        ret.put("via", "insert");
                        ret.put("calendar", calName);
                        ret.put("eventTitle", title.trim());
                        fcall.resolve(ret);
                        return;
                    }
                }
                // ③ 直写失败 → 降级 ACTION_INSERT（拉起日历应用预填好）
                Intent i = new Intent(Intent.ACTION_INSERT)
                        .setData(android.provider.CalendarContract.Events.CONTENT_URI)
                        .putExtra(android.provider.CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin)
                        .putExtra(android.provider.CalendarContract.EXTRA_EVENT_END_TIME, end)
                        .putExtra(android.provider.CalendarContract.Events.TITLE, title.trim())
                        .putExtra(android.provider.CalendarContract.Events.ALL_DAY, allDay ? 1 : 0)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (i.resolveActivity(ctx.getPackageManager()) == null) {
                    ret.put("ok", false);
                    ret.put("reason", "no-calendar-app");
                    fcall.resolve(ret);
                    return;
                }
                boolean appVisible = MainActivity.isAppInForeground();
                final Intent fi = i;
                if (!appVisible) {
                    android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
                    main.post(() -> {
                        android.view.View bal = addBalExemptionOverlay();
                        try {
                            ctx.startActivity(fi);
                        } finally {
                            if (bal != null) main.postDelayed(() -> removeViewQuietly(bal), 800L);
                        }
                    });
                } else {
                    ctx.startActivity(i);
                }
                ret.put("ok", true);
                ret.put("via", "intent");
                ret.put("eventTitle", title.trim());
                fcall.resolve(ret);
            } catch (SecurityException se) {
                ret.put("ok", false);
                ret.put("reason", "no-permission");
                fcall.resolve(ret);
            } catch (Throwable t) {
                ret.put("ok", false);
                ret.put("reason", t.getMessage() == null ? "failed" : t.getMessage());
                fcall.resolve(ret);
            }
        }, "cal-event").start();
    }

    /** 当天零点（allDay 日程的 DTSTART/DTEND 对齐） */
    private long beginOfDay(long ts) {
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.setTimeInMillis(ts);
        c.set(java.util.Calendar.HOUR_OF_DAY, 0);
        c.set(java.util.Calendar.MINUTE, 0);
        c.set(java.util.Calendar.SECOND, 0);
        c.set(java.util.Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /**
     * 拨打电话：CALL_PHONE 权限已授 → Intent.ACTION_CALL 直接拨；未授权 →
     * ACTION_DIAL 拉起拨号盘预填号码（机主按一下拨号键）。返回 via 标记。
     */
    @PluginMethod
    public void makePhoneCall(PluginCall call) {
        final String phone = call.getString("phoneNumber", "");
        if (phone == null || phone.trim().isEmpty()) {
            call.reject("缺少 phoneNumber 参数");
            return;
        }
        try {
            Context ctx = getContext();
            boolean appVisible = MainActivity.isAppInForeground();
            boolean hasCallPerm = ContextCompat.checkSelfPermission(ctx,
                    android.Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED;
            Intent i;
            String via;
            if (hasCallPerm) {
                i = new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + phone.trim()));
                via = "direct-call";
            } else {
                i = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone.trim()));
                via = "dialer";
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            final Intent fi = i;
            if (!appVisible) {
                android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
                main.post(() -> {
                    android.view.View bal = addBalExemptionOverlay();
                    try {
                        ctx.startActivity(fi);
                    } finally {
                        if (bal != null) main.postDelayed(() -> removeViewQuietly(bal), 800L);
                    }
                });
            } else {
                ctx.startActivity(i);
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("via", via);
            ret.put("phoneNumber", phone.trim());
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? "start-failed" : t.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * 发短信：SEND_SMS 权限已授 → SmsManager 静默直接发送；未授权 →
     * ACTION_SENDTO sms: 拉起短信应用预填收件人与正文。返回 via 标记。
     */
    @PluginMethod
    public void sendSMS(PluginCall call) {
        final String phone = call.getString("phoneNumber", "");
        final String message = call.getString("message", "");
        if (phone == null || phone.trim().isEmpty() || message == null || message.trim().isEmpty()) {
            call.reject("缺少 phoneNumber / message 参数");
            return;
        }
        try {
            Context ctx = getContext();
            boolean hasSmsPerm = ContextCompat.checkSelfPermission(ctx,
                    android.Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED;
            if (hasSmsPerm) {
                android.telephony.SmsManager sm = android.os.Build.VERSION.SDK_INT >= 31
                        ? ctx.getSystemService(android.telephony.SmsManager.class)
                        : android.telephony.SmsManager.getDefault();
                if (sm == null) {
                    JSObject ret = new JSObject();
                    ret.put("ok", false);
                    ret.put("reason", "no-sms-service");
                    call.resolve(ret);
                    return;
                }
                // 长短信自动分段发送
                java.util.ArrayList<String> parts = sm.divideMessage(message.trim());
                if (parts.size() <= 1) {
                    sm.sendTextMessage(phone.trim(), null, message.trim(), null, null);
                } else {
                    sm.sendMultipartTextMessage(phone.trim(), null, parts, null, null);
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("via", "silent");
                ret.put("phoneNumber", phone.trim());
                call.resolve(ret);
            } else {
                // 降级：拉起短信应用预填（机主点一下发送）
                Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + phone.trim()))
                        .putExtra("sms_body", message.trim())
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                boolean appVisible = MainActivity.isAppInForeground();
                final Intent fi = i;
                if (!appVisible) {
                    android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
                    main.post(() -> {
                        android.view.View bal = addBalExemptionOverlay();
                        try {
                            ctx.startActivity(fi);
                        } finally {
                            if (bal != null) main.postDelayed(() -> removeViewQuietly(bal), 800L);
                        }
                    });
                } else {
                    ctx.startActivity(i);
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("via", "compose");
                ret.put("phoneNumber", phone.trim());
                call.resolve(ret);
            }
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? "send-failed" : t.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * 查真机通讯录（ContactsContract 按显示名模糊匹配；需 READ_CONTACTS）：
     * 返回 contacts:[{name, phone}]（最多 20 条，含多号码展开）。
     */
    @PluginMethod
    public void searchRealContact(PluginCall call) {
        final String name = call.getString("name", "");
        if (name == null || name.trim().isEmpty()) {
            call.reject("缺少 name 参数");
            return;
        }
        final PluginCall fcall = call;
        new Thread(() -> {
            JSObject ret = new JSObject();
            try {
                Context ctx = getContext();
                if (ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.READ_CONTACTS)
                        != PackageManager.PERMISSION_GRANTED) {
                    ret.put("ok", false);
                    ret.put("reason", "no-permission");
                    fcall.resolve(ret);
                    return;
                }
                String kw = name.trim();
                java.util.ArrayList<JSONObject> out = new java.util.ArrayList<>();
                // ① 按 display name 匹配联系人 id
                java.util.LinkedHashSet<Long> ids = new java.util.LinkedHashSet<>();
                try (Cursor c = ctx.getContentResolver().query(
                        android.provider.ContactsContract.Contacts.CONTENT_URI,
                        new String[]{android.provider.ContactsContract.Contacts._ID,
                                android.provider.ContactsContract.Contacts.DISPLAY_NAME},
                        android.provider.ContactsContract.Contacts.DISPLAY_NAME + " LIKE ?",
                        new String[]{"%" + kw + "%"}, null)) {
                    if (c != null) {
                        while (c.moveToNext() && ids.size() < 20) {
                            long id = c.getLong(0);
                            String nm = c.getString(1);
                            ids.add(id);
                        }
                    }
                }
                // ② 逐个取号码（含多号码）
                for (long id : ids) {
                    try (Cursor p = ctx.getContentResolver().query(
                            android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                            new String[]{android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER,
                                    android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                                    android.provider.ContactsContract.CommonDataKinds.Phone.TYPE},
                            android.provider.ContactsContract.CommonDataKinds.Phone.CONTACT_ID + "=?",
                            new String[]{String.valueOf(id)}, null)) {
                        if (p != null) {
                            while (p.moveToNext() && out.size() < 20) {
                                String num = p.getString(0);
                                if (num == null || num.trim().isEmpty()) continue;
                                String nm = p.getString(1);
                                int type = p.getInt(2);
                                String typeLabel;
                                switch (type) {
                                    case android.provider.ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE:
                                        typeLabel = "手机"; break;
                                    case android.provider.ContactsContract.CommonDataKinds.Phone.TYPE_HOME:
                                        typeLabel = "宅电"; break;
                                    case android.provider.ContactsContract.CommonDataKinds.Phone.TYPE_WORK:
                                        typeLabel = "工作"; break;
                                    default: typeLabel = "电话"; break;
                                }
                                JSONObject o = new JSONObject();
                                o.put("name", nm == null ? kw : nm);
                                o.put("phone", num.trim());
                                o.put("type", typeLabel);
                                out.add(o);
                            }
                        }
                    }
                }
                ret.put("ok", true);
                JSArray arr = new JSArray();
                for (JSONObject o : out) arr.put(o);
                ret.put("contacts", arr);
                ret.put("count", out.size());
                fcall.resolve(ret);
            } catch (Throwable t) {
                ret.put("ok", false);
                ret.put("reason", t.getMessage() == null ? "failed" : t.getMessage());
                fcall.resolve(ret);
            }
        }, "contact-search").start();
    }

    /** 手电筒开关（CameraManager.setTorchMode；无需相机运行时权限） */
    @PluginMethod
    public void toggleFlashlight(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", Boolean.TRUE));
        try {
            android.hardware.camera2.CameraManager cm =
                    (android.hardware.camera2.CameraManager) getContext()
                            .getSystemService(Context.CAMERA_SERVICE);
            if (cm == null) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "no-camera-service");
                call.resolve(ret);
                return;
            }
            String found = null;
            boolean hasFlash = false;
            for (String id : cm.getCameraIdList()) {
                Boolean torch = cm.getCameraCharacteristics(id)
                        .get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE);
                if (Boolean.TRUE.equals(torch)) {
                    found = id;
                    hasFlash = true;
                    break;
                }
            }
            if (!hasFlash || found == null) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "no-flash");
                call.resolve(ret);
                return;
            }
            final String camId = found;
            cm.setTorchMode(camId, on);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("on", on);
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? "failed" : t.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * 真实 GPS 定位（LocationManager：lastKnownLocation 优先 + 8s 单次刷新；
     * Geocoder 解析城市）。需位置运行时权限。返回 lat/lng/accuracy/city/address。
     */
    @PluginMethod
    public void getRealLocation(PluginCall call) {
        final PluginCall fcall = call;
        new Thread(() -> {
            JSObject ret = new JSObject();
            try {
                Context ctx = getContext();
                boolean fine = ContextCompat.checkSelfPermission(ctx,
                        android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                boolean coarse = ContextCompat.checkSelfPermission(ctx,
                        android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                if (!fine && !coarse) {
                    ret.put("ok", false);
                    ret.put("reason", "no-permission");
                    fcall.resolve(ret);
                    return;
                }
                android.location.LocationManager lm =
                        (android.location.LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
                if (lm == null) {
                    ret.put("ok", false);
                    ret.put("reason", "no-location-service");
                    fcall.resolve(ret);
                    return;
                }
                // ① lastKnownLocation（快）
                android.location.Location best = null;
                List<String> providers = lm.getProviders(true);
                for (String p : providers) {
                    try {
                        android.location.Location l = lm.getLastKnownLocation(p);
                        if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                    } catch (SecurityException ignored) {
                    }
                }
                // ② 太旧（>2 分钟）或没有 → 单次请求刷新（最多 8 秒，GPS+网络双通道）
                boolean fresh = best != null && System.currentTimeMillis() - best.getTime() < 120_000L;
                if (!fresh) {
                    final CountDownLatch latch = new CountDownLatch(1);
                    final AtomicReference<android.location.Location> got = new AtomicReference<>(null);
                    android.location.LocationListener listener = new android.location.LocationListener() {
                        @Override
                        public void onLocationChanged(android.location.Location location) {
                            android.location.Location cur = got.get();
                            if (cur == null || location.getAccuracy() < cur.getAccuracy()) {
                                got.set(location);
                            }
                            latch.countDown();
                        }
                    };
                    try {
                        if (fine && lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)) {
                            lm.requestLocationUpdates(android.location.LocationManager.GPS_PROVIDER,
                                    0, 0, listener, android.os.Looper.getMainLooper());
                        }
                        if (lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER)) {
                            lm.requestLocationUpdates(android.location.LocationManager.NETWORK_PROVIDER,
                                    0, 0, listener, android.os.Looper.getMainLooper());
                        }
                        latch.await(8, TimeUnit.SECONDS);
                    } catch (Throwable ignored) {
                    } finally {
                        try {
                            lm.removeUpdates(listener);
                        } catch (Throwable ignored) {
                        }
                    }
                    if (got.get() != null
                            && (best == null || got.get().getTime() > best.getTime())) {
                        best = got.get();
                    }
                }
                if (best == null) {
                    ret.put("ok", false);
                    ret.put("reason", "no-fix");
                    fcall.resolve(ret);
                    return;
                }
                ret.put("ok", true);
                ret.put("lat", best.getLatitude());
                ret.put("lng", best.getLongitude());
                ret.put("accuracy", Math.round(best.getAccuracy()));
                // ③ Geocoder 城市解析（失败不影响定位结果）
                try {
                    android.location.Geocoder gc = new android.location.Geocoder(ctx, Locale.getDefault());
                    List<android.location.Address> addrs = gc.getFromLocation(
                            best.getLatitude(), best.getLongitude(), 1);
                    if (addrs != null && !addrs.isEmpty()) {
                        android.location.Address a = addrs.get(0);
                        String city = a.getLocality();
                        if (city == null || city.isEmpty()) city = a.getSubAdminArea();
                        if (city == null || city.isEmpty()) city = a.getAdminArea();
                        if (city != null && !city.isEmpty()) ret.put("city", city);
                        StringBuilder sb = new StringBuilder();
                        for (int i = 0; i <= Math.max(a.getMaxAddressLineIndex(), 0); i++) {
                            String line = a.getAddressLine(i);
                            if (line != null && !line.isEmpty()) {
                                if (sb.length() > 0) sb.append(" ");
                                sb.append(line);
                            }
                        }
                        if (sb.length() > 0) ret.put("address", sb.toString());
                    }
                } catch (Throwable ignored) {
                }
                fcall.resolve(ret);
            } catch (Throwable t) {
                ret.put("ok", false);
                ret.put("reason", t.getMessage() == null ? "failed" : t.getMessage());
                fcall.resolve(ret);
            }
        }, "real-location").start();
    }

    /**
     * 系统应用直达（机主抱怨 openApp 只会找包名）：「时钟」「闹钟」「日历」「计算器」
     * 这类系统应用直接走标准 Intent 协议（ACTION_SHOW_ALARMS / Calendar / CALCULATOR
     * category 等），绝不遍历应用清单。返回 ok / via（intent / launch）/ reason。
     */
    @PluginMethod
    public void openSystemApp(PluginCall call) {
        final String nameRaw = call.getString("name", "");
        final String name = nameRaw == null ? "" : nameRaw.trim().toLowerCase(Locale.ROOT);
        if (name.isEmpty()) {
            call.reject("缺少 name 参数");
            return;
        }
        try {
            Context ctx = getContext();
            Intent direct = systemAppIntent(ctx, name);
            if (direct == null) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("reason", "unknown-app");
                call.resolve(ret);
                return;
            }
            boolean appVisible = MainActivity.isAppInForeground();
            final Intent fi = direct;
            if (!appVisible) {
                android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
                main.post(() -> {
                    android.view.View bal = addBalExemptionOverlay();
                    try {
                        ctx.startActivity(fi);
                    } finally {
                        if (bal != null) main.postDelayed(() -> removeViewQuietly(bal), 800L);
                    }
                });
            } else {
                ctx.startActivity(direct);
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("via", "intent");
            call.resolve(ret);
        } catch (Throwable t) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("reason", t.getMessage() == null ? "start-failed" : t.getMessage());
            call.resolve(ret);
        }
    }

    /** 系统应用标准 Intent 映射（中英别名 → 标准协议；无匹配返回 null） */
    private Intent systemAppIntent(Context ctx, String name) {
        // 闹钟列表 / 时钟（标准 AlarmClock 协议，绝不需要包名）
        if (name.contains("闹钟") || name.contains("alarm")) {
            return new Intent(android.provider.AlarmClock.ACTION_SHOW_ALARMS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        if (name.contains("时钟") || name.contains("clock") || name.contains("时间")
                || name.contains("计时") || name.contains("timer") || name.contains("秒表")) {
            Intent i = new Intent(android.provider.AlarmClock.ACTION_SHOW_TIMERS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (i.resolveActivity(ctx.getPackageManager()) != null) return i;
            // 无计时器协议 → 拉系统时钟主包（常见 OEM 时钟）
            for (String pkg : new String[]{"com.android.deskclock", "com.sec.android.app.clockpackage",
                    "com.google.android.deskclock", "com.android.calendar"}) {
                Intent li = ctx.getPackageManager().getLaunchIntentForPackage(pkg);
                if (li != null) {
                    li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    return li;
                }
            }
            return new Intent(android.provider.AlarmClock.ACTION_SHOW_ALARMS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        // 日历
        if (name.contains("日历") || name.contains("calendar") || name.contains("日程")) {
            Intent li = ctx.getPackageManager().getLaunchIntentForPackage("com.android.calendar");
            if (li == null) li = ctx.getPackageManager().getLaunchIntentForPackage("com.google.android.calendar");
            if (li != null) {
                li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                return li;
            }
            return new Intent(Intent.ACTION_VIEW)
                    .setData(android.provider.CalendarContract.Events.CONTENT_URI)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        // 计算器（CATEGORY_APP_CALCULATOR 标准协议）
        if (name.contains("计算") || name.contains("calculator") || name.contains("calc")) {
            return Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_CALCULATOR)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        // 设置
        if (name.contains("设置") || name.contains("setting")) {
            return new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        // 相机
        if (name.contains("相机") || name.contains("拍照") || name.contains("camera")) {
            // 相机无 CATEGORY_APP_CAMERA 常量：MediaStore 标准拍照模式 Intent
            return new Intent(android.provider.MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        // 图库/相册
        if (name.contains("图库") || name.contains("相册") || name.contains("照片")
                || name.contains("gallery") || name.contains("photo")) {
            return Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_GALLERY)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        // 联系人/通讯录
        if (name.contains("联系人") || name.contains("通讯录") || name.contains("contact")) {
            return new Intent(Intent.ACTION_VIEW)
                    .setData(android.provider.ContactsContract.Contacts.CONTENT_URI)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        // 拨号/电话
        if (name.contains("拨号") || name.contains("电话") || name.contains("dial") || name.contains("phone")) {
            return new Intent(Intent.ACTION_DIAL).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        // 短信/信息
        if (name.contains("短信") || name.contains("信息") || name.contains("sms") || name.contains("message")) {
            return new Intent(Intent.ACTION_MAIN)
                    .addCategory(Intent.CATEGORY_APP_MESSAGING)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        // 浏览器
        if (name.contains("浏览器") || name.contains("browser")) {
            return Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        // 邮件
        if (name.contains("邮件") || name.contains("email") || name.contains("邮箱")) {
            return Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_EMAIL)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        // 音乐（标准 CATEGORY_APP_MUSIC）
        if (name.contains("音乐") || name.contains("music") || name.contains("播放器")) {
            return Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MUSIC)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        return null;
    }

    /** v2.3.0：发送短信权限查询/申请（权限中心 + sendSMS 工具前置） */
    @PluginMethod
    public void sendSmsPermission(PluginCall call) {
        PermissionState s = getPermissionStates().get("sendSms");
        JSObject ret = new JSObject();
        ret.put("granted", s == PermissionState.GRANTED);
        ret.put("canAsk", s == PermissionState.PROMPT);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestSendSmsPermission(PluginCall call) {
        PermissionState s = getPermissionStates().get("sendSms");
        if (s == PermissionState.GRANTED) {
            resolvePerm(call, true, false);
            return;
        }
        if (s == PermissionState.PROMPT) {
            requestPermissionForAlias("sendSms", call, "sendSmsPermissionCallback");
            return;
        }
        resolvePerm(call, false, false);
    }

    @PermissionCallback
    private void sendSmsPermissionCallback(PluginCall call) {
        PermissionState s = getPermissionStates().get("sendSms");
        JSObject ret = new JSObject();
        ret.put("granted", s == PermissionState.GRANTED);
        ret.put("canAsk", s == PermissionState.PROMPT);
        call.resolve(ret);
    }

    /** v2.3.0：拨打电话权限查询/申请 */
    @PluginMethod
    public void callPhonePermission(PluginCall call) {
        PermissionState s = getPermissionStates().get("callPhone");
        JSObject ret = new JSObject();
        ret.put("granted", s == PermissionState.GRANTED);
        ret.put("canAsk", s == PermissionState.PROMPT);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestCallPhonePermission(PluginCall call) {
        PermissionState s = getPermissionStates().get("callPhone");
        if (s == PermissionState.GRANTED) {
            resolvePerm(call, true, false);
            return;
        }
        if (s == PermissionState.PROMPT) {
            requestPermissionForAlias("callPhone", call, "callPhonePermissionCallback");
            return;
        }
        resolvePerm(call, false, false);
    }

    @PermissionCallback
    private void callPhonePermissionCallback(PluginCall call) {
        PermissionState s = getPermissionStates().get("callPhone");
        JSObject ret = new JSObject();
        ret.put("granted", s == PermissionState.GRANTED);
        ret.put("canAsk", s == PermissionState.PROMPT);
        call.resolve(ret);
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
