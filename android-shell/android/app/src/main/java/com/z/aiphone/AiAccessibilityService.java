package com.z.aiphone;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Bitmap;
import android.graphics.Path;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

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
                stablePkg = pkg;
                stableAt = now;
            } else if (stablePkg == null) {
                stablePkg = pkg;
                stableAt = now;
            }
        } catch (Throwable ignored) {
            // 感知事件绝不 crash 服务
        }
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

    // ================= 静默截屏（API 30+） =================

    /** 截屏结果回调（dataUrl 与 error 互斥） */
    public interface ShotCallback {
        void onResult(String dataUrl, String error);
    }

    /**
     * 静默截屏：AccessibilityService.takeScreenshot（API 30+）→ 降采样 JPEG base64。
     * 输出与旧 shizukuScreencap 同构（宽 ≤720、JPEG、dataURL）。
     * 任何一步失败回调 error（no-a11y / not-supported / empty）。
     */
    public void shootScreenshot(final ShotCallback cb) {
        if (Build.VERSION.SDK_INT < 30) {
            cb.onResult(null, "not-supported"); // API < 30 无此接口
            return;
        }
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, SHOT_EXECUTOR,
                    new AccessibilityService.TakeScreenshotCallback() {
                        @Override
                        public void onSuccess(AccessibilityService.ScreenshotResult result) {
                            HardwareBuffer buffer = null;
                            try {
                                buffer = result.getHardwareBuffer();
                                if (buffer == null) {
                                    cb.onResult(null, "empty");
                                    return;
                                }
                                Bitmap bmp = Bitmap.wrapHardwareBuffer(buffer, null);
                                if (bmp == null) {
                                    cb.onResult(null, "empty");
                                    return;
                                }
                                // 软拷贝出可压缩的位图（hardware bitmap 不能直接 compress）
                                Bitmap soft = bmp.copy(Bitmap.Config.ARGB_8888, false);
                                bmp.recycle();
                                if (soft == null) {
                                    cb.onResult(null, "empty");
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
                                cb.onResult("data:image/jpeg;base64," + b64, null);
                            } catch (Throwable t) {
                                cb.onResult(null, "failed");
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
                            cb.onResult(null, "error-" + errorCode); // ERROR_TAKE_SCREENSHOT_INTERNAL_ERROR 等
                        }
                    });
        } catch (Throwable t) {
            cb.onResult(null, "failed");
        }
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
