package com.z.aiphone;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import androidx.annotation.Keep;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    /** 公共下载目录里的目标文件名（与 getUriForFile / FileProvider 路径对应） */
    private static final String APK_FILE_NAME = "AI-Phone.apk";

    /** v2.2.0 进程前后台跟踪（bringToFront 后台拉回豁免判定用）：
     *  onStart 置 true / onStop 置 false——生命周期回调都在主线程，volatile 读足够安全 */
    private static volatile boolean appInForeground = false;

    /** 本 App 是否在前台（NativePerceptionPlugin.bringToFront 后台启动限制判定用） */
    public static boolean isAppInForeground() {
        return appInForeground;
    }

    /** 音量键翻页直通开关（阅读 App 通过 NativePerception.setVolumeKeyTurn 同步；
     *  开启时音量上/下键不再调系统音量，改为向 WebView 派发 window.__nativeVolTurn(dir)） */
    public static boolean volumeKeyTurn = false;

    /** 返回键/返回手势：上一次按下时间（双击退出的窗口判定） */
    private long lastBackAt = 0;

    /** v2.4.6 安全区缓存（CSS px，即 dp）：HTML 解析期同步可读（网页首帧即按安全区布局,
     *  消「启动瞬间一次布局下移」）；inset 监听线程写、JS 桥线程读，volatile 保证可见。 */
    private volatile int safeTop = 0, safeRight = 0, safeBottom = 0, safeLeft = 0;

    /** v2.4.6 网页桥（addJavascriptInterface 在 super.onCreate 的 WebView 创建后立即挂上,
     *  先于任何页面加载 → 远程页 body 首位内联脚本同步 getSafeArea() 预注入 CSS 变量）。 */
    private final NativeBridge nativeBridge = new NativeBridge();

    /** v2.2.0 生命周期前后台打点（bringToFront 后台拉回豁免判定用） */
    @Override
    public void onStart() {
        super.onStart();
        appInForeground = true;
    }

    @Override
    public void onStop() {
        super.onStop();
        appInForeground = false;
        // v2.4.12 撤销补藏哨兵：退后台后不再延迟补藏（免得切回来瞬问多余 hide 抢在布局前）
        reHideHandler.removeCallbacks(reHideRunnable);
    }

    /** v2.4.12 全屏隐藏终极加固（机主反馈「还是这样，没有变化」）：新旧两条通道同时下发——
     *  ① 传统 systemUiVisibility：FULLSCREEN + IMMERSIVE_STICKY + LAYOUT_STABLE/LAYOUT_FULLSCREEN
     *    （API 30 起废弃但实际仍生效；部分国产 ROM 只认这条；IMMERSIVE_STICKY 让顶部滑出后
     *    自动收回，防部分 ROM「滑出一次就赖着不走」）
     *  ② WindowInsetsControllerCompat.hide(statusBars)（API 30+ 官方路径 + 兼容包装）
     *  ③ FLAG_FULLSCREEN 窗口级兑底。三条全发，任何 ROM/任何场景命中其一即全屏。 */
    private void hideSystemBarsRobust() {
        try {
            View decor = getWindow() != null ? getWindow().getDecorView() : null;
            if (decor != null) {
                decor.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
            }
        } catch (Throwable ignored) {
        }
        try {
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(
                    getWindow(), getWindow().getDecorView());
            bars.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            bars.hide(WindowInsetsCompat.Type.statusBars());
        } catch (Throwable ignored) {
        }
        try {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        } catch (Throwable ignored) {
        }
    }

    /** v2.4.12 补藏哨兵：回前台/重获焦点后系统条可能被权限弹窗、转场动画晚一拍拉回——
     *  0.8s 与 2.5s 两次延迟补藏（onStop 撤销；用户主动滑出的瞬时条不受影响：
     *  IMMERSIVE_STICKY 自己会收）。 */
    private final android.os.Handler reHideHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable reHideRunnable = this::hideSystemBarsRobust;

    private void scheduleRehideWatchdog() {
        reHideHandler.removeCallbacks(reHideRunnable);
        reHideHandler.postDelayed(reHideRunnable, 800L);
        reHideHandler.postDelayed(reHideRunnable, 2500L);
    }

    /** v2.4.12 ③ 系统状态栏重申隐藏：切后台/权限弹窗等场景系统条可能被拉回，回来即再藏
     *  （onCreate 里已用同一逻辑首帧生效，此处 + 延迟哨兵双保险）。
     *  （public：BridgeActivity 的 onResume 为 public，protected 会降权编译不过） */
    @Override
    public void onResume() {
        super.onResume();
        hideSystemBarsRobust();
        scheduleRehideWatchdog();
    }

    /** v2.4.12 ③ 窗口重获焦点（权限弹窗关闭/键盘收起等）时再藏一次，确保全屏不回退 */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBarsRobust();
        }
    }

    /** v2.4.12 ③ 旋屏/系统配置变化（manifest 已声明 configChanges 不重载页面）后再申全屏 */
    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        hideSystemBarsRobust();
    }

    /** 音量键拦截：阅读器开启「音量键翻页」时消费音量键（不调系统音量），
     *  转发给 WebView 的 window.__nativeVolTurn(±1)；关闭时保持系统默认行为。
     *  纯浏览器/旧 APK 里音量键永远到不了网页层，这正是用户反馈"开了没反应"的根因。 */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (volumeKeyTurn
                && (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            dispatchVolumeTurn(keyCode == KeyEvent.KEYCODE_VOLUME_UP ? -1 : 1);
            return true; // 消费：不再调系统音量
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (volumeKeyTurn
                && (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            return true; // 同步消费，防止音量 UI 窗口弹出
        }
        return super.onKeyUp(keyCode, event);
    }

    /** 向 WebView 派发音量键翻页回调（音量上=-1 上一页；音量下=+1 下一页） */
    private void dispatchVolumeTurn(final int dir) {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        this.bridge.getWebView().post(() -> {
            try {
                MainActivity.this.bridge.getWebView().evaluateJavascript(
                        "(window.__nativeVolTurn && window.__nativeVolTurn(" + dir + "))", null);
            } catch (Exception ignored) {
            }
        });
    }

    /** 返回键/返回手势处理（v1.9.42 修复「点击悬浮球退出 APP」）：
     *  语音助手悬浮球吸附在屏幕右缘，轻触时的微小位移会被 Android 手势导航
     *  识别成「返回」——Capacitor 默认行为在 WebView 无历史（配置页经
     *  location.replace 进入，无回退栈）时直接 finish 整个 APP，表现为
     *  「点一下悬浮球就退出了」。现在返回一律不退出：第一次提示「再按一次
     *  退出」，2 秒内再按才退到后台（moveTaskToBack 保活，不销毁 WebView
     *  状态，聊天/登录态不丢）。 */
    @Override
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBackAt < 2000) {
            lastBackAt = 0;
            moveTaskToBack(true);
            return;
        }
        lastBackAt = now;
        Toast.makeText(this, "再按一次退出 Cove", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 原生感知插件注册（必须先于 super.onCreate）
        registerPlugin(NativePerceptionPlugin.class);

        // v2.4.6 ① 全屏沉浸：窗口强制 edge-to-edge——WebView 画到物理屏最边（含挖孔区）。
        // Capacitor 8 内置 SystemBars 插件默认会给 decor 打 padding（WebView<140 或无
        // viewport-fit 时），capacitor.config.ts 已配 insetsHandling: 'disable' 关掉它,
        // 安全区改由下方 ② 的原生桥下发，首帧即就位。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // 允许内容画进挖孔区（横屏挖孔在侧边时左右同理）
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            getWindow().setAttributes(lp);
        }

        super.onCreate(savedInstanceState);

        // v2.4.9 ⓪ 系统状态栏直接【隐藏】（机主定调：不要融入、不显示，全屏；时间/信号/电量
        // 由网页自绘状态栏显示——globals.css 已同步移除 APK 模式对 .ph-statusbar 的隐藏规则）。
        // 原生层窗口级一次生效：无网页配色/时序参与（旧「融入」方案显示慢、有的页面融合不进去的
        // 根因就是走网页层采样链），且本 App 所有界面都在同一个 WebView 窗口里——天然全界面一致。
        // BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE：从顶部边缘滑动可临时呼出（浮层展示、几秒后
        // 自动收起，不挤压内容）；导航栏保持显示（底部手势区不变）。
        // v2.4.12 改走 hideSystemBarsRobust()：传统 systemUiVisibility（IMMERSIVE_STICKY，
        // 部分国产 ROM 只认这条、顶边滑出后自动收回）+ 兼容控制器 + FLAG_FULLSCREEN 三通道齐发。
        hideSystemBarsRobust();

        // v2.4.6 ② 安全区监听：缓存最新 insets + 把 dp 值经 evaluateJavascript 推给
        // window.__aiphoneApplySafeArea（网页侧更新 --app-sat/-sar/-sab/-sal,
        // configChanges 已声明 orientation/screenSize → 不重载页面，仅重排）。
        // v2.4.9 顶部口径变更：top 只取【挖孔】inset，不再并入 systemBars——状态栏已隐藏
        // （systemBars.top 恒 0），且顶部从边缘临时呼出状态栏时是浮层展示（全屏应用标准行为，
        // 不把内容顶下来）；网页自绘状态栏正好落在挖孔下缘，无挖孔机型顶到物理屏顶=真全屏。
        // 其余三边仍取 systemBars ∪ displayCutout 并集（底部导航条/横屏侧边挖孔照旧避让）。
        // 返回值保持「透传」：Chromium WebView 自己也监听 insets（键盘 visualViewport/
        // resizes-content 机制），在 decor 层 CONSUMED 会切断它——只读取、不拦截。
        final View decor = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            Insets cut = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            Insets sys = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            float density = getResources().getDisplayMetrics().density;
            safeTop = Math.round(cut.top / density);
            safeRight = Math.round(Math.max(sys.right, cut.right) / density);
            safeBottom = Math.round(Math.max(sys.bottom, cut.bottom) / density);
            safeLeft = Math.round(Math.max(sys.left, cut.left) / density);
            pushInsetsToWeb();
            // 第三十轮·网页浏览时系统状态栏再显示根修：IMMERSIVE_STICKY 的系统行为是「顶部
            // 滑出→悬停数秒→自动收回」，但网页里滚动/触摸（尤其 iframe 全屏铺到顶边时）会
            // 频繁触发顶部滑出，机主观感即「网页一打开系统状态栏就又显示了」。这里监听
            // statusBars 可见性：一旦冒头，350ms 后主动三通道齐发收回——比系统默认的
            // 悬停数秒快一个量级，看得到即收回（机主感知：闪一下就没了，不再赖着）。
            // 350ms 延迟：避开系统手势过程中的连续 insets 变化（手势中途立即抢藏会被系统
            // 再拉起造成闪烁拉锯），等手势落定再藏一次即稳。
            try {
                if (insets.isVisible(WindowInsetsCompat.Type.statusBars())) {
                    android.os.Handler h = reHideHandler;
                    if (h != null) {
                        h.removeCallbacks(reHideRunnable);
                        h.postDelayed(reHideRunnable, 350L);
                    }
                }
            } catch (Throwable ignored) {
                // isVisible 老系统不可用时静默（IMMERSIVE_STICKY 自动收回兜底仍在）
            }
            return insets;
        });

        // v2.2.0 冷启动通知直达兜底：App 被杀后点通知栏里的聊天通知拉起 →
        // handleOnNewIntent 不会触发（不走 onNewIntent），extras 挂在 getIntent() 里。
        // 这里 postDelayed 1.8s（等 WebView 首屏加载）后交给插件注入链路直达聊天。
        try {
            Intent boot = getIntent();
            if (boot != null) {
                final String url = boot.getStringExtra("local_notify_url");
                final String target = boot.getStringExtra("local_notify_target");
                if ((url != null && !url.isEmpty()) || (target != null && !target.isEmpty())) {
                    final android.os.Handler h = new android.os.Handler(getMainLooper());
                    h.postDelayed(() -> {
                        try {
                            NativePerceptionPlugin.injectPendingOpenFromColdBoot(url, target);
                        } catch (Throwable ignored) {
                            // 兜底失败静默（用户自然落在首页）
                        }
                    }, 1800L);
                }
            }
        } catch (Throwable ignored) {
        }

        // v2.4.6 ③ 右缘常驻白条根除：Android WebView 页面可滚时会在右缘画一条经典
        // 滚动条轨道（浅色主题下就是白道，截图里 APP 有、网站没有的「右缘空白」）。
        // 本应用是全屏壳（网页侧 body 已锁 overflow:hidden），View 级滚动条没有存在
        // 意义——直接关掉竖/横滚动条与 overscroll 光晕。
        // v2.4.9 追加两道保险（右缘白条多轮未除的最后一搏）：scrollBarStyle 强制
        // INSIDE_OVERLAY（即使某处重新启用滚动条也是浮层绘制、绝不预留布局位）；
        // setScrollContainer(false)（把「可滚容器」身份摘掉，Chromium 滚动条预留
        // 通道的判定入口直接关闭）。
        if (this.bridge != null && this.bridge.getWebView() != null) {
            android.webkit.WebView webView = this.bridge.getWebView();
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
            webView.setScrollContainer(false);

            // v2.4.6 网页安全区桥（WebView 建立即挂，任何页面首帧可同步读）
            webView.addJavascriptInterface(nativeBridge, "AIPhoneNative");

            // WebView 下载接管：安卓 WebView 默认没有下载处理（<a href="xx.apk" download>
            // 点击毫无反应的根因）。设置 DownloadListener → 系统下载管理器（通知栏进度）
            // → 下载完成自动弹安装（APK MIME 时）。
            webView.setDownloadListener(new DownloadListener() {
                @Override
                public void onDownloadStart(String url, String userAgent,
                        String contentDisposition, String mimetype, long contentLength) {
                    MainActivity.this.startDownload(url, userAgent);
                }
            });
        }
    }

    /** v2.4.21 图标别名组件全名（i=0~1 → .MainActivityIcon1~2，与 Manifest 一致；
     *  第三十九轮：删暗黑版/二次元版，四变体收敛回两变体） */
    private String iconAliasComponent(int i) {
        return getPackageName() + ".MainActivityIcon" + (i + 1);
    }

    /** v2.4.21 别名序号解析：'1'~'2'（或全名 com.z.aiphone.MainActivityIconN）→ 0~1；非法 → -1 */
    private static int parseIconAliasIndex(String aliasId) {
        if (aliasId == null) return -1;
        String s = aliasId.trim();
        int dot = s.lastIndexOf('.');
        if (dot >= 0) s = s.substring(dot + 1).replace("MainActivityIcon", "");
        if (s.length() != 1) return -1;
        char c = s.charAt(0);
        return (c >= '1' && c <= '2') ? c - '1' : -1;
    }

    /** 把缓存安全区推给网页（页面未就绪时静默失败，下次 inset 变化/加载时会再推） */
    private void pushInsetsToWeb() {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        final String payload = safeAreaJson();
        this.bridge.getWebView().post(() -> {
            try {
                this.bridge.getWebView().evaluateJavascript(
                        "try{window.__aiphoneApplySafeArea&&window.__aiphoneApplySafeArea('" + payload + "')}catch(e){}",
                        null);
            } catch (Exception ignored) {
            }
        });
    }

    private String safeAreaJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("top", safeTop);
            o.put("right", safeRight);
            o.put("bottom", safeBottom);
            o.put("left", safeLeft);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** v2.4.6 网页可调的原生桥（挂名 window.AIPhoneNative） */
    @Keep
    private class NativeBridge {
        /** 当前安全区（CSS px）。HTML 解析期同步调用——首帧即按安全区布局（消首帧位移）。 */
        @JavascriptInterface
        public String getSafeArea() {
            return safeAreaJson();
        }

        /** v2.4.9 壳版本桥：网页据 getShellInfo 是否存在区分新旧壳——新壳系统状态栏已隐藏
         *  （网页自绘状态栏回归显示）；旧壳无此方法，网页维持 v2.4.8 行为（自绘状态栏
         *  隐藏、系统状态栏融入），避免旧 APK 先拿到新 CSS 时出现双状态栏。
         *  v2.4.21：版本同步 85 / 2.4.21（新增 activity-alias 图标四变体 + 换图标桥）。 */
        @JavascriptInterface
        public String getShellInfo() {
            JSONObject o = new JSONObject();
            try {
                o.put("versionCode", 85);
                o.put("versionName", "2.4.21");
                o.put("fullscreen", true); // 系统状态栏隐藏（全屏）标记
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        /** v2.4.21 一键无感换图标（Activity Alias）①查询当前启用图标（第三十九轮两变体）：
         *  返回 '1'~'2'。判定口径：getComponentEnabledSetting 只回「上次设置值」——
         *  ENABLED=启用；DEFAULT=按 Manifest 默认（仅 1 号 enabled=true，其余 false）；
         *  DISABLED / DISABLED_USER=禁用。网页设置页图标网格挂载时先调它对齐选中态
         *  （APK 覆盖安装后别名重置回默认 1 号，与网页偏好可能漂移，以原生为准）。 */
        @JavascriptInterface
        public String getCurrentIcon() {
            try {
                PackageManager pm = getPackageManager();
                String pkg = getPackageName();
                for (int i = 0; i < 2; i++) {
                    ComponentName cn = new ComponentName(pkg, iconAliasComponent(i));
                    int state = pm.getComponentEnabledSetting(cn);
                    boolean enabled = state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                            || (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && i == 0);
                    if (enabled) return String.valueOf(i + 1);
                }
            } catch (Throwable ignored) {
            }
            return "1";
        }

        /** v2.4.21 一键无感换图标（Activity Alias）②切换：网页传 '1'~'2'（第三十九轮两变体）。
         *  流程（机主规格·安卓标准方案）：
         *  ① 先启目标别名（防全禁断档——全禁时 App 在启动器瞬间无入口）再关其余，
         *    全程 DONT_KILL_APP（切换期间不杀进程，避免 WebView 中途黑屏）；
         *  ② HOME Intent 退回桌面 + 650ms 后 finishAffinity + System.exit(0) 硬退：
         *    进程级退出让启动器立即重查 launcher 组件——旧图标消失、新图标上桌面。
         *  650ms 延迟：给网页把提示层画完 + 服务器偏好 POST 发出（PWA manifest 同步）
         *  + HOME 转场完成的时间；退出时机过早会看到黑屏一闪。 */
        @JavascriptInterface
        public void switchAppIcon(final String aliasId) {
            final int idx = parseIconAliasIndex(aliasId);
            if (idx < 0) return; // 非法输入静默（网页侧已校验，双保险）
            runOnUiThread(() -> {
                boolean ok = false;
                try {
                    PackageManager pm = getPackageManager();
                    String pkg = getPackageName();
                    // ① 先启目标（防断档）
                    pm.setComponentEnabledSetting(
                            new ComponentName(pkg, iconAliasComponent(idx)),
                            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                            PackageManager.DONT_KILL_APP);
                    // ② 再关其余（同一 MainActivity 的其它别名全部下线——旧图标消失）
                    for (int i = 0; i < 2; i++) {
                        if (i == idx) continue;
                        pm.setComponentEnabledSetting(
                                new ComponentName(pkg, iconAliasComponent(i)),
                                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                                PackageManager.DONT_KILL_APP);
                    }
                    ok = true;
                } catch (Throwable ignored) {
                }
                if (!ok) return;
                // ③ 强制退回桌面（HOME Intent），随后硬退进程逼启动器重查图标
                try {
                    Intent home = new Intent(Intent.ACTION_MAIN);
                    home.addCategory(Intent.CATEGORY_HOME);
                    home.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(home);
                } catch (Throwable ignored) {
                }
                reHideHandler.postDelayed(() -> {
                    try {
                        finishAffinity();
                    } catch (Throwable ignored) {
                    }
                    System.exit(0);
                }, 650L);
            });
        }

        /** 系统状态栏/导航栏图标明暗——状态栏/导航栏可分别设置（v2.4.9 拆分：状态栏已隐藏，
         *  呼出时浮在顶部背景上、用顶部明暗；导航栏在底部、用底部明暗——上下双色壁纸不再错色）：
         *  LIGHT=深色图标配浅背景；DARK=白色图标配深背景；DEFAULT=随系统主题。 */
        @JavascriptInterface
        public void setSystemBarStyles(String statusStyle, String navStyle) {
            applyBarStyle(statusStyle, true);
            applyBarStyle(navStyle, false);
        }

        /** 旧接口（v2.4.6~2.4.8）：状态栏/导航栏同色设置——保留兼容，网页新版改调上面的拆分版 */
        @JavascriptInterface
        public void setSystemBarsStyle(String style) {
            applyBarStyle(style, true);
            applyBarStyle(style, false);
        }

        /** 单条系统条的图标明暗（statusBar=true 状态栏 / false 导航栏） */
        private void applyBarStyle(String style, final boolean statusBar) {
            final boolean lightIcons = "DARK".equalsIgnoreCase(style);
            final boolean isDefault = "DEFAULT".equalsIgnoreCase(style);
            runOnUiThread(() -> {
                try {
                    WindowInsetsControllerCompat ctl = WindowCompat.getInsetsController(
                            getWindow(), getWindow().getDecorView());
                    if (isDefault) {
                        boolean night = (getResources().getConfiguration().uiMode
                                & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                                == android.content.res.Configuration.UI_MODE_NIGHT_YES;
                        if (statusBar) ctl.setAppearanceLightStatusBars(!night);
                        else ctl.setAppearanceLightNavigationBars(!night);
                    } else {
                        if (statusBar) ctl.setAppearanceLightStatusBars(!lightIcons);
                        else ctl.setAppearanceLightNavigationBars(!lightIcons);
                    }
                } catch (Exception ignored) {
                }
            });
        }
    }

    /** 用系统 DownloadManager 下载（公共 Download 目录，通知栏自带进度条），
     *  失败兜底：交给外部浏览器处理。 */
    private void startDownload(String url, String userAgent) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, APK_FILE_NAME);
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                openInBrowser(url);
                return;
            }
            long downloadId = dm.enqueue(request);
            Toast.makeText(this, "开始下载 " + APK_FILE_NAME + "，完成后自动弹出安装",
                    Toast.LENGTH_SHORT).show();
            registerInstallReceiver(dm, downloadId);
        } catch (Exception e) {
            openInBrowser(url);
        }
    }

    /** 下载完成 → FileProvider content:// URI → 调起包安装器。
     *  注意不能直接用 file:// URI（API 24+ FileUriExposedException 崩溃）。 */
    private void registerInstallReceiver(final DownloadManager dm, final long downloadId) {
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != downloadId) return;
                try {
                    context.unregisterReceiver(this);
                } catch (Exception ignored) {
                }
                File file = new File(
                        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                        APK_FILE_NAME);
                if (!file.exists()) return;
                try {
                    Uri uri = FileProvider.getUriForFile(context,
                            context.getPackageName() + ".fileprovider", file);
                    Intent install = new Intent(Intent.ACTION_VIEW);
                    install.setDataAndType(uri, "application/vnd.android.package-archive");
                    install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(install);
                } catch (Exception e) {
                    // 安装器拉不起（极少见）：至少让用户知道文件在哪
                    Toast.makeText(context, "下载完成：文件在 Download/" + APK_FILE_NAME + "，请手动点击安装",
                            Toast.LENGTH_LONG).show();
                }
            }
        };
        // targetSdk 34+ 必须显式 flag；ACTION_DOWNLOAD_COMPLETE 是系统广播 → RECEIVER_EXPORTED
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        ContextCompat.registerReceiver(this, receiver, filter, ContextCompat.RECEIVER_EXPORTED);
    }

    /** 兜底：把下载 URL 交给系统选择浏览器/下载器处理 */
    private void openInBrowser(String url) {
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(view);
        } catch (Exception e) {
            Toast.makeText(this, "无法启动下载，请在浏览器打开本页重试", Toast.LENGTH_LONG).show();
        }
    }
}
