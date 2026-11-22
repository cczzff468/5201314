package com.z.aiphone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Process;
import android.provider.Settings;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 应用锁定遮罩服务（v2.0.0 去 Shizuku 化核心）：真机「吃醋锁 / 应用锁定」的原生引擎。
 *
 * 【替代方案】旧实现经 Shizuku 以 shell 权限执行 pm suspend（应用被系统级挂起）。
 * 普通应用没有任何公开 API 能挂起别的应用，去 Shizuku 后改为「悬浮窗遮罩锁」：
 *
 *   1) 经「使用情况访问权限」每 3 秒轮询一次前台应用（UsageStatsManager
 *      .queryEvents 事件流，取最近一条 ACTIVITY_RESUMED 的包名）；
 *   2) 检测到锁定名单内的应用进入前台 → 立刻经「悬浮窗权限」在最顶层弹出
 *      全屏遮罩（TYPE_APPLICATION_OVERLAY），拦截用户对该应用的一切操作；
 *   3) 遮罩上显示 AI 的质问文案（如「被我没收啦，说了要专心」）+ 倒计时 +
 *      【回到桌面】按钮（回桌面后遮罩自动收起，再开还会再弹）；
 *   4) 锁到期（unlockAt）自动解锁并落盘 native-unlock 事件；
 *   5) 全程事件落盘（lock-shown / lock-attempt / degrade），JS 醒来后经
 *      jealousyGuardDrainEvents 取走对账 —— 事件协议与旧 JealousyGuardService 兼容。
 *
 * 【与 JS 侧分工】建锁/续锁/哄好解锁都由 JS 发起（经插件 jealousyGuardSyncLock /
 * lockApp 把 pkg/unlockAt/charName/message 同步过来；pkg 空 = JS 已解锁，停服务）。
 * 本服务只负责原生兜底：WebView 被杀/冻结时锁依然生效（前台服务独立于 WebView 存活）。
 *
 * 【安全】只锁 JS 指定的单个包名（^[\w.]+$ 校验）；遮罩只覆盖不劫持数据；
 * 永不锁 com.android.systemui / 自身 / 拨号（锁屏界面被盖住会变成砖）。
 */
public class LockOverlayService extends Service {

    // ================= Intent extras / 静态锁状态 =================

    private static final String EXTRA_PKG = "pkg";
    private static final String EXTRA_UNLOCK_AT = "unlockAt";
    private static final String EXTRA_CHAR_NAME = "charName";
    private static final String EXTRA_MESSAGE = "message";

    /** 静态锁状态（跨实例共享；JS 经插件读写） */
    private static volatile String lockPkg = null;
    private static volatile long unlockAt = 0L; // 0 = 直到哄好（不判到期）
    private static volatile String charName = "";
    private static volatile String message = "";
    private static volatile boolean serviceRunning = false;
    private static volatile boolean overlayShowing = false;
    private static volatile int openAttempts = 0; // 遮罩期间用户仍停留在锁定 App 的轮询计数

    /** 事件落盘（协议与旧 JealousyGuardService 兼容：native-unlock / lock-shown / lock-attempt / degrade） */
    private static final String PREFS_NAME = "jealousy_guard"; // 沿用旧文件名：旧事件一并兼容
    private static final String EVENTS_KEY = "events";
    private static final int EVENT_RING_MAX = 50;

    /** 常驻前台通知（IMPORTANCE_LOW 静默） */
    private static final String CHANNEL_ID = "lock_guard";
    private static final int NOTIFY_ID = 7791;

    /** 轮询周期：3 秒（机主规格） */
    private static final long POLL_MS = 3000L;

    /** lock-attempt 事件节流（遮罩期间持续停留在锁定 App，每 45s 落盘一次） */
    private static final long ATTEMPT_EVENT_MS = 45_000L;
    private static volatile long lastAttemptEventAt = 0L;

    /** degrade 事件节流（权限丢失类，每 5 分钟最多一条） */
    private static final long DEGRADE_EVENT_MS = 5 * 60_000L;
    private static volatile long lastDegradeEventAt = 0L;

    /** 永不锁名单（锁屏界面/系统 UI/自身/拨号：盖住锁屏 = 变砖） */
    private static final String[] NEVER_LOCK = {
            "com.android.systemui", "com.z.aiphone", "com.android.dialer",
            "com.android.incallui", "com.android.phone", "com.android.settings"
    };

    private HandlerThread engineThread;
    private Handler engine;
    private WindowManager wm;
    private FrameLayout overlayView;

    // ================= 生命周期 =================

    @Override
    public void onCreate() {
        super.onCreate();
        serviceRunning = true;
        appCtx = getApplicationContext();
        startForegroundNotify();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        engineThread = new HandlerThread("lock_overlay_engine");
        engineThread.start();
        engine = new Handler(engineThread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String pkg = intent == null ? null : intent.getStringExtra(EXTRA_PKG);
        long ua = intent == null ? 0L : intent.getLongExtra(EXTRA_UNLOCK_AT, 0L);
        String cn = intent == null ? "" : intent.getStringExtra(EXTRA_CHAR_NAME);
        String msg = intent == null ? "" : intent.getStringExtra(EXTRA_MESSAGE);

        if (pkg == null || pkg.trim().isEmpty() || !pkg.matches("^[\\w.]+$")) {
            // pkg 空 = 解锁：收遮罩、停服务
            internalUnlock("js-unlock");
            return START_NOT_STICKY;
        }
        // 永不锁名单：如实拒绝（JS 侧也有同款名单，这里兜底）
        for (String bad : NEVER_LOCK) {
            if (bad.equals(pkg)) {
                internalUnlock("never-lock-" + pkg);
                return START_NOT_STICKY;
            }
        }

        lockPkg = pkg;
        unlockAt = ua;
        charName = cn == null ? "" : cn.trim();
        message = msg == null ? "" : msg.trim();
        openAttempts = 0;
        startForegroundNotify();
        scheduleTick(0L); // 立即首轮
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        serviceRunning = false;
        removeOverlay();
        if (engine != null) engine.removeCallbacksAndMessages(null);
        if (engineThread != null) {
            engineThread.quitSafely();
            engineThread = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ================= 引擎（3s 轮询） =================

    private void scheduleTick(long delayMs) {
        if (engine == null) return;
        engine.postDelayed(this::tick, delayMs <= 0 ? 0 : delayMs);
    }

    private void tick() {
        try {
            // ① 到期自动解锁（unlockAt=0 表示直到哄好，不判到期）
            if (unlockAt != 0 && System.currentTimeMillis() >= unlockAt) {
                persistEvent("native-unlock", lockPkg, "");
                internalUnlock("expired");
                return;
            }

            // ② 权限自检：使用情况 / 悬浮窗（丢失 → degrade 事件，节流）
            if (!hasUsageAccess()) {
                degradeNow("usage-access-lost");
                scheduleTick(POLL_MS);
                return; // 无使用情况权限 = 看不见前台，无法判定（遮罩保留现状）
            }
            if (!Settings.canDrawOverlays(this)) {
                degradeNow("overlay-permission-lost");
                scheduleTick(POLL_MS);
                return;
            }

            // ③ 前台判定（UsageStats 事件流，取最近一条 RESUMED 的包名）
            String fg = currentForegroundPkg();
            boolean onLocked = fg != null && fg.equals(lockPkg);

            // ④ 遮罩联动：进锁定 App → 弹全屏遮罩；离开 → 收起
            if (onLocked && !overlayShowing) {
                openAttempts++;
                persistEvent("lock-shown", lockPkg, message);
                showOverlay();
            } else if (!onLocked && overlayShowing) {
                removeOverlay(); // 用户回桌面/切走：收起遮罩（再开还会再弹）
            } else if (onLocked && overlayShowing) {
                // 仍停留在锁定 App（遮罩盖着点不进去）：累计尝试并节流落盘
                openAttempts++;
                long now = System.currentTimeMillis();
                if (now - lastAttemptEventAt >= ATTEMPT_EVENT_MS) {
                    lastAttemptEventAt = now;
                    persistEvent("lock-attempt", lockPkg, "第" + openAttempts + "次想打开");
                }
                refreshOverlayTexts();
            }
        } catch (Throwable ignored) {
            // 引擎绝不 crash
        }
        scheduleTick(POLL_MS);
    }

    /** 内部解锁：收遮罩 + 清锁状态 + 停服务（reason 只用于日志口径，不落盘） */
    private void internalUnlock(String reason) {
        removeOverlay();
        lockPkg = null;
        unlockAt = 0L;
        message = "";
        openAttempts = 0;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /** 权限失效 degrade 事件（节流） */
    private void degradeNow(String reason) {
        long now = System.currentTimeMillis();
        if (now - lastDegradeEventAt < DEGRADE_EVENT_MS) return;
        lastDegradeEventAt = now;
        persistEvent("degrade", lockPkg, reason);
    }

    // ================= 前台判定（UsageStats 事件流） =================

    /** 最近一条 ACTIVITY_RESUMED 的包名 = 当前前台（无权限/无事件返回 null） */
    private String currentForegroundPkg() {
        try {
            UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return null;
            long now = System.currentTimeMillis();
            UsageEvents events = usm.queryEvents(now - 20_000L, now);
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

    /** 「使用情况访问」AppOps 真实状态 */
    private boolean hasUsageAccess() {
        try {
            AppOpsManager aom = (AppOpsManager) getSystemService(Context.APP_OPS_SERVICE);
            return aom != null && aom.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(), getPackageName()) == AppOpsManager.MODE_ALLOWED;
        } catch (Throwable t) {
            return false;
        }
    }

    // ================= 全屏遮罩（SYSTEM_ALERT_WINDOW） =================

    private void showOverlay() {
        if (overlayShowing || wm == null) return;
        try {
            int type = Build.VERSION.SDK_INT >= 26
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE; // minSdk 24：老系统 TYPE_PHONE 仍可用

            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                    type,
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                            | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                    PixelFormat.OPAQUE);

            overlayView = buildOverlayView();
            wm.addView(overlayView, lp);
            overlayShowing = true;
        } catch (Throwable t) {
            overlayShowing = false;
            overlayView = null;
        }
    }

    /** 构建遮罩视图（纯代码布局，不依赖 res：深色渐变 + AI 质问文案 + 倒计时 + 回到桌面按钮） */
    private FrameLayout buildOverlayView() {
        final Context ctx = this;
        FrameLayout root = new FrameLayout(ctx);
        root.setBackgroundColor(Color.parseColor("#F2191B2E"));

        LinearLayout box = new LinearLayout(ctx);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(36), dp(72), dp(36), dp(48));

        // 图标行
        TextView icon = new TextView(ctx);
        icon.setText("🚫");
        icon.setTextSize(44);
        icon.setGravity(Gravity.CENTER);
        box.addView(icon);

        // 标题：{角色名}的吃醋封印
        TextView title = new TextView(ctx);
        String who = charName == null || charName.isEmpty() ? "TA" : charName;
        title.setText(who + "的吃醋封印");
        title.setTextSize(21);
        title.setTypeface(Typeface.DEFAULT_BOLD, Typeface.BOLD);
        title.setTextColor(Color.parseColor("#FFD7DE"));
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(18), 0, dp(10));
        box.addView(title);

        // AI 质问文案
        TextView msg = new TextView(ctx);
        msg.setText(message == null || message.isEmpty() ? "被我没收啦，说了要专心。" : message);
        msg.setTextSize(16);
        msg.setTextColor(Color.WHITE);
        msg.setGravity(Gravity.CENTER);
        msg.setLineSpacing(dp(4), 1f);
        msg.setTag("msg");
        box.addView(msg);

        // 倒计时行
        TextView countdown = new TextView(ctx);
        countdown.setTextSize(14);
        countdown.setTextColor(Color.parseColor("#B8BEDC"));
        countdown.setGravity(Gravity.CENTER);
        countdown.setPadding(0, dp(14), 0, 0);
        countdown.setTag("countdown");
        box.addView(countdown);

        // 回到桌面按钮
        Button home = new Button(ctx);
        home.setText("回到桌面");
        home.setTextSize(16);
        home.setTextColor(Color.parseColor("#221A33"));
        home.setPadding(dp(34), 0, dp(34), 0);
        home.setAllCaps(false);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(24));
        bg.setColor(Color.parseColor("#FFE3EC"));
        home.setBackground(bg);
        home.setOnClickListener((v) -> {
            try {
                Intent i = new Intent(Intent.ACTION_MAIN);
                i.addCategory(Intent.CATEGORY_HOME);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Throwable ignored) {
            }
            removeOverlay(); // 立即收起（点按钮=用户放弃打开，tick 会再判定）
        });
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, dp(52));
        btnLp.topMargin = dp(30);
        btnLp.gravity = Gravity.CENTER_HORIZONTAL;
        box.addView(home, btnLp);

        FrameLayout.LayoutParams fl = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
        root.addView(box, fl);
        return root;
    }

    /** 每轮 tick 刷新倒计时文案 */
    private void refreshOverlayTexts() {
        try {
            if (overlayView == null) return;
            TextView countdown = (TextView) overlayView.findViewWithTag("countdown");
            if (countdown != null) {
                countdown.setText(countdownText());
            }
        } catch (Throwable ignored) {
        }
    }

    private String countdownText() {
        if (unlockAt == 0) return "哄好 " + (charName == null || charName.isEmpty() ? "TA" : charName) + " 之前，这个应用就归我管了";
        long left = unlockAt - System.currentTimeMillis();
        if (left <= 0) return "马上解锁…";
        long min = left / 60_000L;
        if (min >= 1) return "还剩 " + min + " 分钟自动解锁";
        return "还剩 " + (left / 1000L) + " 秒自动解锁";
    }

    private void removeOverlay() {
        try {
            if (overlayView != null && wm != null) wm.removeView(overlayView);
        } catch (Throwable ignored) {
        }
        overlayView = null;
        overlayShowing = false;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    // ================= 前台服务通知 =================

    private void startForegroundNotify() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "应用锁定守护", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("吃醋锁/应用锁定生效期间的后台守护");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_lock_lock)
                    .setContentTitle("吃醋守护运行中")
                    .setContentText("锁定名单应用将被全屏遮罩拦截")
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .build();
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFY_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIFY_ID, n);
            }
        } catch (Throwable ignored) {
            // 通知失败不阻塞锁
        }
    }

    // ================= 事件落盘（环形 50 条，与旧协议兼容） =================

    /** 事件落盘用的应用级 context（onCreate 时缓存；服务存活期间必然可用） */
    private static volatile Context appCtx;

    /** 事件落盘（环形 50 条，与旧协议兼容） */
    private static void persistEvent(String type, String pkg, String text) {
        try {
            Context app = appCtx;
            if (app == null) return;
            SharedPreferences sp = app.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            JSONArray arr;
            try {
                arr = new JSONArray(sp.getString(EVENTS_KEY, "[]"));
            } catch (Throwable t) {
                arr = new JSONArray();
            }
            JSONObject o = new JSONObject();
            o.put("ts", System.currentTimeMillis());
            o.put("type", type);
            o.put("pkg", pkg == null ? "" : pkg);
            o.put("text", text == null ? "" : text);
            arr.put(o);
            while (arr.length() > EVENT_RING_MAX) {
                arr.remove(0);
            }
            sp.edit().putString(EVENTS_KEY, arr.toString()).apply();
        } catch (Throwable ignored) {
        }
    }

    // ================= JS 桥静态入口（插件调用） =================

    /** 建锁/续锁/解锁（pkg 空=解锁停服务）；返回 null=ok，否则失败原因 */
    public static String syncLock(Context ctx, String pkg, long ua, String charName, String message) {
        try {
            if (pkg == null || pkg.trim().isEmpty()) {
                // 解锁：服务可能未运行（无锁可解）也算成功
                if (serviceRunning) {
                    Intent stop = new Intent(ctx, LockOverlayService.class);
                    stop.putExtra(EXTRA_PKG, ""); // 空包名走解锁分支
                    if (Build.VERSION.SDK_INT >= 26) {
                        ctx.startForegroundService(stop);
                    } else {
                        ctx.startService(stop);
                    }
                } else {
                    lockPkg = null;
                    unlockAt = 0L;
                }
                return null;
            }
            if (!pkg.matches("^[\\w.]+$")) return "bad-pkg";
            if (!Settings.canDrawOverlays(ctx)) return "no-overlay-permission";
            Intent i = new Intent(ctx, LockOverlayService.class);
            i.putExtra(EXTRA_PKG, pkg);
            i.putExtra(EXTRA_UNLOCK_AT, ua);
            i.putExtra(EXTRA_CHAR_NAME, charName == null ? "" : charName);
            i.putExtra(EXTRA_MESSAGE, message == null ? "" : message);
            if (Build.VERSION.SDK_INT >= 26) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
            return null;
        } catch (Throwable t) {
            // Android 12+ 后台启动前台服务限制等
            return t.getMessage() == null ? "start-failed" : t.getMessage();
        }
    }

    /** 守护状态快照 */
    public static class Snapshot {
        public boolean running;
        public String pkg;
        public long unlockAt;
        public int eventCount;
        public boolean overlayShown;
        public boolean usageAccess;
        public boolean overlayPerm;
    }

    public static Snapshot snapshot(Context ctx) {
        Snapshot s = new Snapshot();
        s.running = serviceRunning;
        s.pkg = lockPkg;
        s.unlockAt = unlockAt;
        s.overlayShown = overlayShowing;
        s.eventCount = 0;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString(EVENTS_KEY, "[]"));
            s.eventCount = arr.length();
        } catch (Throwable ignored) {
        }
        try {
            AppOpsManager aom = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            s.usageAccess = aom != null && aom.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(), ctx.getPackageName()) == AppOpsManager.MODE_ALLOWED;
        } catch (Throwable ignored) {
        }
        s.overlayPerm = Settings.canDrawOverlays(ctx);
        return s;
    }

    /** 取走并清空落盘事件 */
    public static List<JSONObject> drainEvents(Context ctx) {
        List<JSONObject> out = new ArrayList<>();
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String raw = sp.getString(EVENTS_KEY, "[]");
            sp.edit().remove(EVENTS_KEY).apply();
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                out.add(arr.getJSONObject(i));
            }
        } catch (Throwable ignored) {
            // 脏数据 → 当空处理（已清掉）
        }
        return out;
    }
}
