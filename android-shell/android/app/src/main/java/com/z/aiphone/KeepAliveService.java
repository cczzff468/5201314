package com.z.aiphone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * 常驻守护前台服务（v2.1.0 防杀后台核心）。
 *
 * 【作用】挂一条状态栏「小常驻通知」（AI Phone 正在守候），让安卓系统不轻易
 * 回收本应用的后台进程——监控服务（LockOverlayService 吃醋遮罩锁）、查岗感知、
 * WebView 冻结后依然存活的守护全部因此受益。
 *
 * 【Android 14+ 合规】前台服务必须声明类型：本服务用 specialUse 并声明子类型
 * companion_keepalive_guard（伴侣应用守护）；FOREGROUND_SERVICE_SPECIAL_USE
 * 权限已在 Manifest 声明。通知走 IMPORTANCE_LOW 静默通道（不响不弹，只在
 * 通知栏常驻一行）。
 *
 * 【生命周期】由 JS 侧经插件 keepAliveStart/keepAliveStop 控制；「是否启用」
 * 持久化在 SharedPreferences（keepalive/enabled）——BootReceiver 重启后据
 * 此决定要不要自动拉起本服务。服务 START_STICKY：进程被杀系统会尝试重建。
 */
public class KeepAliveService extends Service {

    private static final String PREFS_NAME = "keepalive";
    private static final String KEY_ENABLED = "enabled";

    private static final String CHANNEL_ID = "keepalive";
    private static final int NOTIFY_ID = 7792;

    /** 实例存活标记（插件查询用；跨进程静态可见） */
    private static volatile boolean running = false;

    // ================= 生命周期 =================

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        startForegroundNotify();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 无差异化 action：start 即守护；stop 走 stopService()
        startForegroundNotify();
        return START_STICKY;
    }

    /**
     * v2.4.2 根修（机主实测「从最近任务划掉 App 后，权限中心常驻守护显示未授权」）：
     * 国产 ROM 从最近任务划掉 = 强杀进程，START_STICKY 的系统重建不可靠；这里在
     * onTaskRemoved 里用 AlarmManager 定个 900ms 的「自杀闹钟」拉起本服务——
     * 只要用户还开着守护开关（enabled），划掉后台一秒内自动复活，权限中心状态回真。
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        try {
            if (isEnabled(this)) {
                android.app.AlarmManager am = (android.app.AlarmManager) getSystemService(Context.ALARM_SERVICE);
                Intent i = new Intent(this, KeepAliveService.class);
                android.app.PendingIntent pi = android.app.PendingIntent.getService(
                        this, 4451, i,
                        android.os.Build.VERSION.SDK_INT >= 26
                                ? android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT
                                : android.app.PendingIntent.FLAG_UPDATE_CURRENT);
                long at = System.currentTimeMillis() + 900L;
                if (android.os.Build.VERSION.SDK_INT >= 31) {
                    try {
                        am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
                    } catch (SecurityException se) {
                        am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
                    }
                } else {
                    am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
                }
            }
        } catch (Throwable ignored) {
            // 自拉起失败（ROM 拦截）：交给 START_STICKY 兜底
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ================= 常驻通知 =================

    private void startForegroundNotify() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "AI 守护常驻", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("AI Phone 后台守护的常驻通知（防系统杀后台）");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.presence_online)
                    .setContentTitle("AI Phone 正在守候")
                    .setContentText("TA 的吃醋锁与查岗感知随时待命（保持后台守护）")
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .build();
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFY_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIFY_ID, n);
            }
        } catch (Throwable ignored) {
            // 通知失败不阻塞守护
        }
    }

    // ================= JS 桥静态入口（插件调用） =================

    /** 用户是否开启过常驻守护（持久化；BootReceiver 开机据此拉起） */
    public static boolean isEnabled(Context ctx) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            return sp.getBoolean(KEY_ENABLED, false);
        } catch (Throwable t) {
            return false;
        }
    }

    /** 服务当前是否存活 */
    public static boolean isRunning() {
        return running;
    }

    /** 开启常驻守护：记开关 + 拉起前台服务；返回 null=ok，否则失败原因 */
    public static String start(Context ctx) {
        try {
            ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit().putBoolean(KEY_ENABLED, true).apply();
            Intent i = new Intent(ctx, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
            return null;
        } catch (Throwable t) {
            // Android 12+ 后台前台服务限制等（极少数场景：App 退到后台超 10s 后开启）
            return t.getMessage() == null ? "start-failed" : t.getMessage();
        }
    }

    /** 关闭常驻守护：清开关 + 停服务（BootReceiver 不再自启） */
    public static void stop(Context ctx) {
        try {
            ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit().putBoolean(KEY_ENABLED, false).apply();
            ctx.stopService(new Intent(ctx, KeepAliveService.class));
        } catch (Throwable ignored) {
        }
    }

    /** BootReceiver 开机拉起（只在用户开启过时；失败静默——开机场景没有 UI 可报） */
    public static void startFromBoot(Context ctx) {
        if (!isEnabled(ctx)) return;
        try {
            Intent i = new Intent(ctx, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } catch (Throwable ignored) {
            // 开机自启被 ROM 拦截（未允许自启动）等：静默
        }
    }
}
