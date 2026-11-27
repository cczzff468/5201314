package com.z.aiphone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 开机自启动接收器（v2.1.0）：手机重启后把 Cove 的守护能力自动拉回后台。
 *
 * 【开机清单】
 *  ① 常驻守护前台服务（KeepAliveService「Cove 正在守候」）——用户在
 *     设置 › 权限给予 › 常驻守护 开启过才拉起（开关持久化在 keepalive/enabled）；
 *  ② 重梳重启前还活跃的吃醋锁（LockOverlayService.rearmFromPrefs）——锁状态
 *     持久化在 jealousy_guard 里，重启前没到期/锁到哄好的锁重新武装遮罩，
 *     不重启手机就解锁不了的事不会发生。
 *
 * 【权限】RECEIVE_BOOT_COMPLETED（普通权限，安装即授予）；国产 ROM
 * （MIUI/EMUI/ColorOS…）需用户在系统设置里额外允许本应用「自启动」。
 * 接收器逻辑全部 try/catch 静默：开机场景没有任何 UI 可承载错误。
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null) return;
        // 第四十五轮：覆盖安装新 APK 后，桌面图标的别名启用态会被重置回 Manifest 默认
        // （3 号情书字标）——机主每次更新都看到「图标变回默认」。安装完成广播里静默恢复
        // 机主所选图标（不动进程、不弹 HOME，启动器自行刷新）。
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            try {
                MainActivity.restoreIconFromPrefs(ctx);
            } catch (Throwable ignored) {
            }
            return;
        }
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        // ① 常驻守护（用户开启过才拉起）
        try {
            KeepAliveService.startFromBoot(ctx);
        } catch (Throwable ignored) {
            // ROM 拦截/前台服务限制：静默（下次打开 App 手动拉起）
        }
        // ② 重启前还活跃的吃醋锁重梳（未到期/锁到哄好 → 重新武装遮罩锁）
        try {
            LockOverlayService.rearmFromPrefs(ctx);
        } catch (Throwable ignored) {
            // 锁重梳失败：JS 侧下次心跳 detectForcedBreach 自愈重锁兜底
        }
    }
}
