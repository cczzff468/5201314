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

/**
 * 媒体感知服务（正在听什么歌）：
 *
 * 标准做法 —— NotificationListenerService 监听全系统通知，凡带媒体会话
 * Token 的通知（网易云 / QQ音乐 / Spotify / 系统播放器等音乐 App 播放时都会发）
 * 即创建 MediaController 读取媒体元数据：歌名 / 歌手 / 专辑 / 播放状态。
 *
 * 权限：系统设置「通知使用权」授权一次终身有效（与「有权查看使用情况」同等地位，
 * 由 NativePerceptionPlugin.openMediaPermissionSettings 引导开启）。
 *
 * 数据出口：静态 volatile latest 快照（插件轮询读取，网页端零改动兼容）。
 */
public class MediaListenerService extends NotificationListenerService {

    /** 已连接的服务实例（插件检测连接状态用） */
    public static volatile MediaListenerService instance;

    /** 最近一次媒体信息快照 */
    private static volatile Info latestInfo;

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
        handleMediaNotification(sbn);
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
