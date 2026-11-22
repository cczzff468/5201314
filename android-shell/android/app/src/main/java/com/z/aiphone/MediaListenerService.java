package com.z.aiphone;

import android.app.Notification;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

/**
 * 媒体感知 + 通知感知服务（v2.0.0 双职责）：
 *
 * ① 正在听什么歌（旧职责，不变）：监听全系统通知，凡带媒体会话 Token 的通知
 *   （网易云 / QQ音乐 / Spotify 等）即创建 MediaController 读元数据；
 *
 * ② 最近通知环形缓冲（v2.0.0 去 Shizuku 新增）：替代旧 dumpsys notification
 *   --noredact 通道 —— 每条非本应用通知（微信/QQ/短信/系统提醒…）入环形缓冲，
 *   插件 getRecentNotifications 读取（Agent 工具 getRecentNotifications 的数据源）。
 *   权限：系统设置「通知使用权」授权一次终身有效（与旧通道同等地位，且无需 shell）。
 *
 * 数据出口：静态 volatile 快照 + 静态环形缓冲（插件轮询读取，网页端零改动兼容）。
 */
public class MediaListenerService extends NotificationListenerService {

    /** 已连接的服务实例（插件检测连接状态用） */
    public static volatile MediaListenerService instance;

    /** 最近一次媒体信息快照 */
    private static volatile Info latestInfo;

    // ================= v2.0.0 最近通知环形缓冲 =================

    /** 通知记录（pkg/标题/正文/时间；供 getRecentNotifications 工具读取） */
    public static class NotificationRec {
        public final long ts;
        public final String pkg;
        public final String title;
        public final String text;

        NotificationRec(long ts, String pkg, String title, String text) {
            this.ts = ts;
            this.pkg = pkg;
            this.title = title;
            this.text = text;
        }
    }

    /** 环形缓冲（最新在尾；容量 60，同步保护） */
    private static final ArrayDeque<NotificationRec> RING = new ArrayDeque<>();
    private static final int RING_MAX = 60;

    /** 最近 limit 条通知（旧→新；不足则全返；不消耗缓冲） */
    public static List<NotificationRec> recentNotifications(int limit) {
        synchronized (RING) {
            int n = Math.min(limit <= 0 ? 20 : limit, RING.size());
            List<NotificationRec> out = new ArrayList<>(n);
            int skip = RING.size() - n;
            int i = 0;
            for (NotificationRec r : RING) {
                if (i++ < skip) continue;
                out.add(r);
            }
            return out;
        }
    }

    /** 通知入缓冲：跳过本应用/无内容；字段截断；同 pkg+标题+正文 8s 内去重 */
    private void recordNotification(StatusBarNotification sbn) {
        try {
            String pkg = sbn.getPackageName();
            if (pkg == null || pkg.isEmpty() || pkg.equals(getApplicationContext().getPackageName())) return;
            Notification n = sbn.getNotification();
            if (n == null || n.extras == null) return;
            CharSequence titleCs = n.extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence textCs = n.extras.getCharSequence(Notification.EXTRA_TEXT);
            String title = titleCs == null ? "" : titleCs.toString().trim();
            String text = textCs == null ? "" : textCs.toString().trim();
            if (title.isEmpty() && text.isEmpty()) return;
            if (title.length() > 80) title = title.substring(0, 80);
            if (text.length() > 200) text = text.substring(0, 200);
            long ts = sbn.getPostTime() > 0 ? sbn.getPostTime() : System.currentTimeMillis();
            synchronized (RING) {
                NotificationRec last = RING.peekLast();
                if (last != null && last.pkg.equals(pkg) && last.title.equals(title)
                        && last.text.equals(text) && ts - last.ts < 8000L) {
                    return; // 同一条刷新（进度条等）：去重
                }
                RING.addLast(new NotificationRec(ts, pkg, title, text));
                while (RING.size() > RING_MAX) RING.removeFirst();
            }
        } catch (Throwable ignored) {
            // 通知记录绝不 crash 服务
        }
    }

    private MediaController controller;
    private String controllerPkg;
    private MediaController.Callback controllerCallback;
    private final Handler handler = new Handler(Looper.getMainLooper());

    /** 媒体信息（pkg/歌名/歌手/专辑/播放状态） */
    public static class Info {
        public final String pkg;
        public final String title;
        public final String artist;
        public final String album;
        public final String state; // playing / paused
        public final long updatedAt;

        Info(String pkg, String title, String artist, String album, String state) {
            this.pkg = pkg;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.state = state;
            this.updatedAt = System.currentTimeMillis();
        }
    }

    public static Info latest() {
        return latestInfo;
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        instance = this;
        // 连接即扫描当前活跃通知（刚授权/重启后立刻有数据，无需等下一次切歌）
        try {
            for (StatusBarNotification sbn : getActiveNotifications()) {
                handleMediaNotification(sbn);
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onListenerDisconnected() {
        instance = null;
        releaseController();
        super.onListenerDisconnected();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        recordNotification(sbn); // v2.0.0 通知环形缓冲
        handleMediaNotification(sbn);
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // 通知被划走：缓冲保留（「最近通知」语义不变）
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        releaseController();
        super.onDestroy();
    }

    /** 媒体通知处理：带媒体会话 Token 的通知 → 绑定 MediaController 读元数据 */
    private void handleMediaNotification(StatusBarNotification sbn) {
        try {
            Notification n = sbn.getNotification();
            if (n == null) return;
            Bundle extras = n.extras;
            if (extras == null) return;

            Parcelable tokenP = extras.getParcelable(Notification.EXTRA_MEDIA_SESSION);
            if (tokenP instanceof MediaSession.Token) {
                attachController(sbn.getPackageName(), (MediaSession.Token) tokenP);
            }
            // 无 Token 的普通通知（聊天/系统）忽略：不做标题猜测，避免误报
        } catch (Throwable ignored) {
        }
    }

    /** 绑定/切换媒体会话控制器（新的音乐 App 开始播放时自动切换过去） */
    private void attachController(String pkg, MediaSession.Token token) {
        if (pkg == null) return;
        // 同一会话重复通知（进度条刷新等）：不重建，只刷新快照
        if (controller != null && pkg.equals(controllerPkg)) {
            publish();
            return;
        }
        releaseController();
        try {
            controller = new MediaController(getApplicationContext(), token);
            controllerPkg = pkg;
            controllerCallback = new MediaController.Callback() {
                @Override
                public void onMetadataChanged(MediaMetadata metadata) {
                    publish();
                }

                @Override
                public void onPlaybackStateChanged(PlaybackState state) {
                    publish();
                }
            };
            controller.registerCallback(controllerCallback, handler);
            publish();
        } catch (Throwable ignored) {
            controller = null;
            controllerPkg = null;
        }
    }

    /** 从当前控制器读取元数据 → 更新静态快照 */
    private void publish() {
        try {
            if (controller == null) return;
            MediaMetadata md = controller.getMetadata();
            PlaybackState ps = controller.getPlaybackState();
            String title = md != null ? md.getString(MediaMetadata.METADATA_KEY_TITLE) : null;
            String artist = md != null ? md.getString(MediaMetadata.METADATA_KEY_ARTIST) : null;
            String album = md != null ? md.getString(MediaMetadata.METADATA_KEY_ALBUM) : null;
            boolean playing = ps != null && ps.getState() == PlaybackState.STATE_PLAYING;

            // 空元数据不覆盖已有好数据（个别 App 先发空会话再补元数据）
            if ((title == null || title.isEmpty())
                    && latestInfo != null && controllerPkg != null
                    && controllerPkg.equals(latestInfo.pkg) && latestInfo.title != null) {
                // 同 App：只更新播放状态
                latestInfo = new Info(latestInfo.pkg, latestInfo.title, latestInfo.artist,
                        latestInfo.album, playing ? "playing" : "paused");
                return;
            }
            if ((title == null || title.isEmpty()) && !playing) return; // 无内容且未播放：跳过

            latestInfo = new Info(controllerPkg,
                    title == null ? "" : title,
                    artist == null ? "" : artist,
                    album == null ? "" : album,
                    playing ? "playing" : "paused");
        } catch (Throwable ignored) {
        }
    }

    private void releaseController() {
        if (controller != null && controllerCallback != null) {
            try {
                controller.unregisterCallback(controllerCallback);
            } catch (Throwable ignored) {
            }
        }
        controller = null;
        controllerCallback = null;
        controllerPkg = null;
    }
}
