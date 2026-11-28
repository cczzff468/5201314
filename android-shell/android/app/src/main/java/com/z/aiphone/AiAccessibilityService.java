package com.z.aiphone;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Bitmap;
import android.graphics.Path;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.io.ByteArrayOutputStream;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * AI 无障碍服务（v2.0.0 去 Shizuku 化核心）：
 *
 * 一切真机操控/感知能力的原生底座，替代旧的 Shizuku shell 通道
 * （input tap / input swipe / input text / screencap / dumpsys 全部退役）：
 *
 * ① 静默截屏（API 30+）：AccessibilityService.takeScreenshot —— 无 MediaProjection
 *    授权弹窗、无 root/shell，服务开启即静默可用（FLAG_SECURE 页面系统会黑屏，
 *    属预期安全行为）。输出与旧 shizukuScreencap 同构：宽 ≤720 降采样 JPEG
 *    base64 dataURL。
 *
 * ② 模拟点击/滑动：dispatchGesture（GestureDescription）—— 替代 input tap/swipe。
 *
 * ③ 模拟按键：performGlobalAction（返回/桌面/最近任务/通知栏/锁屏）—— 替代
 *    input keyevent。
 *
 * ④ 文本输入：findFocus(FOCUS_INPUT) + ACTION_SET_TEXT —— 替代 input text /
 *    AdbImeService 广播注入（AdbImeService 随 Shizuku 一并退役：普通应用无法
 *    静默切换系统输入法，无障碍 SET_TEXT 不需要切输入法）。
 *
 * ⑤ 前台应用追踪：TYPE_WINDOW_STATE_CHANGED 事件流实时记录当前前台包名 ——
 *    替代 dumpsys window mCurrentFocus 轮询（事件驱动、零延迟、免查询）。
 *
 * 数据出口：static volatile instance + 静态快照（插件轮询读取，与
 * MediaListenerService.latest() 同款协议，网页端零改动兼容）。
 */
public class AiAccessibilityService extends AccessibilityService {

    /** 已连接的服务实例（插件检测连接状态用；未开启/被系统回收时为 null） */
    public static volatile AiAccessibilityService instance;

    /** 最近一次前台包名（TYPE_WINDOW_STATE_CHANGED；含对话框/键盘等瞬态窗口） */
    private static volatile String lastWindowPkg;
    /** lastWindowPkg 对应事件时间（epoch ms） */
    private static volatile long lastWindowAt;

    /**
     * 稳定前台包名：对瞬态窗口（输入法/对话框/系统弹层）做 1.2s 防抖——
     * 瞬态窗口离开后不回退，只有新的「真前台」才接管。
     */
    private static volatile String stablePkg;
    private static volatile long stableAt;

    /**
     * v2.4.34（幽灵前台根修）：待验证的前台候选。
     *
     * 病灶：TYPE_WINDOW_STATE_CHANGED 不只在前台切换时发——QQ 等应用的后台悬浮窗
     * （悬浮聊天气泡/快速回复面板/推送拉起的服务窗口）也会发同包名事件，旧版直接把
     * stablePkg 接管成 QQ，导致：① AI 感知「你正在刷 QQ」（其实你在别的 App）；
     * ② LockOverlayService 弹出锁定拦截窗（机主没点 QQ 也被弹窗+计数）。
     *
     * 修法：非瞬态事件一律先进「待验证」态，350ms 后（窗口切换过渡完成）校验——
     * 屏幕点亮 且 事件包名 == 当前活跃（active+focused）窗口的包名 才算真前台切换；
     * 否则是后台悬浮窗事件，静默丢弃（不接管 stablePkg、不通知锁定服务）。
     * 连发事件去抖只跟最新一条；活跃窗口判不了（null）时保守放行（不误拦真切换）。
     */
    private static volatile String pendingPkg;
    private static volatile long pendingAt;
    /** 候选验证延时（窗口切换过渡完成窗口期；过长拖慢真感知、过短误判悬浮窗） */
    private static final long PENDING_VALIDATE_MS = 350L;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable pendingValidate = new Runnable() {
        @Override
        public void run() {
            try {
                String pkg = pendingPkg;
                pendingPkg = null;
                if (pkg == null || pkg.isEmpty()) return;
                // 闸一：屏幕必须点亮（熄屏态不可能有用户真实前台切换；QQ 后台服务在熄屏时也会发窗口事件）
                if (!isScreenInteractive()) return;
                // 闸二：事件包名必须与当前「活跃窗口」一致（后台悬浮窗不是活跃窗口——
                // 真前台切换 350ms 后过渡已完成，活跃窗口就是它；判不了（null）保守放行）
                String active = activeWindowPkg();
                if (active != null && !active.equals(pkg)) return; // 幽灵：后台悬浮窗事件
                stablePkg = pkg;
                stableAt = System.currentTimeMillis();
                // v2.2.0 应用锁定实时钩子：锁定名单应用一露头 → 通知 LockOverlayService
                // 立即回桌面 + 弹拦截窗（服务未持锁时静态方法内部直接短路，零开销）
                LockOverlayService.notifyForegroundHit(pkg);
            } catch (Throwable ignored) {
                // 校验链路绝不 crash 服务
            }
        }
    };

    /** 截屏后台线程（JPEG 压缩 + base64 不占主线程） */
    private static final Executor SHOT_EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        try {
            mainHandler.removeCallbacks(pendingValidate); // 待验证候选随服务销毁一并丢弃
        } catch (Throwable ignored) {
        }
        super.onDestroy();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        try {
            if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
            CharSequence pkgCs = event.getPackageName();
            String pkg = pkgCs == null ? null : pkgCs.toString();
            if (pkg == null || pkg.isEmpty()) return;
            long now = System.currentTimeMillis();
            lastWindowPkg = pkg;
            lastWindowAt = now;
            // 瞬态窗口防抖：输入法/对话框窗口不立即接管 stable（1.2s 内仍在则转正）
            boolean transientWin = isTransientPackage(pkg);
            if (!transientWin) {
                // v2.4.34 幽灵前台根修：非瞬态事件不再立即接管 stable——先进待验证态，
                // 350ms 后经「亮屏 + 活跃窗口包名一致」双闸校验（见 pendingValidate），
                // QQ 后台悬浮窗等幽灵事件在那里被丢弃，绝不再污染 AI 感知与锁定拦截。
                // 连发事件去抖只跟最新一条：同包名窗口期内只刷新时间，新包名顶掉旧回调。
                if (pkg.equals(pendingPkg) && now - pendingAt < PENDING_VALIDATE_MS) {
                    pendingAt = now;
                } else {
                    pendingPkg = pkg;
                    pendingAt = now;
                    mainHandler.removeCallbacks(pendingValidate);
                    mainHandler.postDelayed(pendingValidate, PENDING_VALIDATE_MS);
                }
            } else if (stablePkg == null) {
                stablePkg = pkg;
                stableAt = now;
            }
        } catch (Throwable ignored) {
            // 感知事件绝不 crash 服务
        }
    }

    /** v2.4.34：屏幕是否点亮（PowerManager.isInteractive；异常保守返回 true 不误拦） */
    private boolean isScreenInteractive() {
        try {
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
            return pm == null || pm.isInteractive();
        } catch (Throwable t) {
            return true;
        }
    }

    /**
     * v2.4.34：当前「活跃窗口」的包名（isActive + isFocused 的窗口 = 用户正交互的真前台；
     * 后台悬浮窗/气泡不在其列）。窗口自身无 getPackageName，经其根节点读取。
     * 无窗口/根节点拿不到/异常返回 null（调用方保守放行）。
     */
    private String activeWindowPkg() {
        try {
            for (AccessibilityWindowInfo w : getWindows()) {
                if (w != null && w.isActive() && w.isFocused()) {
                    AccessibilityNodeInfo root = w.getRoot();
                    if (root == null) return null;
                    CharSequence p = root.getPackageName();
                    return p == null ? null : p.toString();
                }
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    /** 瞬态窗口包名判定（输入法/系统弹层不视为前台切换） */
    private static boolean isTransientPackage(String pkg) {
        if (pkg.contains("inputmethod") || pkg.startsWith("com.android.systemui.")) return true;
        // 系统对话框（授权框/日期选择等）挂在本包名下但窗口标题不同 —— 本包自身不防抖
        return false;
    }

    @Override
    public void onInterrupt() {
        // 无语音反馈通道，无需处理
    }

    // ================= 前台应用快照（插件读取） =================

    /** 前台应用快照（防抖后的稳定前台包名 + 事件时间；服务未连接返回 null） */
    public static class ForegroundInfo {
        public final String pkg;
        public final long at;
        public final String lastWindow; // 最近一次窗口事件包名（含瞬态，调试用）

        ForegroundInfo(String pkg, long at, String lastWindow) {
            this.pkg = pkg;
            this.at = at;
            this.lastWindow = lastWindow;
        }
    }

    public static ForegroundInfo currentForeground() {
        if (instance == null) return null;
        String s = stablePkg;
        if (s == null) return null;
        return new ForegroundInfo(s, stableAt, lastWindowPkg);
    }

    // ================= 静默截屏（API 30+，v2.2.0 单飞队列 + 失败重试） =================

    /** 截屏结果回调（dataUrl 与 error 互斥） */
    public interface ShotCallback {
        void onResult(String dataUrl, String error);
    }

    /** v2.2.0 单飞队列：takeScreenshot 同一时刻只允许一个请求在飞——上一个还没完成时
     *  新请求排队等待（Android 的 takeScreenshot 并发调用会直接拒绝后来者，这正是
     *  机主实测「AI 有时截得到屏有时截不到」的根因：看屏幕→点一下→再看屏幕，两连拍
     *  间隔太短，第二拍被系统丢掉）。队列在 SHOT_EXECUTOR 串行线程上逐个出列执行。 */
    private static final java.util.ArrayDeque<ShotCallback> shotQueue = new java.util.ArrayDeque<>();
    private static boolean shotInFlight = false;

    /** 内部：取下一个排队请求开飞（SHOT_EXECUTOR 上调用，串行免锁） */
    private void pumpShotQueue() {
        ShotCallback next;
        synchronized (shotQueue) {
            if (shotInFlight) return;
            next = shotQueue.poll();
            if (next == null) return;
            shotInFlight = true;
        }
        doShootScreenshot(next, 0);
    }

    /**
     * 静默截屏：AccessibilityService.takeScreenshot（API 30+）→ 降采样 JPEG base64。
     * 输出与旧 shizukuScreencap 同构（宽 ≤720、JPEG、dataURL）。
     * v2.2.0：并发请求自动排队；系统拒绝（ERROR_TAKE_SCREENSHOT_INTERNAL_ERROR，多为
     * 前一请求未完成）时延迟 450ms 自动重试一次（仅一次，防死循环）。
     */
    public void shootScreenshot(final ShotCallback cb) {
        if (Build.VERSION.SDK_INT < 30) {
            cb.onResult(null, "not-supported"); // API < 30 无此接口
            return;
        }
        synchronized (shotQueue) {
            shotQueue.add(cb);
        }
        SHOT_EXECUTOR.execute(this::pumpShotQueue);
    }

    private void doShootScreenshot(final ShotCallback cb, final int retry) {
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, SHOT_EXECUTOR,
                    new AccessibilityService.TakeScreenshotCallback() {
                        @Override
                        public void onSuccess(AccessibilityService.ScreenshotResult result) {
                            HardwareBuffer buffer = null;
                            try {
                                buffer = result.getHardwareBuffer();
                                if (buffer == null) {
                                    finishShot(cb, null, "empty", retry);
                                    return;
                                }
                                Bitmap bmp = Bitmap.wrapHardwareBuffer(buffer, null);
                                if (bmp == null) {
                                    finishShot(cb, null, "empty", retry);
                                    return;
                                }
                                // 软拷贝出可压缩的位图（hardware bitmap 不能直接 compress）
                                Bitmap soft = bmp.copy(Bitmap.Config.ARGB_8888, false);
                                bmp.recycle();
                                if (soft == null) {
                                    finishShot(cb, null, "empty", retry);
                                    return;
                                }
                                // 降采样：宽 ≤720（与 shizukuScreencap 同规格，控制回传体积）
                                int w = soft.getWidth();
                                int h = soft.getHeight();
                                if (w > 720) {
                                    int nw = 720;
                                    int nh = Math.max(1, (int) ((long) h * nw / w));
                                    Bitmap scaled = Bitmap.createScaledBitmap(soft, nw, nh, true);
                                    soft.recycle();
                                    soft = scaled;
                                }
                                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                                soft.compress(Bitmap.CompressFormat.JPEG, 75, bos);
                                soft.recycle();
                                String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
                                finishShot(cb, "data:image/jpeg;base64," + b64, null, retry);
                            } catch (Throwable t) {
                                finishShot(cb, null, "failed", retry);
                            } finally {
                                if (buffer != null) {
                                    try {
                                        buffer.close();
                                    } catch (Throwable ignored) {
                                    }
                                }
                            }
                        }

                        @Override
                        public void onFailure(int errorCode) {
                            finishShot(cb, null, "error-" + errorCode, retry);
                        }
                    });
        } catch (Throwable t) {
            finishShot(cb, null, "failed", retry);
        }
    }

    /** 出队收尾：回调结果 → 标记空闲 → 泡下一单；失败且还有重试额度 → 延迟重试 */
    private void finishShot(final ShotCallback cb, final String dataUrl, final String error, final int retry) {
        // 系统拒绝且未重试过：延迟 450ms 再试一次（前一请求占用中是最常见的拒绝原因）
        if (dataUrl == null && retry < 1 && error != null && error.startsWith("error-")) {
            SHOT_EXECUTOR.execute(() -> {
                try {
                    Thread.sleep(450L);
                } catch (InterruptedException ignored) {
                }
                doShootScreenshot(cb, retry + 1);
            });
            return;
        }
        synchronized (shotQueue) {
            shotInFlight = false;
        }
        try {
            cb.onResult(dataUrl, error);
        } catch (Throwable ignored) {
        }
        SHOT_EXECUTOR.execute(this::pumpShotQueue);
    }

    // ================= 模拟点击 / 滑动（dispatchGesture） =================

    /** 模拟点击（press 120ms，与 input tap 观感一致）。返回手势是否成功派发 */
    public boolean tap(int x, int y) {
        try {
            Path p = new Path();
            p.moveTo(x, y);
            GestureDescription.Builder b = new GestureDescription.Builder();
            b.addStroke(new GestureDescription.StrokeDescription(p, 0, 120));
            return dispatchGesture(b.build(), null, null);
        } catch (Throwable t) {
            return false;
        }
    }

    /** 模拟滑动（durationMs ≤ 0 时默认 300ms）。返回手势是否成功派发 */
    public boolean swipe(int x1, int y1, int x2, int y2, int durationMs) {
        try {
            Path p = new Path();
            p.moveTo(x1, y1);
            p.lineTo(x2, y2);
            int dur = durationMs <= 0 ? 300 : Math.min(2000, durationMs);
            GestureDescription.Builder b = new GestureDescription.Builder();
            b.addStroke(new GestureDescription.StrokeDescription(p, 0, dur));
            return dispatchGesture(b.build(), null, null);
        } catch (Throwable t) {
            return false;
        }
    }

    /** 手势完成回调版（Agent 需要等手势落完再读屏） */
    public interface GestureCallback {
        void onDone(boolean ok);
    }

    public void tapAsync(int x, int y, final GestureCallback cb) {
        try {
            Path p = new Path();
            p.moveTo(x, y);
            GestureDescription.Builder b = new GestureDescription.Builder();
            b.addStroke(new GestureDescription.StrokeDescription(p, 0, 120));
            dispatchGesture(b.build(), new GestureResultCallback() {
                @Override
                public void onCompleted(GestureDescription gestureDescription) {
                    cb.onDone(true);
                }

                @Override
                public void onCancelled(GestureDescription gestureDescription) {
                    cb.onDone(false);
                }
            }, null);
        } catch (Throwable t) {
            cb.onDone(false);
        }
    }

    // ================= 全局按键（performGlobalAction） =================

    /** 全局动作 key（与网页侧 KEY_WORDS 映射对齐）：back/home/recents/notifications/lock */
    public boolean globalAction(String key) {
        int action;
        if ("back".equals(key)) action = GLOBAL_ACTION_BACK;
        else if ("home".equals(key)) action = GLOBAL_ACTION_HOME;
        else if ("recents".equals(key) || "app_switch".equals(key)) action = GLOBAL_ACTION_RECENTS;
        else if ("notifications".equals(key)) action = GLOBAL_ACTION_NOTIFICATIONS;
        else if ("lock".equals(key) && Build.VERSION.SDK_INT >= 28) action = GLOBAL_ACTION_LOCK_SCREEN;
        else if ("power_dialog".equals(key)) action = GLOBAL_ACTION_POWER_DIALOG;
        else if ("quick_settings".equals(key)) action = GLOBAL_ACTION_QUICK_SETTINGS;
        else return false;
        try {
            return performGlobalAction(action);
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * v2.4.1 秒踢回桌面（LockOverlayService 拦截链用）：performGlobalAction(HOME) 由系统
     * 无障碍通道执行，【不受 Android 10+ 后台 Activity 启动限制】、无需可见窗口豁免——
     * 比 startActivity(Home intent) 快且稳（后者后台调用会被系统静默吞掉）。
     * 服务未连接返回 false（调用方自行降级走 Home intent 路线）。
     */
    public static boolean kickHome() {
        AiAccessibilityService svc = instance;
        if (svc == null) return false;
        try {
            return svc.globalAction("home");
        } catch (Throwable t) {
            return false;
        }
    }

    // ================= 文本输入（ACTION_SET_TEXT） =================

    /**
     * 向当前焦点输入框注入文本（整体替换）。
     * 返回 0=成功 / 1=无焦点输入框 / 2=输入框不可编辑 / 3=执行失败。
     */
    public int inputText(String text) {
        try {
            AccessibilityNodeInfo node = findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (node == null) return 1;
            if (!node.isEditable()) {
                node.recycle();
                return 2;
            }
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            boolean ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
            node.recycle();
            return ok ? 0 : 3;
        } catch (Throwable t) {
            return 3;
        }
    }

    // ================= 屏幕尺寸（坐标换算用，替代 wm size） =================

    /** 屏幕像素尺寸（含系统栏的真实画布；返回 [width, height] 或 null） */
    public int[] screenSize() {
        try {
            if (getWindows() != null && !getWindows().isEmpty()) {
                // 以最大窗口为准（全屏 App 窗口 ≈ 物理画布）
                Rect best = null;
                for (android.view.accessibility.AccessibilityWindowInfo w : getWindows()) {
                    Rect wr = new Rect();
                    w.getBoundsInScreen(wr);
                    if (best == null || (long) wr.width() * wr.height() > (long) best.width() * best.height()) {
                        best = wr;
                    }
                }
                if (best != null && best.width() > 0 && best.height() > 0) {
                    return new int[]{best.width(), best.height()};
                }
            }
            return null;
        } catch (Throwable t) {
            return null;
        }
    }

    // ================= 服务是否已开启（插件查询用） =================

    /** 无障碍服务是否已连接（静态：服务未运行时也可查） */
    public static boolean isConnected() {
        return instance != null;
    }
}
