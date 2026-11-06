package com.z.aiphone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * 屏幕捕获前台服务（「让 TA 看到我的屏幕」原生数据源）：
 *
 * - MediaProjection 会话由 NativePerceptionPlugin.requestScreenCapture 发起授权，
 *   授权结果（resultCode + resultData Intent）透传给本服务启动；
 * - Android 14+（targetSdk 34+）强制「前台服务先行」：onStartCommand 里先
 *   startForeground(FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) 再拿 projection；
 * - VirtualDisplay 渲到 ImageReader surface；抓帧 = acquireLatestImage → Bitmap →
 *   JPEG(75) → base64（网页端 VLM 直接识图，宽压到 ~720 省内存带宽）；
 * - 单实例静态引用（instance），插件跨进程面直接读；stopSelf 时清空。
 */
public class ScreenCaptureService extends Service {

    public static final String EXTRA_RESULT_CODE = "result_code";
    public static final String EXTRA_RESULT_DATA = "result_data";

    private static final String CHANNEL_ID = "aiphone_screen_capture";
    private static final int NOTIF_ID = 0xA1;
    /** 抓帧目标宽（屏幕等比缩放，识图足够） */
    private static final int TARGET_WIDTH = 720;

    public static volatile ScreenCaptureService instance;

    private MediaProjection projection;
    private ImageReader imageReader;
    private VirtualDisplay virtualDisplay;
    private int virtualWidth;
    private int virtualHeight;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @SuppressWarnings("deprecation")
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 通知栏点「停止」（同服务 stop action）→ 直接结束会话
        if (intent != null && "stop".equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification notif = buildNotification();
        // Android 10+（API 29）必须带 FGS 类型；以下用两参重载
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, notif, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIF_ID, notif);
        }

        if (intent == null || !intent.hasExtra(EXTRA_RESULT_CODE)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        if (resultData == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        // 旧会话先释放（重复授权时重启会话）
        releaseQuietly();

        try {
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            projection = mpm.getMediaProjection(resultCode, resultData);
            if (projection == null) {
                stopSelf();
                return START_NOT_STICKY;
            }
            projection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    releaseQuietly();
                    stopSelf();
                }
            }, null);

            // 屏幕物理尺寸 → 等比缩放到 TARGET_WIDTH
            DisplayMetrics real = new DisplayMetrics();
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            wm.getDefaultDisplay().getRealMetrics(real);
            float scale = TARGET_WIDTH / (float) Math.max(1, real.widthPixels);
            virtualWidth = Math.max(2, Math.round(real.widthPixels * scale) & ~1); // 偶数对齐
            virtualHeight = Math.max(2, Math.round(real.heightPixels * scale) & ~1);
            int dpi = Math.max(1, Math.round(real.densityDpi * scale));

            imageReader = ImageReader.newInstance(virtualWidth, virtualHeight, PixelFormat.RGBA_8888, 2);
            virtualDisplay = projection.createVirtualDisplay(
                    "aiphone-perception", virtualWidth, virtualHeight, dpi,
                    0, imageReader.getSurface(), null, null);

            instance = this;
        } catch (Exception e) {
            releaseQuietly();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseQuietly();
        super.onDestroy();
    }

    /** 抓当前屏幕一帧 → dataURL（data:image/jpeg;base64,...）；无会话/无帧返回 null */
    public String grabFrameDataUrl() {
        ImageReader reader = imageReader;
        if (reader == null || instance == null) return null;
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) {
                // 首次拉流可能还没渲染出帧：短暂自旋等待（最多 ~500ms）
                for (int i = 0; i < 10 && image == null; i++) {
                    try { Thread.sleep(50); } catch (InterruptedException ignored) { }
                    image = reader.acquireLatestImage();
                }
            }
            if (image == null) return null;

            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer buffer = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int rowPadding = Math.max(0, rowStride - pixelStride * virtualWidth);
            int bitmapW = virtualWidth + (pixelStride > 0 ? rowPadding / pixelStride : 0);

            Bitmap full = Bitmap.createBitmap(bitmapW, virtualHeight, Bitmap.Config.ARGB_8888);
            full.copyPixelsFromBuffer(buffer);
            image.close();
            image = null;

            Bitmap cropped = (bitmapW == virtualWidth)
                    ? full
                    : Bitmap.createBitmap(full, 0, 0, virtualWidth, virtualHeight);

            ByteArrayOutputStream bos = new ByteArrayOutputStream(96 * 1024);
            cropped.compress(Bitmap.CompressFormat.JPEG, 75, bos);
            if (cropped != full) cropped.recycle();
            if (full != cropped) full.recycle();

            return "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            if (image != null) {
                try { image.close(); } catch (Exception ignored) { }
            }
            return null;
        }
    }

    /** 停止捕获并停掉前台服务（插件 stopScreenCapture 调用） */
    public static void stopCapture() {
        ScreenCaptureService svc = instance;
        if (svc != null) {
            svc.stopSelf();
        }
    }

    private void releaseQuietly() {
        instance = null;
        try {
            if (virtualDisplay != null) { virtualDisplay.release(); virtualDisplay = null; }
        } catch (Exception ignored) { }
        try {
            if (imageReader != null) { imageReader.close(); imageReader = null; }
        } catch (Exception ignored) { }
        try {
            if (projection != null) { projection.stop(); projection = null; }
        } catch (Exception ignored) { }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "屏幕感知", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("TA 正在看到你的屏幕（点击通知可停止）");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        Intent stopIntent = new Intent(this, ScreenCaptureService.class);
        stopIntent.setAction("stop");
        android.app.PendingIntent pi = android.app.PendingIntent.getService(
                this, 1, stopIntent, android.app.PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        b.setContentTitle("AI Phone · 屏幕感知中")
                .setContentText("TA 能看到你的屏幕（本轮会话）")
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setOngoing(true)
                .setContentIntent(pi);
        return b.build();
    }
}
