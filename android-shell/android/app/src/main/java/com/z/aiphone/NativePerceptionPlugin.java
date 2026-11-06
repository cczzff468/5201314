package com.z.aiphone;

import android.app.Activity;
import android.app.AppOpsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 原生感知插件（网页 window.Capacitor.Plugins.NativePerception）：
 *
 * ① UsageStats 真机感知（免装 ActivityWatch 的替代数据源）：
 *    - hasUsagePermission / openUsagePermissionSettings：PACKAGE_USAGE_STATS
 *      特殊权限检测与跳系统设置（一次授权终身有效）；
 *    - getUsageSnapshot：今日前台 App 流水 → 精确前台会话（RESUMED→PAUSED 配对，
 *      息屏/锁屏时间不再计入）→ 当前 App + 已持续 / 分 App 时长 / 打开次数 /
 *      总时长 / 切换次数 / 最长单次 / 近期历史 / 近 3 小时打开过的 App；
 *
 * ② 媒体感知（正在听什么歌）：NotificationListenerService（MediaListenerService）
 *    读取音乐 App 的媒体通知/媒体会话 → 歌名/歌手/专辑/播放状态；
 *    - hasMediaPermission / openMediaPermissionSettings：「通知使用权」检测与跳设置；
 *    - getNowPlaying：当前正在播放的媒体快照；
 *
 * ③ 屏幕抓帧（「让 TA 看到我的屏幕」）：
 *    - requestScreenCapture：MediaProjection 授权（系统弹窗，每会话一次）→
 *      ScreenCaptureService 前台服务建流；
 *    - grabScreenFrame：抓一帧 → dataURL（网页端直接喂 VLM 识图）；
 *    - stopScreenCapture：结束会话。
 */
@CapacitorPlugin(name = "NativePerception")
public class NativePerceptionPlugin extends Plugin {

    private static final int REQ_SCREEN_CAPTURE = 2;

    private PluginCall pendingCaptureCall;

    // ================= UsageStats（真机感知） =================

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
     * 今日前台会话聚合（v1.1 数据质量重写）：
     *
     * 旧版只统计 RESUMED 事件、把「上一次打开 → 下一次打开」的整段时间（含息屏/
     * 锁屏/放下的时间）全记进上一个 App —— 时长严重虚高。新版按
     * ACTIVITY_RESUMED(1)/ACTIVITY_PAUSED(2) 配对计时：息屏与切走即停止计时。
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
            android.app.usage.UsageStatsManager usm =
                    (android.app.usage.UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
            long now = System.currentTimeMillis();
            Calendar cal = Calendar.getInstance();
            cal.set(Calendar.HOUR_OF_DAY, 0);
            cal.set(Calendar.MINUTE, 0);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            long startOfDay = cal.getTimeInMillis();

            android.app.usage.UsageEvents events = usm.queryEvents(startOfDay, now);
            android.app.usage.UsageEvents.Event ev = new android.app.usage.UsageEvents.Event();

            final int TYPE_RESUMED = android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED;   // = 1
            final int TYPE_PAUSED = android.app.usage.UsageEvents.Event.ACTIVITY_PAUSED;    // = 2

            // 分 App 聚合
            final Map<String, Long> durationByApp = new HashMap<>();   // 前台总时长（精确）
            final Map<String, Integer> opensByApp = new HashMap<>();   // 打开次数（RESUMED 计数）
            final Map<String, Long> lastOpenByApp = new HashMap<>();   // 最近一次打开时间
            final List<long[]> history = new ArrayList<>();            // {ts} 与 historyPkgs 平行
            final List<String> historyPkgs = new ArrayList<>();

            // 当前打开中的会话（尚未收到 PAUSED = 仍在前台）
            String openApp = null;
            long openStart = 0;
            // 最后一个会话（可能已暂停）：用于「最近用过」
            String lastApp = null;
            long lastAppStart = 0;

            String longestApp = null;
            long longestMs = 0;
            int switchCount = 0;

            while (events.hasNextEvent()) {
                events.getNextEvent(ev);
                int type = ev.getEventType();
                if (type != TYPE_RESUMED && type != TYPE_PAUSED) continue;
                String pkg = ev.getPackageName();
                long ts = ev.getTimeStamp();
                if (pkg == null) continue;

                if (type == TYPE_RESUMED) {
                    // 新 App 到前台：先结算当前打开中的会话（部分 ROM 不发 PAUSED）
                    if (openApp != null && ts > openStart) {
                        long dur = ts - openStart;
                        durationByApp.merge(openApp, dur, Long::sum);
                        if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
                    }
                    openApp = pkg;
                    openStart = ts;
                    lastApp = pkg;
                    lastAppStart = ts;
                    opensByApp.merge(pkg, 1, Integer::sum);
                    lastOpenByApp.put(pkg, ts);
                    switchCount++;
                    history.add(new long[]{ts});
                    historyPkgs.add(pkg);
                } else { // TYPE_PAUSED
                    if (openApp != null && openApp.equals(pkg) && ts >= openStart) {
                        long dur = ts - openStart;
                        durationByApp.merge(openApp, dur, Long::sum);
                        if (dur > longestMs) { longestMs = dur; longestApp = openApp; }
                        openApp = null; // 息屏/切走：停止计时
                    }
                    // 非当前会话的 PAUSED（乱序/重复）：忽略
                }
            }

            PackageManager pm = getContext().getPackageManager();
            SimpleDateFormat hhmm = new SimpleDateFormat("HH:mm", Locale.getDefault());

            // 分 App 时长列表（降序；带上打开次数与最近打开时间，最多 30 个）
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

            // 近 3 小时打开过的 App（最近打开在前；「我最近打开了什么App」直接可答）
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

            // 近期切换时间线（最后 24 条）
            JSArray hist = new JSArray();
            int from = Math.max(0, historyPkgs.size() - 24);
            for (int i = from; i < historyPkgs.size(); i++) {
                JSObject o = new JSObject();
                o.put("hhmm", hhmm.format(new Date(history.get(i)[0])));
                o.put("app", historyPkgs.get(i));
                o.put("name", appLabel(pm, historyPkgs.get(i)));
                hist.put(o);
            }

            JSObject ret = new JSObject();
            ret.put("ok", true);
            if (openApp != null && openStart > 0) {
                // 正在前台：会话起点精确
                JSObject cur = new JSObject();
                cur.put("app", openApp);
                cur.put("name", appLabel(pm, openApp));
                cur.put("ongoingMs", Math.max(0, now - openStart));
                cur.put("at", openStart);
                ret.put("current", cur);
            } else if (lastApp != null && lastAppStart > 0) {
                // 已息屏/切走：报「最近使用」，at = 最后一次打开时间（网页按此老化）
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
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("查询使用情况失败：" + e.getMessage());
        }
    }

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
