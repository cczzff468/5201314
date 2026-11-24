package com.z.aiphone;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
        Toast.makeText(this, "再按一次退出 AI Phone", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 原生感知插件注册（必须先于 super.onCreate）
        registerPlugin(NativePerceptionPlugin.class);

        // v2.4.6 ① 全屏沉浸：窗口强制 edge-to-edge——WebView 画到物理屏最边（含挖孔区）,
        // 系统状态栏/导航条浮在网页壁纸上，取代旧版「WebView 被压到状态栏下 + 条带露
        // windowBackground 灰/黑底」（浅色壁纸上那条分界线的根因）。
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

        // v2.4.6 ② 安全区监听：缓存最新 insets（systemBars + displayCutout 的并集 = 真实
        // 避让区；旋转/键盘变化都会回调）+ 把 dp 值经 evaluateJavascript 推给
        // window.__aiphoneApplySafeArea（网页侧更新 --app-sat/-sar/-sab/-sal,
        // configChanges 已声明 orientation/screenSize → 不重载页面，仅重排）。
        // 返回值保持「透传」：Chromium WebView 自己也监听 insets（键盘 visualViewport/
        // resizes-content 机制），在 decor 层 CONSUMED 会切断它——只读取、不拦截。
        final View decor = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            Insets area = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = getResources().getDisplayMetrics().density;
            safeTop = Math.round(area.top / density);
            safeRight = Math.round(area.right / density);
            safeBottom = Math.round(area.bottom / density);
            safeLeft = Math.round(area.left / density);
            pushInsetsToWeb();
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
        if (this.bridge != null && this.bridge.getWebView() != null) {
            android.webkit.WebView webView = this.bridge.getWebView();
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

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

        /** 系统状态栏/导航栏图标明暗（网页按壁纸实测亮度推过来，系统条真正「融入」APP）:
         *  LIGHT=深色图标配浅背景；DARK=白色图标配深背景；DEFAULT=随系统主题。 */
        @JavascriptInterface
        public void setSystemBarsStyle(String style) {
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
                        ctl.setAppearanceLightStatusBars(!night);
                        ctl.setAppearanceLightNavigationBars(!night);
                    } else {
                        ctl.setAppearanceLightStatusBars(!lightIcons);
                        ctl.setAppearanceLightNavigationBars(!lightIcons);
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
