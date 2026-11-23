package com.z.aiphone;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.widget.Toast;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;

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
        super.onCreate(savedInstanceState);

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

        // WebView 下载接管：安卓 WebView 默认没有下载处理（<a href="xx.apk" download>
        // 点击毫无反应的根因）。设置 DownloadListener → 系统下载管理器（通知栏进度）
        // → 下载完成自动弹安装（APK MIME 时）。
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().setDownloadListener(new DownloadListener() {
                @Override
                public void onDownloadStart(String url, String userAgent,
                        String contentDisposition, String mimetype, long contentLength) {
                    MainActivity.this.startDownload(url, userAgent);
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
