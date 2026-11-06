package com.z.aiphone;

import android.app.Activity;
import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;

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
 *    - getUsageSnapshot：今日前台 App 流水（UsageEvents）→ 当前 App + 已持续 /
 *      分 App 时长 / 总时长 / 切换次数 / 近期历史，应用名友好化；
 *
 * ② 屏幕抓帧（「让 TA 看到我的屏幕」）：
 *    - requestScreenCapture：MediaProjection 授权（系统弹窗，每会话一次）→
 *      ScreenCaptureService 前台服务建流；
 *    - grabScreenFrame：抓一帧 → dataURL（网页端直接喂 VLM 识图）；
 *    - stopScreenCapture：结束会话。
 */
@CapacitorPlugin(name = "NativePerception")
public class NativePerceptionPlugin extends Plugin {

    private static final int REQ_USAGE_EVENT = 1;
    private static final int REQ_SCREEN_CAPTURE = 2;

    private PluginCall pendingUsageCall;
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

    /** 授权页返回事件（用户从系统设置回来）→ 立刻回报权限状态 */
    @PluginMethod
    public void awaitUsagePermission(PluginCall call) {
        pendingUsageCall = call;
        // 不阻塞 resolve：设置页回不回来都先回当前状态由轮询兜底，这里挂起等待
    }

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

            Map<String, Long> durationByApp = new HashMap<>();
            List<long[]> history = new ArrayList<>(); // {ts, hashCode-of-pkg 由 map 查}
            List<String> historyPkgs = new ArrayList<>();

            String lastApp = null;
            long lastTs = 0;
            int switchCount = 0;

            while (events.hasNextEvent()) {
                events.getNextEvent(ev);
                int type = ev.getEventType();
                if (type == android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND
                        || type == android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED) {
                    String pkg = ev.getPackageName();
                    long ts = ev.getTimeStamp();
                    if (lastApp != null && ts > lastTs) {
                        durationByApp.merge(lastApp, ts - lastTs, Long::sum);
                    }
                    lastApp = pkg;
                    lastTs = ts;
                    switchCount++;
                    history.add(new long[]{ts});
                    historyPkgs.add(pkg);
                }
            }
            // 收尾：最后一个 App 持续到现在（写入 todayApps 里由「当前」单独表达，不折入总量）

            PackageManager pm = getContext().getPackageManager();
            SimpleDateFormat hhmm = new SimpleDateFormat("HH:mm", Locale.getDefault());

            JSArray todayApps = new JSArray();
            List<Map.Entry<String, Long>> sorted = new ArrayList<>(durationByApp.entrySet());
            sorted.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
            long totalMs = 0;
            for (Map.Entry<String, Long> e : sorted) {
                totalMs += e.getValue();
                JSObject o = new JSObject();
                o.put("app", e.getKey());
                o.put("name", appLabel(pm, e.getKey()));
                o.put("ms", e.getValue());
                todayApps.put(o);
            }

            JSArray hist = new JSArray();
            int from = Math.max(0, historyPkgs.size() - 6);
            for (int i = from; i < historyPkgs.size(); i++) {
                JSObject o = new JSObject();
                o.put("hhmm", hhmm.format(new Date(history.get(i)[0])));
                o.put("app", historyPkgs.get(i));
                o.put("name", appLabel(pm, historyPkgs.get(i)));
                hist.put(o);
            }

            JSObject ret = new JSObject();
            ret.put("ok", true);
            if (lastApp != null && lastTs > 0) {
                JSObject cur = new JSObject();
                cur.put("app", lastApp);
                cur.put("name", appLabel(pm, lastApp));
                cur.put("ongoingMs", Math.max(0, now - lastTs));
                ret.put("current", cur);
            }
            ret.put("todayApps", todayApps);
            ret.put("todayTotalMs", totalMs);
            ret.put("switchCount", switchCount);
            ret.put("history", hist);
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

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // 从系统授权设置页回到 APP：回报当前权限状态（awaitUsagePermission 的调用方）
        PluginCall call = pendingUsageCall;
        if (call != null) {
            pendingUsageCall = null;
            JSObject ret = new JSObject();
            ret.put("granted", checkUsagePermission());
            call.resolve(ret);
        }
    }
}
