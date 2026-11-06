package com.z.aiphone;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 原生感知插件注册（必须先于 super.onCreate）
        registerPlugin(NativePerceptionPlugin.class);
        super.onCreate(savedInstanceState);

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
