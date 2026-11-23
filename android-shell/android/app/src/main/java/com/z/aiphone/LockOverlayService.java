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
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.Process;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;
import androidx.core.graphics.drawable.RoundedBitmapDrawable;
import androidx.core.graphics.drawable.RoundedBitmapDrawableFactory;

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
    /** v2.4.2 极简黑白灰拦截窗：锁定者头像 dataURL（网页侧联系人头像透传；空 = 首字 monogram 兜底） */
    private static final String EXTRA_AVATAR = "avatar";

    /** 静态锁状态（跨实例共享；JS 经插件读写） */
    private static volatile String lockPkg = null;
    private static volatile long unlockAt = 0L; // 0 = 直到哄好（不判到期）
    private static volatile String charName = "";
    private static volatile String message = "";
    private static volatile String contactId = "";
    private static volatile String appKind = ""; // 'wx' | 'qq' | 'sms'（空 = 无去哄哄按钮）
    /** v2.2.5 F-2：被锁应用的中文应用名（PackageManager 标题；拦截窗标题用，不再裸显包名） */
    private static volatile String appLabel = "";
    private static volatile boolean serviceRunning = false;
    private static volatile boolean overlayShowing = false;
    /** 遮罩期间用户真实点开被锁 App 的总次数（v2.4.2 语义：只在「真实进入」时 +1） */
    private static volatile int openAttempts = 0;
    /** v2.4.2 头像 dataURL（syncLock 透传；引擎线程解码成 avatarBmp） */
    private static volatile String avatarData = "";
    /** 头像位图（解码缓存；null = 用角色名首字 monogram 兜底） */
    private static volatile Bitmap avatarBmp;
    /** v2.4.2 尝试次数语义根修（机主实测「没动它次数也一直涨」）：旧版轮询每 700ms 命中
     *  就 +1（kickHome 失败/停在原地时每 1.4s 涨一次，机主根本没碰手机）；新口径 =
     *  只在「不在→在」的真实跳变才算一次新尝试，停在被锁 App 上的重复命中绝不计数。 */
    private static volatile boolean onLockedSticky = false;
    /** 两次尝试计数的最小间隔（防 kickHome 瞬间 ROM 把应用带回前台的抖动连计） */
    private static final long MIN_ATTEMPT_INTERVAL_MS = 2_500L;
    private static volatile long lastAttemptCountAt = 0L;

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
    /** v2.4.2 拦截窗头像（重启重梳后头像不丢；超大头像不落盘只走会话内透传） */
    private static final String KEY_ACTIVE_AVATAR = "active_avatar";

    /** 常驻前台通知（IMPORTANCE_LOW 静默） */
    private static final String CHANNEL_ID = "lock_guard";
    private static final int NOTIFY_ID = 7791;

    /** 轮询周期：v2.3.0 F-3 再提速 1s → 700ms（无障碍实时钩子为主，这里只是无障碍
     *  未开启时的兜底——机主实测拦截窗弹出太慢：无障碍可用时零延迟，不可用时 ≤0.7s） */
    private static final long POLL_MS = 700L;

    /** 同一次拦截的防抖窗（800ms 内无障碍事件 + 轮询双通道同时命中只算一次） */
    private static final long HIT_DEBOUNCE_MS = 800L;
    private static volatile long lastHitAt = 0L;

    /** v2.2.0 拦截窗保持机制（v2.4.3 根修：去掉 15s 自动收窗）：机主实测「封印页打开后什么
     * 也没碰，它自己消失了」——正是旧版 OVERLAY_HOLD_MS=15s 到点自动 removeOverlay 所为。
     * 新口径：拦截窗一旦弹出就【常驻展示】（倒计时每秒刷新），只有四种情况收起——
     * ① 用户点【返回主屏幕】/【去哄哄】/【强制解锁】按钮；
     * ② 前台切回本 App（去哄哄/通知入口——绝不盖住自家聊天界面）；
     * ③ 到期/哄好解锁（internalUnlock → removeOverlay）；
     * ④ 权限丢失降级（degrade 路径仍保留遮罩现状不动）。 */

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

    /** v2.4.1 极速拦截：建锁时【预构建】好的拦截窗视图——命中时只剩 wm.addView（几毫秒），
     * 不再现场造 20+ 个 View（旧版从命中到可见的延迟大头）；参数变化/解锁时作废。 */
    private FrameLayout prebuiltOverlay;

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
        String av = intent == null ? "" : intent.getStringExtra(EXTRA_AVATAR);

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
        appLabel = resolveAppLabel(pkg); // v2.2.5 F-2：拦截窗标题用中文应用名
        openAttempts = 0;
        onLockedSticky = false; // v2.4.2 尝试计数从「真实进入」重新起算
        lastAttemptCountAt = 0L;
        avatarData = av == null ? "" : av.trim();
        if (engine != null) {
            engine.post(this::decodeAvatar); // 引擎线程解码头像，绝不卡主线程/秒踢速度
        } else {
            decodeAvatar();
        }
        startForegroundNotify();
        scheduleTick(0L); // 立即首轮
        prebuildOverlay(); // v2.4.1 极速拦截：整棵 View 树建锁时就造好并预热
        return START_STICKY;
    }

    /**
     * v2.4.1 预构建拦截窗视图（机主规格：拦截时才建 View/加载资源会卡顿——把 UI 预热
     * 挪到建锁时）：主线程一次性建好整棵树缓存住，命中时只剩 addView 即刻可见。
     * 构建失败不致命（命中时现场重建的老路还在）。
     */
    private void prebuildOverlay() {
        try {
            final LockOverlayService svc = this;
            final Handler main = new Handler(Looper.getMainLooper());
            main.post(() -> {
                try {
                    FrameLayout v = svc.buildOverlayView();
                    if (lockPkg != null && !lockPkg.isEmpty()) {
                        svc.prebuiltOverlay = v; // 解锁/换锁目标会先走 internalUnlock 或重新 arm（重建）
                    }
                } catch (Throwable ignored) {
                    // 预构建失败：命中时走现场构建老路
                }
            });
        } catch (Throwable ignored) {
            // 预构建链路绝不 crash
        }
    }

    /** v2.2.5 F-2：解析被锁应用的中文应用名（PackageManager；失败回空串） */
    private String resolveAppLabel(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            CharSequence label = pm.getApplicationLabel(ai);
            return label == null ? "" : label.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    /** v2.4.2 头像解码：dataURL → Bitmap（引擎线程调用；超 500KB/解码失败 = null → monogram 兜底） */
    private void decodeAvatar() {
        Bitmap bmp = null;
        try {
            String dataUrl = avatarData;
            if (dataUrl != null && !dataUrl.isEmpty() && dataUrl.length() <= 500_000) {
                String b64 = dataUrl;
                int comma = dataUrl.indexOf(',');
                if (dataUrl.startsWith("data:") && comma > 0) b64 = dataUrl.substring(comma + 1);
                byte[] raw = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length);
                if (bmp != null && bmp.getWidth() <= 0) bmp = null;
            }
        } catch (Throwable t) {
            bmp = null;
        }
        avatarBmp = bmp;
        // 头像到位后重预构建一次（解码完成时树可能已按 monogram 建好——重建覆盖；
        // removeOverlay 后 prebuiltOverlay 会被复用场景同样受益）
        if (lockPkg != null && !overlayShowing) {
            try {
                prebuildOverlay();
            } catch (Throwable ignored) {
            }
        }
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
            } else {
                // v2.4.2 尝试计数语义根修：已离开锁定 App（含 fg=null）——下一次「真实进入」
                // 才算一次新尝试；停在被锁 App 上的重复命中绝不计数
                onLockedSticky = false;
                // v2.4.3 封印页常驻：不再自动收窗（机主实测 15s 自动消失的根因）。
                // 只有前台切回本 App 才立即收（绝不盖住自家聊天界面）。
                if (overlayShowing) {
                    boolean inOurApp = fg != null && fg.equals(getPackageName());
                    if (inOurApp) {
                        removeOverlay();
                    }
                }
            }
        } catch (Throwable ignored) {
            // 引擎绝不 crash
        }
        scheduleTick(POLL_MS);
    }

    /**
     * v2.2.0 拦截核心：锁定应用露头（无障碍实时钩子或轮询兜底命中）→
     * v2.2.5 F-3 顺序根修：① 先弹全屏拦截窗（WindowManager.addView 不受后台启动限制，
     *    窗口 add 即刻可见）→ ② 本 App 在 startActivity 那一刻已持有「可见窗口」，
     *    Home intent 被系统放行（Android 10+ 后台启动豁免的硬条件就是调用瞬间存在
     *    可见窗口——旧版先 goHome 后加窗，Home intent 被静默吞掉：机主实测「拦截窗
     *    显示太慢 / 弹不出来」正是这个）→ ③ 每次「真实进入」才计数（v2.4.2 语义修）。
     */
    private void handleLockHit(String via) {
        try {
            long now = System.currentTimeMillis();
            // v2.3.0 F-10 到期硬闸（机主实测「到时间了点击应用还是会有弹窗」）：
            // 无障碍实时钩子可能在到期与下一轮 tick（1s）之间的窗口期命中——到期
            // 的锁绝不弹窗，直接走到期解锁链路（免得弹一个秒收的幽灵窗）。
            if (unlockAt != 0 && now >= unlockAt) {
                persistEvent("native-unlock", lockPkg, "");
                internalUnlock("expired");
                return;
            }
            // 双通道防抖：800ms 内无障碍 + 轮询同时命中只算一次拦截
            if (now - lastHitAt < HIT_DEBOUNCE_MS) return;
            lastHitAt = now;

            // v2.4.2 尝试次数语义根修（机主实测「没动它次数也一直涨」）：
            // 只有「上一刻不在锁定 App → 现在在」的真实跳变才算一次新尝试；
            // kickHome 失败/停在原地时轮询每 700ms 的重复命中、被锁 App 内部
            // 弹窗触发的无障碍事件，一律不再重复计数。
            boolean freshEntry = !onLockedSticky;
            onLockedSticky = true;
            if (freshEntry && now - lastAttemptCountAt >= MIN_ATTEMPT_INTERVAL_MS) {
                lastAttemptCountAt = now;
                openAttempts++;
                // 每次真实尝试都落盘 lock-attempt（带累计次数——JS 醒来后驱动
                // AI 按人设质问「又去点了？」）
                persistEvent("lock-attempt", lockPkg, "第" + openAttempts + "次想打开");
            }

            // v2.4.1 先踢后弹（机主规格：旧版先弹窗后跳转，弹窗卡在被锁 App 上显得极慢）：
            // ① 秒踢：无障碍 GLOBAL_ACTION_HOME —— 系统无障碍通道执行，【不受 Android 10+
            //    后台 Activity 启动限制】、无需可见窗口豁免，被锁 App 瞬间退后台；
            // ② 瞬弹：预构建好的拦截窗（TYPE_APPLICATION_OVERLAY 最高层级）addView 即刻
            //    可见，无任何入场动画延迟（旧版从纯黑淡入 180ms 拖慢感知）；
            // ③ 无障碍不可用兜底：先弹窗拿到「可见窗口」豁免后台启动限制，再补 Home
            //    intent（顺序不能反：没有可见窗口时 Home intent 会被系统静默吞掉）。
            boolean kicked = AiAccessibilityService.kickHome();
            if (!overlayShowing) {
                persistEvent("lock-shown", lockPkg, message);
                showOverlay();
            }
            if (!kicked) goHome();
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
        prebuiltOverlay = null; // v2.4.1：解锁作废预构建视图（下一把锁重新预热）
        removeOverlay();
        instance = null;
        lockPkg = null;
        unlockAt = 0L;
        message = "";
        contactId = "";
        appKind = "";
        appLabel = "";
        openAttempts = 0;
        onLockedSticky = false;
        lastAttemptCountAt = 0L;
        avatarData = "";
        avatarBmp = null;
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
                    .remove(KEY_ACTIVE_CONTACT).remove(KEY_ACTIVE_APP_KIND)
                    .remove(KEY_ACTIVE_AVATAR).apply();
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
        // v2.4.1 极速上屏：视图统一在主线程构建/上屏（a11y 回调本就在主线程；轮询路径
        // post 过来最多等一帧）。旧版从纯黑 setAlpha(0) 淡入 180ms 的入场动画已删——
        // 机主规格「瞬间弹窗」：addView 即刻可见，被锁 App 在同帧内已被秒踢回桌面。
        Runnable add = () -> {
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
                        PixelFormat.TRANSLUCENT); // v2.4.2 半透明：底下是桌面，毛玻璃遮罩要透
                // v2.4.2 毛玻璃（机主规格 backdrop-filter: blur(20px)）：API 31+ 开
                // FLAG_BLUR_BEHIND + setBlurBehindRadius —— 系统级背后实时模糊；
                // 不支持的 ROM 自动退化为纯深色遮罩（rgba(0,0,0,0.7) 由根视图承担）。
                if (Build.VERSION.SDK_INT >= 31) {
                    try {
                        lp.flags |= WindowManager.LayoutParams.FLAG_BLUR_BEHIND;
                        lp.setBlurBehindRadius(Math.round(20 * getResources().getDisplayMetrics().density));
                    } catch (Throwable ignored) {
                        // 个别 ROM 不认 blur：静默退化纯遮罩
                    }
                }

                FrameLayout view = prebuiltOverlay != null ? prebuiltOverlay : buildOverlayView();
                prebuiltOverlay = null; // 一次性：已上屏的树不再复用（防 WindowManager 双父）
                wm.addView(view, lp);
                overlayView = view;
                overlayShowing = true;
                refreshOverlayTexts(); // 预构建视图上的倒计时/次数可能已过期，上屏即校准
                startUiTick(); // v2.2.0：遮罩期间倒计时每秒刷新
            } catch (Throwable t) {
                overlayShowing = false;
                overlayView = null;
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) add.run();
        else new Handler(Looper.getMainLooper()).post(add);
    }

    /**
     * 构建拦截窗视图（v2.4.2 极简黑白灰 + 毛玻璃·苹果级系统风彻底重做）：
     * 全屏 rgba(0,0,0,0.7) 深色遮罩（窗口层叠 FLAG_BLUR_BEHIND 毛玻璃，隐约可见
     * 桌面图标）→ 顶部居中【AI 角色圆形头像】→ 角色名 → 大标题「{应用名} 已被封印」
     * 纯白粗体 → 理由副题（浅灰）→ 纤细倒计时「剩余 X分Y秒 自动解锁」→ 暗红尝试
     * 次数（#FF453A）→ 毛玻璃胶囊【去哄哄】/ 深灰胶囊【返回主屏幕】/ 极弱下划线
     * 【强制解锁】（点击弹窗内二次确认卡）。全程无彩色（唯一暖色：#FF453A 警示红）。
     */
    private FrameLayout buildOverlayView() {
        final Context ctx = this;
        FrameLayout root = new FrameLayout(ctx);
        // v2.4.2 机主规格：全屏深色遮罩 rgba(0,0,0,0.7)（毛玻璃由窗口 FLAG_BLUR_BEHIND 承担）
        root.setBackgroundColor(Color.parseColor("#B3000000"));

        final String who = charName == null || charName.isEmpty() ? "TA" : charName;
        final String what = appLabel == null || appLabel.isEmpty() ? "这个应用" : appLabel;
        final String reason = message == null || message.isEmpty() ? "被我没收啦，说了要专心陪我。" : message;

        ScrollView sc = new ScrollView(ctx);
        sc.setFillViewport(true);
        sc.setVerticalScrollBarEnabled(false);
        sc.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(sc, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        // 内容整块垂直居中（小屏内容超高时 ScrollView 照常滚动，居中不裁切）
        FrameLayout viewport = new FrameLayout(ctx);
        sc.addView(viewport, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.MATCH_PARENT));

        LinearLayout box = new LinearLayout(ctx);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(32), dp(18), dp(32), dp(28));
        viewport.addView(box, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        // ===== 顶部：AI 角色圆形头像（替代旧锁图标/粉色进度环——机主规格） =====
        FrameLayout avatarWrap = new FrameLayout(ctx);
        LinearLayout.LayoutParams avLp = new LinearLayout.LayoutParams(dp(104), dp(104));
        avLp.gravity = Gravity.CENTER_HORIZONTAL;
        avLp.topMargin = dp(10);
        Bitmap bmp = avatarBmp;
        boolean avatarOk = false;
        if (bmp != null) {
            try {
                ImageView iv = new ImageView(ctx);
                iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
                RoundedBitmapDrawable circ = RoundedBitmapDrawableFactory.create(getResources(), bmp);
                circ.setCircular(true);
                iv.setImageDrawable(circ);
                avatarWrap.addView(iv, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
                avatarOk = true;
            } catch (Throwable t) {
                avatarOk = false;
            }
        }
        if (!avatarOk) addMonogramAvatar(ctx, avatarWrap, who);
        // 极细白色描边环（苹果级头像规格）
        View ring = new View(ctx);
        GradientDrawable ringBg = new GradientDrawable();
        ringBg.setShape(GradientDrawable.OVAL);
        ringBg.setColor(Color.TRANSPARENT);
        ringBg.setStroke(dp(1), Color.parseColor("#3DFFFFFF"));
        ring.setBackground(ringBg);
        avatarWrap.addView(ring, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        box.addView(avatarWrap, avLp);

        // 角色名（头像下方，浅灰）
        TextView name = new TextView(ctx);
        name.setText(who);
        name.setTextSize(14);
        name.setTextColor(Color.parseColor("#99FFFFFF"));
        name.setGravity(Gravity.CENTER);
        name.setPadding(0, dp(12), 0, 0);
        box.addView(name);

        // 主标题：{应用名} 已被封印（纯白粗体大字——机主规格）
        TextView title = new TextView(ctx);
        title.setText(what + " 已被封印");
        title.setTextSize(26);
        title.setTypeface(Typeface.DEFAULT_BOLD, Typeface.BOLD);
        title.setTextColor(Color.WHITE);
        title.setGravity(Gravity.CENTER);
        title.setPadding(dp(4), dp(16), dp(4), 0);
        box.addView(title);

        // 副标题：封印理由（AI 按人设记忆/上下文生成，浅灰居中）
        TextView subtitle = new TextView(ctx);
        subtitle.setText(reason);
        subtitle.setTextSize(14);
        subtitle.setTextColor(Color.parseColor("#C7C7CC"));
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setLineSpacing(dp(5), 1f);
        subtitle.setPadding(dp(10), dp(14), dp(10), 0);
        box.addView(subtitle);

        // 倒计时：纤细无衬线「剩余 X分Y秒 自动解锁」（机主规格）
        TextView countdown = new TextView(ctx);
        countdown.setTextSize(17);
        countdown.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        countdown.setTextColor(Color.parseColor("#EBEBF0"));
        countdown.setGravity(Gravity.CENTER);
        countdown.setPadding(dp(16), dp(22), dp(16), 0);
        countdown.setTag("countdown");
        countdown.setText(countdownText());
        box.addView(countdown);

        // 尝试次数（柔和暗红 #FF453A——机主规格「这是你第 N 次想打开它了」）
        TextView attempts = new TextView(ctx);
        attempts.setTextSize(13);
        attempts.setTextColor(Color.parseColor("#FF453A"));
        attempts.setGravity(Gravity.CENTER);
        attempts.setPadding(0, dp(10), 0, 0);
        attempts.setTag("attempts");
        box.addView(attempts);

        // 【去哄哄 TA】白色半透明毛玻璃胶囊（rgba(255,255,255,0.15)·圆角 99px·白字）
        Button coax = new Button(ctx);
        coax.setText("去哄哄 " + who);
        coax.setTextSize(16);
        coax.setTextColor(Color.WHITE);
        coax.setAllCaps(false);
        coax.setPadding(0, 0, 0, 0);
        coax.setStateListAnimator(null);
        GradientDrawable coaxBg = new GradientDrawable();
        coaxBg.setCornerRadius(dp(99));
        coaxBg.setColor(Color.parseColor("#26FFFFFF"));
        coaxBg.setStroke(dp(1), Color.parseColor("#40FFFFFF"));
        coax.setBackground(coaxBg);
        coax.setOnClickListener((v) -> {
            try {
                openChatWithTarget();
            } catch (Throwable ignored) {
            }
            // 立即收窗去聊天（锁仍然生效，遮罩绝不盖住自家聊天界面；再点被锁 App 露头即再弹）
            try {
                removeOverlay();
            } catch (Throwable ignored) {
            }
        });
        LinearLayout.LayoutParams coaxLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(54));
        coaxLp.topMargin = dp(34);
        box.addView(coax, coaxLp);

        // 【返回主屏幕】深灰色半透明胶囊（浅灰字）
        Button home = new Button(ctx);
        home.setText("返回主屏幕");
        home.setTextSize(15);
        home.setTextColor(Color.parseColor("#C7C7CC"));
        home.setAllCaps(false);
        home.setPadding(0, 0, 0, 0);
        home.setStateListAnimator(null);
        GradientDrawable homeBg = new GradientDrawable();
        homeBg.setCornerRadius(dp(99));
        homeBg.setColor(Color.parseColor("#802A2A2E"));
        homeBg.setStroke(dp(1), Color.parseColor("#26FFFFFF"));
        home.setBackground(homeBg);
        home.setOnClickListener((v) -> {
            try {
                goHome(); // 保险：若用户从其他入口进来，再送一程回桌面
            } catch (Throwable ignored) {
            }
            removeOverlay(); // 立即收起（点按钮=用户放弃打开，tick 会再判定）
        });
        LinearLayout.LayoutParams homeLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(46));
        homeLp.topMargin = dp(12);
        box.addView(home, homeLp);

        // 【强制解锁】极其微弱的底部文字链接（下划线；点击弹二次确认卡——机主规格）
        TextView force = new TextView(ctx);
        force.setText("强制解锁");
        force.setTextSize(12);
        force.setTextColor(Color.parseColor("#66FFFFFF"));
        force.setGravity(Gravity.CENTER);
        force.setPadding(0, dp(16), 0, dp(4));
        force.setPaintFlags(force.getPaintFlags() | Paint.UNDERLINE_TEXT_FLAG);
        force.setOnClickListener((v) -> {
            try {
                View cl = root.findViewWithTag("confirmLayer");
                if (cl != null) cl.setVisibility(View.VISIBLE);
            } catch (Throwable ignored) {
            }
        });
        box.addView(force);

        // ===== 强制解锁·二次确认卡（窗内浮层——遮罩窗口不可聚焦，不能用系统 Dialog） =====
        root.addView(buildForceConfirmLayer(ctx, who, what), new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        return root;
    }

    /** 头像兜底：无头像/解码失败时用角色名首字的圆形 monogram（半透明白底 + 白粗字） */
    private void addMonogramAvatar(Context ctx, FrameLayout wrap, String who) {
        TextView mv = new TextView(ctx);
        String c = who == null || who.isEmpty() ? "TA" : who.trim();
        mv.setText(c.substring(0, c.offsetByCodePoints(0, 1)));
        mv.setTextSize(40);
        mv.setTypeface(Typeface.DEFAULT_BOLD, Typeface.BOLD);
        mv.setTextColor(Color.WHITE);
        mv.setGravity(Gravity.CENTER);
        GradientDrawable mb = new GradientDrawable();
        mb.setShape(GradientDrawable.OVAL);
        mb.setColor(Color.parseColor("#2EFFFFFF"));
        mv.setBackground(mb);
        wrap.addView(mv, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }

    /** 强制解锁二次确认卡：全屏半透明黑浮层 + 居中深色圆角卡（取消 / 解锁 胶囊双钮） */
    private FrameLayout buildForceConfirmLayer(Context ctx, String who, String what) {
        FrameLayout layer = new FrameLayout(ctx);
        layer.setTag("confirmLayer");
        layer.setVisibility(View.GONE);
        layer.setClickable(true); // 挡住背后的按钮
        layer.setBackgroundColor(Color.parseColor("#99000000"));
        // 点空白 = 取消
        layer.setOnClickListener((v) -> v.setVisibility(View.GONE));

        LinearLayout card = new LinearLayout(ctx);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(24), dp(22), dp(24), dp(20));
        GradientDrawable cardBg = new GradientDrawable();
        cardBg.setCornerRadius(dp(22));
        cardBg.setColor(Color.parseColor("#F21C1C1E"));
        cardBg.setStroke(dp(1), Color.parseColor("#26FFFFFF"));
        card.setBackground(cardBg);
        layer.addView(card, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        TextView ct = new TextView(ctx);
        ct.setText("强制解锁「" + what + "」？");
        ct.setTextSize(16);
        ct.setTypeface(Typeface.DEFAULT_BOLD, Typeface.BOLD);
        ct.setTextColor(Color.WHITE);
        ct.setGravity(Gravity.CENTER);
        card.addView(ct);

        TextView cb = new TextView(ctx);
        cb.setText(who + " 会知道你绕过了封印");
        cb.setTextSize(13);
        cb.setTextColor(Color.parseColor("#99FFFFFF"));
        cb.setGravity(Gravity.CENTER);
        cb.setPadding(0, dp(8), 0, 0);
        card.addView(cb);

        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        rowLp.topMargin = dp(18);
        card.addView(row, rowLp);

        Button cancel = new Button(ctx);
        cancel.setText("取消");
        cancel.setTextSize(15);
        cancel.setTextColor(Color.parseColor("#EBEBF0"));
        cancel.setAllCaps(false);
        cancel.setPadding(0, 0, 0, 0);
        cancel.setStateListAnimator(null);
        GradientDrawable cancelBg = new GradientDrawable();
        cancelBg.setCornerRadius(dp(99));
        cancelBg.setColor(Color.parseColor("#3A3A3C"));
        cancel.setBackground(cancelBg);
        cancel.setOnClickListener((v) -> layer.setVisibility(View.GONE));
        LinearLayout.LayoutParams cLp = new LinearLayout.LayoutParams(0, dp(46), 1f);
        cLp.setMarginEnd(dp(6));
        row.addView(cancel, cLp);

        Button confirm = new Button(ctx);
        confirm.setText("解锁");
        confirm.setTextSize(15);
        confirm.setTextColor(Color.BLACK);
        confirm.setAllCaps(false);
        confirm.setPadding(0, 0, 0, 0);
        confirm.setStateListAnimator(null);
        GradientDrawable confirmBg = new GradientDrawable();
        confirmBg.setCornerRadius(dp(99));
        confirmBg.setColor(Color.WHITE);
        confirm.setBackground(confirmBg);
        confirm.setOnClickListener((v) -> {
            // 解锁前先落事件（internalUnlock 会清 lockPkg）——AI 感知强解的信号源
            try {
                persistEvent("force-unlock", lockPkg,
                        "机主没有哄，直接强制解锁（期间共拦截 " + openAttempts + " 次）");
            } catch (Throwable ignored) {
            }
            try {
                internalUnlock("user-force");
            } catch (Throwable ignored) {
            }
            try {
                new Handler(Looper.getMainLooper()).post(() -> {
                    try {
                        Toast.makeText(getApplicationContext(),
                                "已解锁（" + who + "会知道你强解的哦）", Toast.LENGTH_SHORT).show();
                    } catch (Throwable ignored) {
                    }
                });
            } catch (Throwable ignored) {
            }
        });
        LinearLayout.LayoutParams okLp = new LinearLayout.LayoutParams(0, dp(46), 1f);
        okLp.setMarginStart(dp(6));
        row.addView(confirm, okLp);

        return layer;
    }

    /**
     * 去哄哄：拉起 MainActivity 并带上 localNotify 同款 target extra
     * （{app:'wechat'|'qq'|'chat', contactId}）→ handleOnNewIntent →
     * injectLocalNotifyOpen → 网页导航总线直达对应聊天界面。
     * 冷启动（App 被杀过）由 MainActivity.onCreate 的 extras 兜底处理。
     * v2.2.5 F-5：contactId 缺失（AI 没带会话上下文）时不再不显示按钮——
     * 直接拉起 App 首页（聊天列表所在），TA 自己点进去哄。
     */
    private void openChatWithTarget() {
        try {
            if (contactId == null || contactId.isEmpty()) {
                Intent home = new Intent(this, MainActivity.class);
                home.setPackage(getPackageName());
                home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(home);
                return;
            }
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

    /** 每秒刷新倒计时文案 + 拦截次数行 + 环形进度（v2.4.1：视图挂在主线程，非主线程调用自动转发） */
    private void refreshOverlayTexts() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            refreshOverlayTextsInner();
        } else {
            new Handler(Looper.getMainLooper()).post(this::refreshOverlayTextsInner);
        }
    }

    private void refreshOverlayTextsInner() {
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
        if (unlockAt == 0) return "哄好 " + (charName == null || charName.isEmpty() ? "TA" : charName) + " 之前，它就归我管";
        long left = unlockAt - System.currentTimeMillis();
        if (left <= 0) return "马上解锁…";
        long min = left / 60_000L;
        long sec = (left % 60_000L) / 1000L;
        if (min >= 1) return "剩余 " + min + "分" + (sec < 10 ? "0" : "") + sec + "秒 自动解锁";
        return "剩余 " + sec + "秒 自动解锁";
    }

    private void removeOverlay() {
        // v2.4.1：视图上屏/移除统一主线程（addView 绑定的 ViewRoot 线程必须一致）；
        // 收窗后立刻预构建下一发（用户再手贼点被锁 App 时又是零构建 addView）。
        Runnable rm = () -> {
            try {
                if (uiTickHandler != null) uiTickHandler.removeCallbacksAndMessages(null);
                if (overlayView != null && wm != null) wm.removeView(overlayView);
            } catch (Throwable ignored) {
            }
            overlayView = null;
            overlayShowing = false;
            prebuildOverlay();
        };
        if (Looper.myLooper() == Looper.getMainLooper()) rm.run();
        else new Handler(Looper.getMainLooper()).post(rm);
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

    /** 建锁/续锁/解锁（pkg 空=解锁停服务）；返回 null=ok，否则失败原因。
     *  v2.4.2 新增 avatar（拦截窗头像 dataURL；空 = 角色名首字 monogram） */
    public static String syncLock(Context ctx, String pkg, long ua, String charName, String message,
                                  String contactId, String appKind, String avatar) {
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
                String avTrim = avatar == null ? "" : avatar.trim();
                ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit().putString(KEY_ACTIVE_PKG, pkg)
                        .putLong(KEY_ACTIVE_UNLOCK_AT, ua)
                        .putString(KEY_ACTIVE_CHAR, charName == null ? "" : charName)
                        .putString(KEY_ACTIVE_MSG, message == null ? "" : message)
                        .putString(KEY_ACTIVE_CONTACT, contactId == null ? "" : contactId)
                        .putString(KEY_ACTIVE_APP_KIND, appKind == null ? "" : appKind)
                        // v2.4.2 头像持久化（≤300KB 才落盘，超大头像只走会话内透传）
                        .putString(KEY_ACTIVE_AVATAR, avTrim.length() <= 300_000 ? avTrim : "")
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
            i.putExtra(EXTRA_AVATAR, avatar == null ? "" : avatar);
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
            String av = sp.getString(KEY_ACTIVE_AVATAR, ""); // v2.4.2 重启后头像不丢
            syncLock(ctx, pkg, ua, ch, msg, cid, ak, av);
        } catch (Throwable ignored) {
            // 开机重梳绝不 crash
        }
    }
}
