package com.z.aiphone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
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
 * 应用锁定遮罩服务（v2.0.0 去 Shizuku 化核心 / v2.2.0 「点击立即弹回桌面」重构）：
 * 真机「吃醋锁 / 应用锁定」的原生引擎。
 *
 * 【v2.2.0 拦截闭环（机主规格）】
 *   1) 双通道实时感知前台应用：
 *      - 无障碍事件流（AiAccessibilityService TYPE_WINDOW_STATE_CHANGED →
 *        notifyForegroundHit 静态钩子，零延迟）；
 *      - UsageStats 事件流轮询兜底（无障碍未开启时 2s 一轮）。
 *   2) 检测到锁定名单内的应用一露头 → 【立刻】双动作：
 *      - ACTION_MAIN + CATEGORY_HOME 弹回手机桌面（建锁前置校验悬浮窗权限，
 *        持有 overlay 视图 = 可见窗口，豁免 Android 10+ 后台启动限制）；
 *      - 紧接着弹出全局全屏拦截窗（TYPE_APPLICATION_OVERLAY，盖在桌面之上）：
 *        AI 质问文案 + 真实倒计时（每秒刷新）+【去哄哄 TA】（拉起本 App 直达聊天）+
 *        【我知道了】（收起遮罩，回桌面）。
 *      绝不等用户在被锁应用里做任何操作。
 *   3) 每拦截一次（用户反复手贱点被锁 App）→ openAttempts++ 且逐次落盘
 *      lock-attempt 事件（带第 N 次），JS 醒来后经 jealousyGuardDrainEvents
 *      取走 → AI 收到信号按人设记忆发消息（网页侧 real-app-freeze 处理）。
 *   4) 到期（unlockAt）自动解锁并落盘 native-unlock 事件（JS 对账清记录）。
 *
 * 【与 JS 侧分工】建锁/续锁/哄好解锁都由 JS 发起（经插件 jealousyGuardSyncLock /
 * lockApp 把 pkg/unlockAt/charName/message/contactId/app 同步过来；pkg 空 = 解锁停服务）。
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
    /** v2.2.0：锁定者联系人 id + 所在 App（去哄哄按钮拉起本 App 后直达对应聊天） */
    private static final String EXTRA_CONTACT_ID = "contactId";
    private static final String EXTRA_APP_KIND = "appKind";

    /** 静态锁状态（跨实例共享；JS 经插件读写） */
    private static volatile String lockPkg = null;
    private static volatile long unlockAt = 0L; // 0 = 直到哄好（不判到期）
    private static volatile String charName = "";
    private static volatile String message = "";
    private static volatile String contactId = "";
    private static volatile String appKind = ""; // 'wx' | 'qq' | 'sms'（空 = 无去哄哄按钮）
    private static volatile boolean serviceRunning = false;
    private static volatile boolean overlayShowing = false;
    /** 遮罩期间用户仍停留在锁定 App / 反复点开被拦的总次数（每次拦截 +1） */
    private static volatile int openAttempts = 0;

    /** 事件落盘（协议与旧 JealousyGuardService 兼容：native-unlock / lock-shown / lock-attempt / degrade） */
    private static final String PREFS_NAME = "jealousy_guard"; // 沿用旧文件名：旧事件一并兼容
    private static final String EVENTS_KEY = "events";
    private static final int EVENT_RING_MAX = 50;

    /** v2.1.0 锁状态持久化（重启重梳用）：syncLock 建锁时写入、解锁时清空；
     * BootReceiver 开机后据此把重启前还活跃的吃醋锁重新武装 */
    private static final String KEY_ACTIVE_PKG = "active_pkg";
    private static final String KEY_ACTIVE_UNLOCK_AT = "active_unlock_at";
    private static final String KEY_ACTIVE_CHAR = "active_char";
    private static final String KEY_ACTIVE_MSG = "active_msg";
    private static final String KEY_ACTIVE_CONTACT = "active_contact";
    private static final String KEY_ACTIVE_APP_KIND = "active_app_kind";

    /** 常驻前台通知（IMPORTANCE_LOW 静默） */
    private static final String CHANNEL_ID = "lock_guard";
    private static final int NOTIFY_ID = 7791;

    /** 轮询周期：v2.2.0 3s → 2s（无障碍实时钩子为主，这里只是无障碍未开启时的兜底） */
    private static final long POLL_MS = 2000L;

    /** 同一次拦截的防抖窗（800ms 内无障碍事件 + 轮询双通道同时命中只算一次） */
    private static final long HIT_DEBOUNCE_MS = 800L;
    private static volatile long lastHitAt = 0L;

    /** v2.2.0 拦截窗保持窗口：弹回桌面后拦截窗继续盖在桌面上展示质问/倒计时，
     * 用户点【我知道了】或超出保持窗（15s）才收起——否则 goHome 后下一轮 2s 轮询
     * 判定「已离开锁定应用」立刻收窗，拦截窗只闪现两秒根本看不清 */
    private static final long OVERLAY_HOLD_MS = 15_000L;
    private static volatile long overlayHoldUntil = 0L;

    /** lock-attempt 事件落盘节流（每次拦截都值得 AI 知道；2s 节流只防单次停留重复计数） */
    private static final long ATTEMPT_EVENT_MS = 2_000L;
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
    /** v2.2.0 倒计时每秒刷新线程（遮罩可见期间驱动；与引擎线程分离防互相阻塞） */
    private Handler uiTickHandler;
    private HandlerThread uiTickThread;
    private WindowManager wm;
    private FrameLayout overlayView;

    // ================= 生命周期 =================

    @Override
    public void onCreate() {
        super.onCreate();
        serviceRunning = true;
        instance = this; // v2.2.0 无障碍实时钩子直达入口
        appCtx = getApplicationContext();
        startForegroundNotify();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        engineThread = new HandlerThread("lock_overlay_engine");
        engineThread.start();
        engine = new Handler(engineThread.getLooper());
        uiTickThread = new HandlerThread("lock_overlay_ui_tick");
        uiTickThread.start();
        uiTickHandler = new Handler(uiTickThread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String pkg = intent == null ? null : intent.getStringExtra(EXTRA_PKG);
        long ua = intent == null ? 0L : intent.getLongExtra(EXTRA_UNLOCK_AT, 0L);
        String cn = intent == null ? "" : intent.getStringExtra(EXTRA_CHAR_NAME);
        String msg = intent == null ? "" : intent.getStringExtra(EXTRA_MESSAGE);
        String cid = intent == null ? "" : intent.getStringExtra(EXTRA_CONTACT_ID);
        String ak = intent == null ? "" : intent.getStringExtra(EXTRA_APP_KIND);

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
        contactId = cid == null ? "" : cid.trim();
        appKind = ak == null ? "" : ak.trim();
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
        if (uiTickHandler != null) uiTickHandler.removeCallbacksAndMessages(null);
        if (engineThread != null) {
            engineThread.quitSafely();
            engineThread = null;
        }
        if (uiTickThread != null) {
            uiTickThread.quitSafely();
            uiTickThread = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ================= v2.2.0 无障碍实时钩子（AiAccessibilityService 调用） =================

    /**
     * 无障碍事件流实时回调：TYPE_WINDOW_STATE_CHANGED 检测到包名进入前台。
     * 只在本服务持锁（lockPkg 非空）且包名命中时行动——零轮询延迟，露头即拦。
     * 服务未运行时静默（无锁可拦）。
     */
    public static void notifyForegroundHit(String pkg) {
        if (!serviceRunning || lockPkg == null) return;
        if (pkg == null || !pkg.equals(lockPkg)) return;
        final LockOverlayService svc = instance;
        if (svc == null || svc.engine == null) return;
        // 转发到引擎线程执行（无障碍事件在主线程回调，拦截逻辑统一走引擎线程防竞态）
        svc.engine.post(() -> {
            try {
                svc.handleLockHit("a11y");
            } catch (Throwable ignored) {
                // 拦截链路绝不 crash
            }
        });
    }

    /** 运行中的服务实例（notifyForegroundHit 直达；onCreate 赋值 / onDestroy 清空） */
    private static volatile LockOverlayService instance;

    // ================= 引擎（2s 轮询兜底 + 拦截处理） =================
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

            // ③ 前台判定（UsageStats 事件流，取最近一条 RESUMED 的包名）——无障碍钩子的兜底通道
            String fg = currentForegroundPkg();
            boolean onLocked = fg != null && fg.equals(lockPkg);

            if (onLocked) {
                handleLockHit("poll"); // v2.2.0：检测到 → 立即回桌面 + 弹拦截窗
            } else if (overlayShowing && System.currentTimeMillis() >= overlayHoldUntil) {
                // 已离开锁定 App（被弹回桌面/切走）且超出保持窗：收起遮罩（再开还会再弹）。
                // 保持窗内的拦截窗不收——那正是给用户看的质问/倒计时界面。
                removeOverlay();
            }
        } catch (Throwable ignored) {
            // 引擎绝不 crash
        }
        scheduleTick(POLL_MS);
    }

    /**
     * v2.2.0 拦截核心：锁定应用露头（无障碍实时钩子或轮询兜底命中）→
     * ① 立刻弹回桌面（不等用户在被锁应用里做任何操作）；
     * ② 紧接着弹出全屏拦截窗（盖在桌面之上：质问文案 + 倒计时 + 去哄哄）；
     * ③ 每次拦截计数 +1 且节流落盘 lock-attempt 事件（AI 感知强行突破的信号源）。
     */
    private void handleLockHit(String via) {
        try {
            long now = System.currentTimeMillis();
            // 双通道防抖：800ms 内无障碍 + 轮询同时命中只算一次拦截
            if (now - lastHitAt < HIT_DEBOUNCE_MS) return;
            lastHitAt = now;

            openAttempts++;
            // 逐次落盘 lock-attempt（2s 节流防单次停留重复；文本带累计次数——
            // JS 侧 drain 后驱动 AI 按人设质问「又去点了？」）
            if (now - lastAttemptEventAt >= ATTEMPT_EVENT_MS) {
                lastAttemptEventAt = now;
                persistEvent("lock-attempt", lockPkg, "第" + openAttempts + "次想打开");
            }

            // ① 立刻弹回桌面：持有悬浮窗权限（建锁前置校验）+ overlay 可见窗口 = 豁免
            //    Android 10+ 后台 Activity 启动限制；HOME intent 双保险。
            goHome();

            // ② 弹全屏拦截窗（盖在桌面之上，用户看到的第一屏就是 TA 的质问）
            if (!overlayShowing) {
                persistEvent("lock-shown", lockPkg, message);
                showOverlay();
            }
            overlayHoldUntil = now + OVERLAY_HOLD_MS; // 刷新保持窗：这轮拦截的窗持续展示
            refreshOverlayTexts();
        } catch (Throwable ignored) {
            // 拦截链路绝不 crash
        }
    }

    /** 弹回手机主屏幕（Home Screen） */
    private void goHome() {
        try {
            Intent i = new Intent(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_HOME);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            startActivity(i);
        } catch (Throwable ignored) {
            // 个别 ROM 拦截：遮罩仍然弹出，用户点【我知道了】回桌面
        }
    }

    /** 内部解锁：收遮罩 + 清锁状态（含持久化）+ 停服务（reason 只用于日志口径，不落盘） */
    private void internalUnlock(String reason) {
        removeOverlay();
        instance = null;
        lockPkg = null;
        unlockAt = 0L;
        message = "";
        contactId = "";
        appKind = "";
        openAttempts = 0;
        overlayHoldUntil = 0L;
        clearPersistedLock(getApplicationContext());
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /** v2.1.0 清掉持久化的活跃锁（解锁链路共用；ctx 显式传入——服务未运行的解锁路径 appCtx 可能还没建） */
    private static void clearPersistedLock(Context ctx) {
        try {
            Context app = ctx != null ? ctx : appCtx;
            if (app == null) return;
            app.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit().remove(KEY_ACTIVE_PKG).remove(KEY_ACTIVE_UNLOCK_AT)
                    .remove(KEY_ACTIVE_CHAR).remove(KEY_ACTIVE_MSG)
                    .remove(KEY_ACTIVE_CONTACT).remove(KEY_ACTIVE_APP_KIND).apply();
        } catch (Throwable ignored) {
        }
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

    // ================= 全屏拦截窗（SYSTEM_ALERT_WINDOW） =================

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
            startUiTick(); // v2.2.0：遮罩期间倒计时每秒刷新
        } catch (Throwable t) {
            overlayShowing = false;
            overlayView = null;
        }
    }

    /** 构建拦截窗视图（纯代码布局：深色渐变 + AI 质问文案 + 每秒倒计时 + 去哄哄/我知道了） */
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

        // 倒计时行（v2.2.0：真实剩余时间，每秒刷新）
        TextView countdown = new TextView(ctx);
        countdown.setTextSize(15);
        countdown.setTextColor(Color.parseColor("#B8BEDC"));
        countdown.setGravity(Gravity.CENTER);
        countdown.setPadding(0, dp(14), 0, 0);
        countdown.setTag("countdown");
        countdown.setText(countdownText());
        box.addView(countdown);

        // 拦截次数行（反复手贱点开时显示，AI 感知强行突破的原生展示）
        TextView attempts = new TextView(ctx);
        attempts.setTextSize(12);
        attempts.setTextColor(Color.parseColor("#8C92B4"));
        attempts.setGravity(Gravity.CENTER);
        attempts.setPadding(0, dp(6), 0, 0);
        attempts.setTag("attempts");
        box.addView(attempts);

        // 【去哄哄 TA】按钮（v2.2.0：拉起本 App 直达对应聊天——复用 localNotify 点击直达协议）
        if (contactId != null && !contactId.isEmpty()) {
            Button coax = new Button(ctx);
            coax.setText("去哄哄 " + who);
            coax.setTextSize(16);
            coax.setTextColor(Color.parseColor("#221A33"));
            coax.setPadding(dp(30), 0, dp(30), 0);
            coax.setAllCaps(false);
            GradientDrawable coaxBg = new GradientDrawable();
            coaxBg.setCornerRadius(dp(24));
            coaxBg.setColor(Color.parseColor("#FFE3EC"));
            coax.setBackground(coaxBg);
            coax.setOnClickListener((v) -> {
                try {
                    openChatWithTarget();
                } catch (Throwable ignored) {
                }
                // 遮罩保留（没哄好之前锁还在），但用户已进聊天界面；锁到期/哄好解锁时自动收起
            });
            LinearLayout.LayoutParams coaxLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
            coaxLp.topMargin = dp(30);
            box.addView(coax, coaxLp);
        }

        // 【我知道了】按钮（收起遮罩回桌面；再点被锁 App 还会再弹）
        Button home = new Button(ctx);
        home.setText("我知道了");
        home.setTextSize(15);
        home.setTextColor(Color.parseColor("#D8DCEF"));
        home.setPadding(dp(30), 0, dp(30), 0);
        home.setAllCaps(false);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(24));
        bg.setColor(Color.parseColor("#3A3550"));
        bg.setStroke(dp(1), Color.parseColor("#55507A"));
        home.setBackground(bg);
        home.setOnClickListener((v) -> {
            try {
                goHome(); // 保险：若用户从其他入口进来，再送一程回桌面
            } catch (Throwable ignored) {
            }
            removeOverlay(); // 立即收起（点按钮=用户放弃打开，tick 会再判定）
        });
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(46));
        btnLp.topMargin = contactId != null && !contactId.isEmpty() ? dp(12) : dp(30);
        box.addView(home, btnLp);

        FrameLayout.LayoutParams fl = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
        root.addView(box, fl);
        return root;
    }

    /**
     * 去哄哄：拉起 MainActivity 并带上 localNotify 同款 target extra
     * （{app:'wechat'|'qq'|'chat', contactId}）→ handleOnNewIntent →
     * injectLocalNotifyOpen → 网页导航总线直达对应聊天界面。
     * 冷启动（App 被杀过）由 MainActivity.onCreate 的 extras 兜底处理。
     */
    private void openChatWithTarget() {
        try {
            String navApp = "wx".equals(appKind) ? "wechat" : "qq".equals(appKind) ? "qq" : "chat";
            JSONObject target = new JSONObject();
            target.put("app", navApp);
            target.put("contactId", contactId);
            Intent i = new Intent(this, MainActivity.class);
            i.setPackage(getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            i.putExtra("local_notify_url", "/");
            i.putExtra("local_notify_target", target.toString());
            startActivity(i);
        } catch (Throwable ignored) {
            // 拉起失败：至少回 App 首页
            try {
                Intent i = new Intent(this, MainActivity.class);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
                startActivity(i);
            } catch (Throwable ignored2) {
            }
        }
    }

    /** v2.2.0 倒计时每秒刷新（uiTickHandler 驱动；到期即时解锁免等下一轮 tick） */
    private void startUiTick() {
        if (uiTickHandler == null) return;
        uiTickHandler.removeCallbacksAndMessages(null);
        uiTickHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    if (!overlayShowing || uiTickHandler == null) return;
                    // 到期即时解锁（倒计时最后一秒落地，免等 2s 轮询）
                    if (unlockAt != 0 && System.currentTimeMillis() >= unlockAt) {
                        persistEvent("native-unlock", lockPkg, "");
                        internalUnlock("expired");
                        return;
                    }
                    refreshOverlayTexts();
                    uiTickHandler.postDelayed(this, 1000L);
                } catch (Throwable ignored) {
                    // UI 刷新绝不 crash
                }
            }
        }, 1000L);
    }

    /** 每秒刷新倒计时文案 + 拦截次数行 */
    private void refreshOverlayTexts() {
        try {
            if (overlayView == null) return;
            TextView countdown = (TextView) overlayView.findViewWithTag("countdown");
            if (countdown != null) {
                countdown.setText(countdownText());
            }
            TextView attempts = (TextView) overlayView.findViewWithTag("attempts");
            if (attempts != null) {
                attempts.setText(openAttempts >= 2
                        ? "这是你第 " + openAttempts + " 次想打开它了"
                        : "");
            }
        } catch (Throwable ignored) {
        }
    }

    private String countdownText() {
        if (unlockAt == 0) return "哄好 " + (charName == null || charName.isEmpty() ? "TA" : charName) + " 之前，这个应用就归我管了";
        long left = unlockAt - System.currentTimeMillis();
        if (left <= 0) return "马上解锁…";
        long min = left / 60_000L;
        long sec = (left % 60_000L) / 1000L;
        if (min >= 1) return "剩余 " + min + " 分 " + (sec < 10 ? "0" : "") + sec + " 秒自动解锁";
        return "剩余 " + sec + " 秒自动解锁";
    }

    private void removeOverlay() {
        try {
            if (uiTickHandler != null) uiTickHandler.removeCallbacksAndMessages(null);
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
                    .setContentText("锁定名单应用将被立即弹回桌面")
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
    public static String syncLock(Context ctx, String pkg, long ua, String charName, String message,
                                  String contactId, String appKind) {
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
                clearPersistedLock(ctx); // v2.1.0 同步清掉持久化锁
                return null;
            }
            if (!pkg.matches("^[\\w.]+$")) return "bad-pkg";
            if (!Settings.canDrawOverlays(ctx)) return "no-overlay-permission";
            // v2.1.0 锁状态持久化：重启后 BootReceiver 据此重梳还活跃的吃醋锁
            try {
                ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit().putString(KEY_ACTIVE_PKG, pkg)
                        .putLong(KEY_ACTIVE_UNLOCK_AT, ua)
                        .putString(KEY_ACTIVE_CHAR, charName == null ? "" : charName)
                        .putString(KEY_ACTIVE_MSG, message == null ? "" : message)
                        .putString(KEY_ACTIVE_CONTACT, contactId == null ? "" : contactId)
                        .putString(KEY_ACTIVE_APP_KIND, appKind == null ? "" : appKind)
                        .apply();
            } catch (Throwable ignored) {
            }
            Intent i = new Intent(ctx, LockOverlayService.class);
            i.putExtra(EXTRA_PKG, pkg);
            i.putExtra(EXTRA_UNLOCK_AT, ua);
            i.putExtra(EXTRA_CHAR_NAME, charName == null ? "" : charName);
            i.putExtra(EXTRA_MESSAGE, message == null ? "" : message);
            i.putExtra(EXTRA_CONTACT_ID, contactId == null ? "" : contactId);
            i.putExtra(EXTRA_APP_KIND, appKind == null ? "" : appKind);
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
        public int openAttempts;
    }

    public static Snapshot snapshot(Context ctx) {
        Snapshot s = new Snapshot();
        s.running = serviceRunning;
        s.pkg = lockPkg;
        s.unlockAt = unlockAt;
        s.overlayShown = overlayShowing;
        s.openAttempts = openAttempts;
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

    // ================= v2.1.0 开机重梳（BootReceiver 调用） =================

    /**
     * 重启后重梳持久化的活跃吃醋锁：重启前没到期（或锁到哄好 unlockAt=0）的锁
     * 重新武装遮罩锁；已过期/无锁则只清持久化记录。权限缺失（悬浮窗被系统回收）
     * 时 syncLock 会返回失败原因——静默保留持久化，用户重开 App 后 JS 侧自愈重锁。
     */
    public static void rearmFromPrefs(Context ctx) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String pkg = sp.getString(KEY_ACTIVE_PKG, null);
            if (pkg == null || pkg.trim().isEmpty() || !pkg.matches("^[\\w.]+$")) {
                clearPersistedLock(ctx);
                return;
            }
            long ua = sp.getLong(KEY_ACTIVE_UNLOCK_AT, 0L);
            // 已到期：不重梳，清记录（JS 醒来后 drain 事件对账自然收敛）
            if (ua != 0 && System.currentTimeMillis() >= ua) {
                clearPersistedLock(ctx);
                return;
            }
            String ch = sp.getString(KEY_ACTIVE_CHAR, "");
            String msg = sp.getString(KEY_ACTIVE_MSG, "");
            String cid = sp.getString(KEY_ACTIVE_CONTACT, "");
            String ak = sp.getString(KEY_ACTIVE_APP_KIND, "");
            syncLock(ctx, pkg, ua, ch, msg, cid, ak);
        } catch (Throwable ignored) {
            // 开机重梳绝不 crash
        }
    }
}
