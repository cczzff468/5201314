package com.z.aiphone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * v2.4.27（第四十六轮·后台通知根修）：APK 原生后台消息轮询器。
 *
 * 【背景】WebView 退后台 JS 被冻结——bg-relay-watcher/灵动岛横幅/系统通知全部
 * 只在用户点回 APP 后才跑，机主反馈「APP 系统通知和悬浮通知要点进去才出现」。
 * 服务端接力（/api/chat/bg）把回复生成进 pending 队列后，只有回前台才被拉取。
 *
 * 【方案】零配置零付费：原生侧起一条 10s 轮询线程，直接 GET 服务端的
 * pollNative 视图（每会话返回逐条消息 + 与网页守望者同构的 batchKey 去重键）：
 * - App 在后台（MainActivity.isAppInForeground()==false）且有【新消息 id】时，
 *   每条消息弹一条 heads-up 通知（IMPORTANCE_HIGH 渠道 + CATEGORY_MESSAGE +
 *   点击直达对应聊天）——「AI 发几条消息就弹几次悬浮通知」；
 * - 通知 id 用稳定消息 id（tag=bgm-<id>）：通知栏逐条独立堆叠、互不覆盖，
 *   重复轮询也不会重复弹（SharedPreferences 去重集合，重启也不丢）；
 * - App 在前台时只把当前 pending id 记为「已见」不弹（前台由网页 JS 弹，
 *   防止同一批消息双弹）；退后台瞬间的边界轮询同样只标记不弹（那批消息
 *   网页在前台时已经看到过横幅）；
 * - 已弹过通知的 batchKey 存入待认领队列：网页回前台加载时经
 *   AIPhoneNative.consumeBgNotified() 取走并入自己的 seen 集合 + 横幅抑制
 *   （聊天页正式投递同一批时不再弹第二轮）——两端去重口径完全一致。
 *
 * 【生命周期】轮询线程挂在进程上（静态单例）：
 * - 网页启动时 AIPhoneNative.setBgNotifyConfig({url, enabled, dnd}) 下发配置并拉起；
 * - KeepAliveService.onCreate（开机自启/常驻守护场景）按持久化配置拉起；
 * - 退进程即停（进程被系统冻结/回收后无通知——全天候后台通知需要
 *   「设置 › 权限给予 › 常驻守护」开启 KeepAliveService 保进程）。
 *
 * 【通知开关口径】与网页一致：设置里关了「允许通知」（enabled=false）或开了
 * 免打扰（dnd=true）→ 原生侧跳过弹通知，只静默记录已见 id。配置每次
 * peek 周期/回前台由网页重推（见 bg-relay-watcher.pushNativePollConfig）。
 */
public final class BgNotifyPoller {

    private static final String PREFS = "bg_notify";
    private static final String KEY_URL = "url";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_DND = "dnd";
    /** 已弹过/已见过的消息 id 集合（稳定 id：服务端 `${itemId}#${i}`） */
    private static final String KEY_SEEN_IDS = "seen_ids";
    /** 已弹过通知的 batchKey 待认领队列（网页 consumeBgNotified 取走并清空） */
    private static final String KEY_PENDING_BATCH_KEYS = "pending_batch_keys";

    private static final int POLL_INTERVAL_MS = 10_000;
    /** 相邻两条 heads-up 的最小间隔（与网页端 NOTIFY_SPACING_MS 对齐，横幅逐条可见） */
    private static final int POST_SPACING_MS = 2400;
    private static final int HTTP_TIMEOUT_MS = 10_000;
    /** 已见 id 集合上限（超出整组淘汰，防 SharedPreferences 无限膨胀） */
    private static final int SEEN_IDS_MAX = 400;
    /** 待认领 batchKey 上限 */
    private static final int PENDING_KEYS_MAX = 40;

    /** 与 NativePerceptionPlugin 共用的渠道 id（同名同配，幂等创建） */
    private static final String HIGH_CHANNEL = "local_notify_high";

    private static volatile Thread worker = null;
    private static volatile boolean running = false;
    private static final Object START_LOCK = new Object();

    private BgNotifyPoller() {
    }

    // ================= 配置入口（网页桥 / KeepAliveService） =================

    /**
     * 网页桥 AIPhoneNative.setBgNotifyConfig(json) 入口。
     * json: { url: "https://xxx"（服务器 origin，轮询 base）, enabled: bool, dnd: bool }
     * enabled=true 且 url 合法 → 拉起轮询线程；enabled=false → 停止并清空配置。
     */
    public static void setConfig(Context ctx, String json) {
        try {
            Context app = ctx.getApplicationContext();
            cacheContext(app);
            SharedPreferences sp = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONObject o = new JSONObject(json == null ? "{}" : json);
            String url = o.optString("url", "");
            boolean enabled = o.optBoolean("enabled", false);
            boolean dnd = o.optBoolean("dnd", false);
            // URL 规范：去尾部斜杠；非 http(s) 一律视为无效（清空）
            String norm = normalizeUrl(url);
            sp.edit()
                    .putString(KEY_URL, norm)
                    .putBoolean(KEY_ENABLED, enabled && norm != null)
                    .putBoolean(KEY_DND, dnd)
                    .apply();
            if (enabled && norm != null) {
                ensureStarted(app);
            } else if (!enabled) {
                stop();
            }
        } catch (Throwable ignored) {
            // 配置异常静默（坏 JSON 不影响既有轮询）
        }
    }

    /** URL 规范化：http/https 开头、去尾部斜杠；无效返回 null */
    private static String normalizeUrl(String raw) {
        if (raw == null) return null;
        String u = raw.trim();
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        if (!u.startsWith("http://") && !u.startsWith("https://")) return null;
        if (u.length() < 12) return null;
        return u;
    }

    /** 按 SharedPreferences 持久化配置拉起（KeepAliveService.onCreate / BootReceiver 后） */
    public static void ensureStartedFromPrefs(Context ctx) {
        try {
            Context app = ctx.getApplicationContext();
            cacheContext(app);
            SharedPreferences sp = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!sp.getBoolean(KEY_ENABLED, false)) return;
            String url = sp.getString(KEY_URL, null);
            if (normalizeUrl(url) == null) return;
            ensureStarted(app);
        } catch (Throwable ignored) {
        }
    }

    private static void ensureStarted(Context appCtx) {
        synchronized (START_LOCK) {
            if (running) return;
            running = true;
            final Context ctx = appCtx;
            worker = new Thread(() -> loop(ctx), "bg-notify-poller");
            worker.setDaemon(true);
            worker.start();
        }
    }

    private static void stop() {
        synchronized (START_LOCK) {
            running = false;
            worker = null; // 循环按 running 旗标自然退出（线程自灭，不 interrupt）
        }
    }

    /** 当前轮询线程是否在跑（诊断/网页状态展示用） */
    public static boolean isRunning() {
        return running;
    }

    // ================= 网页桥：待认领 batchKey =================

    /**
     * 网页桥 AIPhoneNative.consumeBgNotified() 入口：返回
     * { batchKeys: [...] }（原生已弹过通知的批次键）并清空待认领队列。
     * 网页把它们并入 bg-relay-watcher 的 seen 集合 + 会话横幅抑制，防双弹。
     */
    public static String consumeNotifiedBatches(Context ctx) {
        try {
            if (ctx != null) cacheContext(ctx.getApplicationContext());
            SharedPreferences sp = appPrefs != null
                    ? appPrefs
                    : ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String raw = sp.getString(KEY_PENDING_BATCH_KEYS, "[]");
            sp.edit().remove(KEY_PENDING_BATCH_KEYS).apply();
            JSONObject out = new JSONObject();
            JSONArray arr;
            try {
                arr = new JSONArray(raw);
            } catch (Throwable t) {
                arr = new JSONArray();
            }
            out.put("batchKeys", arr);
            return out.toString();
        } catch (Throwable t) {
            return "{\"batchKeys\":[]}";
        }
    }

    // ================= 生命周期（MainActivity 回调） =================

    /**
     * MainActivity.onStop 调用：App 退后台。
     * 立即做一次【边界轮询】——把当前 pending 的消息 id 全部记为「已见」但【不弹】
     * （这些消息网页在前台时已经看到/弹过横幅），之后轮询发现的新 id 才是
     * 「后台期间到达的新消息」→ 弹 heads-up。
     */
    public static void onAppBackgrounded(Context ctx) {
        // 轮询线程在跑才需要边界标记；线程没跑（未配置）零动作
        if (!running) return;
        if (ctx != null) cacheContext(ctx.getApplicationContext());
        final Thread self = worker;
        if (self == null) return;
        // 直接在独立一次性线程里跑（不干扰主轮循环节奏）
        new Thread(() -> {
            try {
                pollOnce(true);
            } catch (Throwable ignored) {
            }
        }, "bg-notify-boundary").start();
    }

    /** MainActivity.onStart 调用：App 回前台（轮询继续静默记录，弹通知交给网页 JS） */
    public static void onAppForegrounded() {
        // 无需动作：loop 内每次 poll 都检查 isAppInForeground() 决定弹/不弹
    }

    // ================= 轮询主循环 =================

    private static void loop(Context ctx) {
        while (running) {
            try {
                pollOnce(false);
            } catch (Throwable ignored) {
                // 网络异常等静默：下一轮重试（消息本体在服务端队列，不丢）
            }
            try {
                Thread.sleep(POLL_INTERVAL_MS);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    /**
     * 单轮轮询：GET {url}/api/chat/bg?pollNative=1。
     *
     * @param markOnly true = 边界轮询（只把当前消息 id 记为已见，不弹通知）；
     *                 false = 常规轮询（App 后台时对未见 id 逐条弹 heads-up）。
     */
    private static void pollOnce(boolean markOnly) {
        SharedPreferences sp = appPrefs;
        if (sp == null) return;
        String base = sp.getString(KEY_URL, null);
        if (normalizeUrl(base) == null) return;
        boolean dnd = sp.getBoolean(KEY_DND, false);
        String body = httpGet(base + "/api/chat/bg?pollNative=1");
        if (body == null || body.isEmpty()) return;
        JSONObject root;
        try {
            root = new JSONObject(body);
        } catch (Throwable t) {
            return; // 非 JSON 响应（代理报错页等）：静默跳过本轮
        }
        JSONObject sessions = root.optJSONObject("sessions");
        if (sessions == null) return;

        boolean inForeground = MainActivity.isAppInForeground();
        // markOnly 或前台或总闸关闭 → 只标记不弹
        boolean postAllowed = !markOnly && !inForeground && sp.getBoolean(KEY_ENABLED, false) && !dnd;

        java.util.Set<String> seen = new java.util.HashSet<>(loadSeenIds(sp));
        java.util.List<NotificationJob> jobs = new java.util.ArrayList<>();
        java.util.List<String> newBatchKeys = new java.util.ArrayList<>();

        java.util.Iterator<String> it = sessions.keys();
        while (it.hasNext()) {
            String key = it.next();
            JSONObject sess = sessions.optJSONObject(key);
            if (sess == null) continue;
            String title = sess.optString("title", "");
            if (title == null || title.isEmpty()) title = "新消息";
            String target = null;
            JSONObject t = sess.optJSONObject("target");
            if (t != null) target = t.toString();
            JSONArray msgs = sess.optJSONArray("messages");
            if (msgs == null) continue;
            boolean anyNew = false;
            for (int i = 0; i < msgs.length(); i++) {
                JSONObject m = msgs.optJSONObject(i);
                if (m == null) continue;
                String id = m.optString("id", "");
                String text = m.optString("text", "");
                if (id == null || id.isEmpty()) continue;
                if (seen.contains(id)) continue; // 已弹过/已见过：去重
                seen.add(id);
                anyNew = true;
                if (postAllowed) {
                    jobs.add(new NotificationJob("bgm-" + id, title, text, target));
                }
            }
            if (anyNew) {
                String bk = sess.optString("batchKey", "");
                if (bk != null && !bk.isEmpty()) newBatchKeys.add(bk);
            }
        }

        if (seen.size() > 0 || newBatchKeys.size() > 0) {
            saveSeenIds(sp, seen);
        }
        if (newBatchKeys.size() > 0) {
            appendPendingBatchKeys(sp, newBatchKeys);
        }

        // 逐条弹（间隔与网页端对齐：每条横幅都有独立弹出+停留时间）
        Context ctx = appContext;
        for (NotificationJob job : jobs) {
            try {
                postHeadsUp(ctx, job.tag, job.title, job.body, "/", job.target);
            } catch (Throwable ignored) {
                // 单条失败不影响后续
            }
            try {
                Thread.sleep(POST_SPACING_MS);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    /** 单条待发通知 */
    private static final class NotificationJob {
        final String tag;
        final String title;
        final String body;
        final String target;

        NotificationJob(String tag, String title, String body, String target) {
            this.tag = tag;
            this.title = title;
            this.body = body;
            this.target = target;
        }
    }

    // ================= HTTP =================

    private static String httpGet(String urlStr) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(HTTP_TIMEOUT_MS);
            conn.setReadTimeout(HTTP_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(true);
            int code = conn.getResponseCode();
            if (code != 200) return null;
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            while ((n = reader.read(buf)) > 0) sb.append(buf, 0, n);
            reader.close();
            return sb.toString();
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

    // ================= 通知下发（与 NativePerceptionPlugin.localNotify 同款） =================

    /**
     * 弹一条 heads-up 消息通知（IMPORTANCE_HIGH 渠道 + 消息类目 + 点击直达）。
     * 点击 → MainActivity（携带 local_notify_url/local_notify_target extras，
     * 走 NativePerceptionPlugin 既有的 handleOnNewIntent → 'local-notify-open'
     * 网页导航链路，直达对应聊天界面）。
     */
    private static void postHeadsUp(Context ctx, String tag, String title, String body,
            String url, String targetJson) {
        if (ctx == null) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            return; // 未授权：静默跳过（不弹也不报错）
        }
        if (!nm.areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel high = new NotificationChannel(
                    HIGH_CHANNEL, "AI 消息（逐条横幅）", NotificationManager.IMPORTANCE_HIGH);
            high.setDescription("AI 每条消息一条独立横幅通知（不合并）；点击直达对应聊天");
            high.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            high.enableVibration(true);
            high.setVibrationPattern(new long[]{0, 180, 90, 180});
            high.enableLights(true);
            high.setLightColor(0xFF0A84FF);
            try {
                high.setSound(
                        android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
                        new android.media.AudioAttributes.Builder()
                                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build());
            } catch (Throwable ignored) {
            }
            nm.createNotificationChannel(high);
        }
        Intent contentIntent = new Intent(ctx, MainActivity.class);
        contentIntent.setPackage(ctx.getPackageName());
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        boolean hasDest = (url != null && !url.isEmpty()) || (targetJson != null && !targetJson.isEmpty());
        if (url != null && !url.isEmpty()) contentIntent.putExtra("local_notify_url", url);
        if (targetJson != null && !targetJson.isEmpty()) contentIntent.putExtra("local_notify_target", targetJson);
        int id = tag.hashCode();
        PendingIntent contentPi = PendingIntent.getActivity(ctx, id, contentIntent,
                hasDest
                        ? (PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
                        : PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, HIGH_CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title == null || title.isEmpty() ? "新消息" : title)
                .setAutoCancel(true)
                .setContentIntent(contentPi)
                // heads-up 三件套：高优先级 + 消息类目（部分 ROM 需全配才弹横幅）
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE);
        if (body != null && !body.isEmpty()) builder.setContentText(body);
        nm.notify(tag, id, builder.build());
    }

    // ================= SharedPreferences 读写 =================

    // 进程级上下文（首次 setConfig / ensureStarted 时缓存；冷启动 BootReceiver
    // 场景由 KeepAliveService 传入 application context）
    private static volatile Context appContext;
    private static volatile SharedPreferences appPrefs;

    private static void cacheContext(Context appCtx) {
        if (appCtx == null) return;
        appContext = appCtx;
        appPrefs = appCtx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static java.util.Set<String> loadSeenIds(SharedPreferences sp) {
        try {
            return sp.getStringSet(KEY_SEEN_IDS, new java.util.HashSet<>());
        } catch (Throwable t) {
            return new java.util.HashSet<>();
        }
    }

    private static void saveSeenIds(SharedPreferences sp, java.util.Set<String> seen) {
        try {
            java.util.Set<String> out = seen;
            if (out.size() > SEEN_IDS_MAX) {
                // 无序淘汰：StringSet 保不了顺序，超限整组重建太重——直接取任意
                // SEEN_IDS_MAX 个（去重语义仍在：同一 id 永不二弹；极端超限后旧 id
                // 可能复活弹一次，可接受）
                java.util.HashSet<String> trimmed = new java.util.HashSet<>();
                java.util.Iterator<String> i = out.iterator();
                while (i.hasNext() && trimmed.size() < SEEN_IDS_MAX) trimmed.add(i.next());
                out = trimmed;
            }
            sp.edit().putStringSet(KEY_SEEN_IDS, out).apply();
        } catch (Throwable ignored) {
        }
    }

    private static void appendPendingBatchKeys(SharedPreferences sp, java.util.List<String> keys) {
        try {
            JSONArray arr;
            try {
                arr = new JSONArray(sp.getString(KEY_PENDING_BATCH_KEYS, "[]"));
            } catch (Throwable t) {
                arr = new JSONArray();
            }
            for (String k : keys) arr.put(k);
            while (arr.length() > PENDING_KEYS_MAX) arr.remove(0);
            sp.edit().putString(KEY_PENDING_BATCH_KEYS, arr.toString()).apply();
        } catch (Throwable ignored) {
        }
    }
}
