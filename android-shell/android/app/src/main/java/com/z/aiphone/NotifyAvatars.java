package com.z.aiphone;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.util.Base64;
import android.util.LruCache;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * v2.4.29（第四十八轮）：系统通知大图标（角色头像）解码工具。
 *
 * 机主规格（第四十九轮，推翻 v2.4.29 的合并排版）：
 * 一、AI 每发一条独立的消息，系统就弹一条独立的横幅通知——绝不合并、绝不原地更新
 * 二、v2.4.33 通知图标方向根修（机主规格「左边图标变成我选择的图标，右面显示AI头像」）：
 *  - 小图标（通知卡左上，原 ic_stat_cove 单色气泡）→ 换成【机主设置›APP图标 所选那一枚】
 *    的彩色位图（Icon.createWithBitmap——国产 ROM 通知头部原样渲染彩色位图，不再是被
 *    ROM 随意渲染的灰样式）；解码失败回落 ic_stat_cove。
 *  - 大图标（通知卡右侧）→ 改为【会话角色 AI 头像】（旧版 v2.4.30 把所选 APP 图标放大
 *    图标——方向反了，机主看到右侧是 Cove 图标而不是 TA 的头像）。
 * v2.4.33 抽出 buildMessageNotification 共用构建器（BgNotifyPoller.postHeadsUp 与
 * NativePerceptionPlugin.postLocalNotify 两路同构，图标口径一字不差）。
 *
 * 线程约定：decode()/buildMessageNotification 是同步阻塞（网络/解码），调用方必须在
 * 后台线程调用（BgNotifyPoller 轮询线程 / NativePerceptionPlugin 通知专用单线程池）。
 */
public final class NotifyAvatars {

    /** 头像下载/解码超时 */
    private static final int HTTP_TIMEOUT_MS = 6_000;
    /** 下载字节硬上限（正常头像 dataURL/JPEG 远小于此） */
    private static final int DOWNLOAD_MAX_BYTES = 2 * 1024 * 1024;
    /** 通知大图标足够用的最大边长（再大纯浪费内存） */
    private static final int MAX_DIM = 256;
    /** src 字符长度硬上限：超长 dataURL 直接放弃（防桥参数异常巨串拖垮解码） */
    private static final int SRC_MAX_CHARS = 600_000;
    /** LRU 条目数（头像很小，16 个会话绰绰有余） */
    private static final int CACHE_ENTRIES = 16;

    private static final LruCache<String, Bitmap> CACHE = new LruCache<String, Bitmap>(CACHE_ENTRIES) {
        @Override
        protected void entryRemoved(boolean evicted, String key, Bitmap oldValue, Bitmap newValue) {
            // 被淘汰的位图交给 GC（Bitmap 不主动 recycle，防仍被在途通知引用导致闪烁）
        }
    };

    private NotifyAvatars() {
    }

    /** 同步解码（后台线程调用）：缓存命中直接返回；失败返回 null（调用方跳过大图标） */
    public static Bitmap decode(String src) {
        if (src == null) return null;
        String s = src.trim();
        if (s.isEmpty() || s.length() > SRC_MAX_CHARS) return null;
        String key = keyOf(s);
        Bitmap hit = CACHE.get(key);
        if (hit != null) return hit;
        Bitmap out = null;
        try {
            if (s.startsWith("data:image/")) {
                out = decodeDataUrl(s);
            } else if (s.startsWith("http://") || s.startsWith("https://")) {
                out = download(s);
            }
        } catch (Throwable ignored) {
            out = null; // 任何解码异常：通知不带大图标，绝不影响通知本体
        }
        if (out != null) CACHE.put(key, out);
        return out;
    }

    /** dataURL → Bitmap：定位 "base64," 后解码 + 尺寸压到 MAX_DIM */
    private static Bitmap decodeDataUrl(String s) {
        int comma = s.indexOf(',');
        if (comma <= 0 || comma >= s.length() - 1) return null;
        String b64 = s.startsWith("data:image/", 0) && s.indexOf("base64", 5) >= 0
                ? s.substring(comma + 1)
                : null;
        if (b64 == null) return null;
        byte[] raw = Base64.decode(b64, Base64.DEFAULT);
        return decodeScaled(raw);
    }

    /** http(s) 下载 → Bitmap（6s 超时 / 2MB 上限 / 压到 MAX_DIM） */
    private static Bitmap download(String urlStr) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(HTTP_TIMEOUT_MS);
            conn.setReadTimeout(HTTP_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(true);
            if (conn.getResponseCode() != 200) return null;
            InputStream in = conn.getInputStream();
            if (in == null) return null;
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) {
                buf.write(chunk, 0, n);
                if (buf.size() > DOWNLOAD_MAX_BYTES) {
                    in.close();
                    return null; // 超上限：按坏图处理
                }
            }
            in.close();
            return decodeScaled(buf.toByteArray());
        } catch (Throwable t) {
            return null;
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Throwable ignored) {
                }
            }
        }
    }

    /** 字节 → Bitmap（先探尺寸再按需降采样，防大图瞬时占用整块内存） */
    private static Bitmap decodeScaled(byte[] raw) {
        if (raw == null || raw.length == 0) return null;
        BitmapFactory.Options probe = new BitmapFactory.Options();
        probe.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(raw, 0, raw.length, probe);
        if (probe.outWidth <= 0 || probe.outHeight <= 0) return null;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        int maxSide = Math.max(probe.outWidth, probe.outHeight);
        if (maxSide > MAX_DIM) {
            opts.inSampleSize = Math.max(1, Math.round((float) maxSide / MAX_DIM));
        }
        Bitmap bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length, opts);
        if (bmp == null) return null;
        int w = bmp.getWidth(), h = bmp.getHeight();
        int side = Math.max(w, h);
        if (side > MAX_DIM) {
            float scale = (float) MAX_DIM / side;
            Bitmap scaled = Bitmap.createScaledBitmap(bmp, Math.round(w * scale), Math.round(h * scale), true);
            if (scaled != null && scaled != bmp) bmp.recycle();
            return scaled;
        }
        return bmp;
    }

    /** 稳定短键：src 可能是超长 dataURL，直接当 LRU key 会撑内存——取 md5 前 16 hex */
    private static String keyOf(String src) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] d = md.digest(src.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(16);
            for (int i = 0; i < 8; i++) sb.append(String.format("%02x", d[i]));
            return sb.toString();
        } catch (Throwable t) {
            return String.valueOf(src.hashCode());
        }
    }

    // ================= v2.4.33 共用消息通知构建器（图标方向根修） =================

    /**
     * 构建「AI 消息」通知（BgNotifyPoller 后台轮询 / localNotify 桥接两路共用）：
     *
     * - 小图标（通知卡左上）：机主所选 APP 图标彩色位图（smallIconBmp 非空时
     *   Icon.createWithBitmap——国产 ROM 头部原样彩色渲染）；空时回落 smallIconRes
     *   （ic_stat_cove 单色气泡）。注意必须用 framework Notification.Builder
     *   （NotificationCompat 无 setSmallIcon(Icon) 重载）。
     * - 大图标（通知卡右侧）：会话角色 AI 头像（largeBmp；null 则不带）。
     * - headsUp=true：PRIORITY_MAX + CATEGORY_MESSAGE + DEFAULT_ALL（声/震/亮屏）；
     *   false：静默口径（PRIORITY_DEFAULT，不动声色——拉回兑底等安静提醒用）。
     * - BigTextStyle 全文展开 + 点击直达（contentPi）+ autoCancel。
     *
     * @param channel API26+ 通知渠道（低版本忽略，传 null 安全）
     */
    public static Notification buildMessageNotification(
            Context ctx, String channel, int smallIconRes, Bitmap smallIconBmp, Bitmap largeBmp,
            String title, String text, PendingIntent contentPi, boolean headsUp) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 && channel != null
                ? new Notification.Builder(ctx, channel)
                : new Notification.Builder(ctx.getApplicationContext());
        if (smallIconBmp != null) {
            try {
                b.setSmallIcon(Icon.createWithBitmap(smallIconBmp));
            } catch (Throwable t) {
                b.setSmallIcon(smallIconRes); // 个别 ROM 不认位图小图标：回落单色资源
            }
        } else {
            b.setSmallIcon(smallIconRes);
        }
        if (largeBmp != null) b.setLargeIcon(largeBmp);
        b.setContentTitle(title == null || title.isEmpty() ? "新消息" : title)
                .setContentText(text == null ? "" : text)
                .setStyle(new Notification.BigTextStyle().bigText(text == null ? "" : text))
                .setAutoCancel(true)
                .setContentIntent(contentPi);
        if (headsUp) {
            b.setPriority(Notification.PRIORITY_MAX)
                    .setDefaults(Notification.DEFAULT_ALL)
                    .setCategory(Notification.CATEGORY_MESSAGE);
        } else {
            b.setPriority(Notification.PRIORITY_DEFAULT);
        }
        return b.build();
    }

    /** v2.4.33：把任意位图裁成小图标友好尺寸（≈48dp·xxhdpi=144px，中心方形缩放）——
     *  所选 APP 图标 PNG（192/256px）直接做位图小图标偏大，缩一缩省内存且更清晰 */
    public static Bitmap asSmallIconBitmap(Bitmap src) {
        if (src == null) return null;
        try {
            final int side = 144;
            int w = src.getWidth(), h = src.getHeight();
            if (w <= side && h <= side) return src;
            float scale = (float) side / Math.max(w, h);
            Bitmap out = Bitmap.createScaledBitmap(
                    src, Math.round(w * scale), Math.round(h * scale), true);
            return out != null ? out : src;
        } catch (Throwable t) {
            return src;
        }
    }
}
