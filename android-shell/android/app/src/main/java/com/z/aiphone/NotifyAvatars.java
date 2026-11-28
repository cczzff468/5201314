package com.z.aiphone;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
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
 * 机主规格：通知栏左侧图标用当前聊天角色的真实头像（不再用系统默认蓝图标）。
 * - dataURL（canvas.toDataURL 产物 / 服务端 pollNative avatar 字段）→ base64 解码；
 * - http(s) URL（站内头像路径转绝对地址）→ 轻量下载（6s 超时、2MB 上限）；
 * - LRU 缓存（key = src 的 md5 短哈希——dataURL 可能数百 KB，不能直接当 key）；
 * - 统一压到 ≤256px：通知大图标渲染尺寸 ~64dp（xxxhdpi 也就 192px），省内存。
 *
 * 线程约定：decode() 是同步阻塞（网络/解码），调用方必须在后台线程调用
 * （BgNotifyPoller 轮询线程 / NativePerceptionPlugin 通知专用单线程池）。
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
}
