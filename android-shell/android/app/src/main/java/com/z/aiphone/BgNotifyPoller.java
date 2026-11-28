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

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * v2.4.28（第四十七轮·后台通知双根修）：APK 原生后台消息轮询器。
 *
 * 【背景】WebView 退后台 JS 可能被冻结——bg-relay-watcher/灵动岛横幅/系统通知
 * 只在用户点回 APP 后才跑，机主反馈「APP 系统通知和悬浮通知要点进去才出现」。
 * 服务端接力（/api/chat/bg）把回复生成进 pending 队列后，只有回前台才被拉取。
 *
 * 【方案】零配置零付费：原生侧起一条轮询线程，直接 GET 服务端的 pollNative
 * 视图（每会话返回逐条消息 + 与网页守望者同构的 batchKey 去重键）：
 * - App 在后台（MainActivity.isAppInForeground()==false）且有【新消息 id】时，
 *   每条消息弹一条 heads-up 通知（IMPORTANCE_HIGH 渠道 + CATEGORY_MESSAGE +
 *   点击直达对应聊天）——「AI 发几条消息就弹几次悬浮通知」；
 * - 通知 id 用稳定消息 id（tag=bgm-<id>）：通知栏逐条独立堆叠、互不覆盖，
 *   重复轮询也不会重复弹（SharedPreferences 去重集合，重启也不丢）；
 * - App 在前台时只把当前 pending id 记为「已见」不弹（前台由网页 JS 弹，
 *   防止同一批消息双弹）；
 * - 已弹过/已见过的 batchKey 存入待认领队列：网页回前台加载时经
 *   AIPhoneNative.consumeBgNotified() 取走并入自己的 seen 集合 + 横幅抑制
 *   （聊天页正式投递同一批时不再弹第二轮）——两端去重口径完全一致。
 *
 * 【v2.4.28 两处根修（机主反馈「AI 发来消息不通知，点进 APP 才通知」）】
 * ① 边界竞态根修：旧版退后台瞬间的「边界轮询」把当时 pending 里的消息全部标记
 *   已见不弹——而网页在 visibilitychange→hidden 发出的 deliver 接力 beacon 可能在
 *   边界轮询 GET 之前就已入队（sendBeacon 与边界 GET 同时在途）→ 刚入队的【新】
 *   消息被当成「前台已看过」静默吞掉，永不弹通知（点回 APP 才看到）。
 *   现服务端每条消息带 createdAt（入队时刻）：边界轮询只静默标记「退后台 800ms
 *   之前就在队列里的旧存货」（网页前台时确实已弹过横幅）；createdAt 落在
 *   退后台前后窗口内的新消息 → 照常弹 heads-up（App 此刻已退后台）。
 * ② 立即生效根修（自适应节奏 + 唤醒）：
 *   - 轮询间隔自适应：退后台 75s 内（生成窗口）+ 每次弹到新消息后 45s 内 = 4s
 *     快节奏；后台空闲 15s；前台 30s（前台通知由网页负责，原生只维持 seen 去重）；
 *   - onAppBackgrounded 即刻唤醒轮询线程（wait/notify，不再傻等上一个整周期）；
 *   - 新桥 AIPhoneNative.pokeBgNotify()：网页在后台收到 SSE bg-pending 广播时
 *     （WebView JS 还活着、但通知已让位原生防双弹）叫醒原生立即拉一轮——毫秒级。
 *
 * 【v2.4.29（第四十八轮）·通知排版与图标重做】
 * 机主反馈：AI 连发多条时通知把全部文本揉成一大段（无缝拼接）；左侧图标是系统默认
 * 蓝图标的默认蓝色图标（带 X 观感）。
 * ① 合并排版：同一会话同一轮轮询的新消息合并为【一条】通知——
 *    · 1 条：标题 = 角色名，正文 = 那一条消息（超长省略号）；
 *    · N>1 条：标题 = 「角色名：发来了 N 条新消息」，正文预览最新一条；
 *    · NotificationCompat.BigTextStyle：下拉展开可见完整最新一条消息（多行）；
 *    · 服务端 pollNative 的 messages 已按 &&& + 换行拆好（splitSingleReply，见
 *      /api/chat/bg）——本侧拿到就是逐条文本，不再出现拼接大段落；
 *    · tag = bgm-<sessionKey>：同会话后续批次原地更新同一条通知（微信式单条堆叠）。
 * ② 头像图标：pollNative 每会话携带 avatar（压缩 dataURL）→ NotifyAvatars 解码 →
 *    setLargeIcon（通知栏显示角色真实头像）；小图标 = 本 App 自有 ic_stat_cove
 *    （单色气泡，替换 android.R.drawable.ic_dialog_info 默认蓝图标）。
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
    /** v2.4.32 已弹过通知的【消息 id】待认领队列（增量入队后 batchKey 随 count 变化，
     *  网页守望者改按消息 id 去重——原生弹过的消息 id 透传给网页防双弹） */
    private static final String KEY_PENDING_MSG_IDS = "pending_msg_ids";

    /** 后台空闲节奏（v2.4.28：10s → 15s——后台通知由快节奏窗口优先覆盖） */
    private static final int POLL_IDLE_MS = 15_000;
    /** 快节奏（退后台生成窗口 / 弹到新消息后）：机主要求「AI 发来消息立马生效」 */
    private static final int POLL_FAST_MS = 4_000;
    /** 前台节奏：前台通知由网页负责，原生只维持 seen 去重，放慢省流量 */
    private static final int POLL_FG_MS = 30_000;
    /** 退后台后的快节奏窗口（服务端生成一般 2~15s，多轮消息排队再放宽） */
    private static final long FAST_AFTER_BG_MS = 75_000;
    /** 每次发现新消息后的快节奏窗口（连发多条的批次接着来） */
    private static final long FAST_AFTER_HIT_MS = 45_000;
    /** 相邻两条 heads-up 的最小间隔（v2.4.30：一消息一弹窗——间隔收紧让连发批次
     *  尽快逐条堆进通知栏；同会话也不合并，每条独立 (tag,id) 互不覆盖） */
    private static final int POST_SPACING_MS = 900;
    private static final int HTTP_TIMEOUT_MS = 10_000;
    /** 已见 id 集合上限（超出整组淘汰，防 SharedPreferences 无限膨胀） */
    private static final int SEEN_IDS_MAX = 400;
    /** 待认领 batchKey 上限 */
    private static final int PENDING_KEYS_MAX = 40;
    /** 待认领消息 id 上限（v2.4.32：一消息一弹窗后每批可到多条，放宽到 120） */
    private static final int PENDING_MSG_IDS_MAX = 120;
    /** 边界判定容差：createdAt ≥ 退后台时刻-800ms 视为「新消息」（deliver beacon 竞态窗口） */
    private static final long BOUNDARY_MARGIN_MS = 800;

    /**
     * v2.4.30（第四十九轮·一消息一弹窗）：三条 IMPORTANCE_HIGH 渠道轮询使用。
     * 机主规格：部分 ROM（MIUI/ColorOS 等）会对【同渠道】连发的高优通知做折叠/
     * 合并显示——每条通知轮询走不同渠道 id（ch_1 → ch_2 → ch_3 → ch_1 …），
     * 从渠道层面杜绝系统折叠，保证「AI 发几条就弹几条」。
     * 三条渠道同名同配（IMPORTANCE_HIGH + 响铃 + 震动 + 亮屏），幂等创建。
     */
    private static final String[] HIGH_CHANNELS = {"local_notify_high", "cove_msg_ch_2", "cove_msg_ch_3"};
    /** 渠道轮询计数器（原子递增取模） */
    private static final java.util.concurrent.atomic.AtomicInteger CHANNEL_ROT =
            new java.util.concurrent.atomic.AtomicInteger(0);

    private static volatile Thread worker = null;
    private static volatile boolean running = false;
    private static final Object START_LOCK = new Object();

    /** 轮循环节奏锁：wait/notify 唤醒 + pollOnce 串行化（边界线程与主循环互斥防双弹） */
    private static final Object POLL_LOCK = new Object();
    /** 最近一次退后台时刻（0 = 从未退过）；边界轮询用它区分旧存货/新消息 */
    private static volatile long lastBackgroundAt = 0L;
    /** 快节奏截止时刻（退后台/弹到新消息/被 poke 时延长） */
    private static volatile long fastUntil = 0L;

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
        // 唤醒可能在 wait 的轮询线程，让它立刻看到 running=false 退出
        synchronized (POLL_LOCK) {
            POLL_LOCK.notifyAll();
        }
    }

    /** 当前轮询线程是否在跑（诊断/网页状态展示用） */
    public static boolean isRunning() {
        return running;
    }

    /**
     * v2.4.28 新桥 AIPhoneNative.pokeBgNotify() 入口：叫醒轮询线程立即拉一轮
     * （网页在后台收到 SSE bg-pending 广播时调用——WebView JS 还活着但通知已让位
     * 原生防双弹，这里把「立即」补上：毫秒级拉取 + 弹通知，不等下一个周期）。
     * 同时拉起（未跑时）+ 延长快节奏窗口。同步部分放独立线程：防轮询中（锁被占）
     * 阻塞 WebView 桥线程。
     */
    public static void poke() {
        try {
            SharedPreferences sp = appPrefs;
            if (sp == null || !sp.getBoolean(KEY_ENABLED, false)) return;
            Context ctx = appContext;
            if (ctx != null) ensureStarted(ctx);
            new Thread(() -> {
                try {
                    synchronized (POLL_LOCK) {
                        long now = System.currentTimeMillis();
                        if (now + FAST_AFTER_HIT_MS > fastUntil) fastUntil = now + FAST_AFTER_HIT_MS;
                        POLL_LOCK.notifyAll();
                    }
                } catch (Throwable ignored) {
                }
            }, "bg-notify-poke").start();
        } catch (Throwable ignored) {
        }
    }

    // ================= 网页桥：待认领 batchKey =================

    /**
     * 网页桥 AIPhoneNative.consumeBgNotified() 入口：返回
     * { batchKeys: [...], msgIds: [...] }（原生已弹过通知的批次键 + 消息 id）并清空
     * 待认领队列。网页把它们并入 bg-relay-watcher 的 seen 集合（batchKey）与消息 id
     * 去重集合（msgIds，v2.4.32 增量入队后按消息粒度防双弹）+ 会话横幅抑制。
     */
    public static String consumeNotifiedBatches(Context ctx) {
        try {
            if (ctx != null) cacheContext(ctx.getApplicationContext());
            SharedPreferences sp = appPrefs != null
                    ? appPrefs
                    : ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String rawKeys = sp.getString(KEY_PENDING_BATCH_KEYS, "[]");
            String rawIds = sp.getString(KEY_PENDING_MSG_IDS, "[]");
            sp.edit().remove(KEY_PENDING_BATCH_KEYS).remove(KEY_PENDING_MSG_IDS).apply();
            JSONObject out = new JSONObject();
            JSONArray arrKeys;
            try {
                arrKeys = new JSONArray(rawKeys);
            } catch (Throwable t) {
                arrKeys = new JSONArray();
            }
            JSONArray arrIds;
            try {
                arrIds = new JSONArray(rawIds);
            } catch (Throwable t) {
                arrIds = new JSONArray();
            }
            out.put("batchKeys", arrKeys);
            out.put("msgIds", arrIds);
            return out.toString();
        } catch (Throwable t) {
            return "{\"batchKeys\":[],\"msgIds\":[]}";
        }
    }

    // ================= 生命周期（MainActivity 回调） =================

    /**
     * MainActivity.onStop 调用：App 退后台（UI 线程——只做 volatile 写 + 拉起
     * 一次性线程，绝不阻塞主线程）。
     * ① 记录退后台时刻（边界轮询用它区分旧存货/新消息）；
     * ② 一次性线程跑【边界轮询】：把「退后台前就躺在队列里的旧存货」（createdAt
     *   早于退后台时刻-800ms，网页前台时已弹过横幅）记为已见不弹；退后台前后
     *   窗口内到达的【新】消息照常弹 heads-up（v2.4.28 边界竞态根修——旧版无脑
     *   全标记，deliver 接力 beacon 抢先入队的新消息被吞，永不弹通知）；
     * ③ 边界轮询完成后唤醒主循环进入快节奏（4s）。
     */
    public static void onAppBackgrounded(Context ctx) {
        // 轮询线程在跑才需要边界标记；线程没跑（未配置）零动作
        if (!running) return;
        if (ctx != null) cacheContext(ctx.getApplicationContext());
        if (worker == null) return;
        lastBackgroundAt = System.currentTimeMillis();
        new Thread(() -> {
            try {
                pollOnce(true);
            } catch (Throwable ignored) {
            } finally {
                synchronized (POLL_LOCK) {
                    long now = System.currentTimeMillis();
                    if (now + FAST_AFTER_BG_MS > fastUntil) fastUntil = now + FAST_AFTER_BG_MS;
                    POLL_LOCK.notifyAll(); // 主循环立刻进入快节奏
                }
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
            synchronized (POLL_LOCK) {
                long now = System.currentTimeMillis();
                long sleepMs = now < fastUntil
                        ? POLL_FAST_MS
                        : (MainActivity.isAppInForeground() ? POLL_FG_MS : POLL_IDLE_MS);
                try {
                    POLL_LOCK.wait(sleepMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                }
                if (!running) return;
            }
        }
    }

    /**
     * 单轮轮询：GET {url}/api/chat/bg?pollNative=1（POLL_LOCK 串行——边界线程与
     * 主循环互斥，防同一批消息双弹）。
     *
     * @param boundary true = 边界轮询（退后台瞬间）：旧存货只标记已见不弹；
     *                 退后台前后窗口内到达的新消息照常弹（竞态根修）。
     *                 false = 常规轮询：后台弹 / 前台只标记。
     */
    private static void pollOnce(boolean boundary) {
        // 预初始化（锁内早退路径直接返回空表——锁外发通知循环安全跳过）
        java.util.List<NotificationJob> jobs = new java.util.ArrayList<>();
        synchronized (POLL_LOCK) {
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
            // 总闸关闭/免打扰 → 只标记不弹（与网页口径一致）
            boolean canPost = sp.getBoolean(KEY_ENABLED, false) && !dnd;

            java.util.Set<String> seen = new java.util.HashSet<>(loadSeenIds(sp));
            jobs = new java.util.ArrayList<>();
            java.util.List<String> newBatchKeys = new java.util.ArrayList<>();
            // v2.4.32 真实弹出的消息 id（canPost 时才收——网页回前台按 id 防双弹）
            java.util.List<String> postedMsgIds = new java.util.ArrayList<>();
            boolean anyPosted = false;

            java.util.Iterator<String> it = sessions.keys();
            while (it.hasNext()) {
                String key = it.next();
                JSONObject sess = sessions.optJSONObject(key);
                if (sess == null) continue;
                String title = sess.optString("title", "");
                if (title == null || title.isEmpty()) title = "新消息";
                // v2.4.29：会话头像（压缩 dataURL）→ 通知大图标
                String avatar = sess.optString("avatar", "");
                String target = null;
                JSONObject t = sess.optJSONObject("target");
                if (t != null) target = t.toString();
                JSONArray msgs = sess.optJSONArray("messages");
                if (msgs == null) continue;
                boolean anyNew = false;
                // v2.4.30：一消息一弹窗——每条新消息各建一个 NotificationJob
                // （tag=bgm-<消息id>：唯一 (tag,id)，通知栏逐条独立堆叠互不覆盖）
                for (int i = 0; i < msgs.length(); i++) {
                    JSONObject m = msgs.optJSONObject(i);
                    if (m == null) continue;
                    String id = m.optString("id", "");
                    String text = m.optString("text", "");
                    long createdAt = m.optLong("createdAt", 0L);
                    if (id == null || id.isEmpty()) continue;
                    if (seen.contains(id)) continue; // 已弹过/已见过：去重
                    // 边界轮询的旧存货判定：退后台 margin 之前就躺在队列里
                    //（网页前台时已弹过横幅）→ 只标记已见不弹。
                    // v2.4.28：deliver 接力 beacon 抢先入队的新消息（createdAt 在
                    // 退后台前后窗口内）不再被吞——照常走弹通知分支。
                    boolean staleLeftover = boundary
                            && lastBackgroundAt > 0
                            && createdAt > 0
                            && createdAt < lastBackgroundAt - BOUNDARY_MARGIN_MS;
                    if (staleLeftover) {
                        seen.add(id);
                        anyNew = true;
                        continue;
                    }
                    if (inForeground && !boundary) {
                        // 前台常规轮询：只标记已见（通知由网页 JS 弹，防双弹）
                        seen.add(id);
                        anyNew = true;
                        continue;
                    }
                    // 后台（或边界轮询遇到新消息）：每条消息一个独立通知（v2.4.30）
                    seen.add(id);
                    anyNew = true;
                    anyPosted = true;
                    if (canPost && text != null && !text.isEmpty()) {
                        jobs.add(new NotificationJob("bgm-" + id, title, text, avatar, target));
                        postedMsgIds.add(id); // v2.4.32：真实入队的消息 id 透传网页防双弹
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
            // v2.4.32 已弹消息 id 待认领（网页守望者按消息粒度防双弹）
            if (postedMsgIds.size() > 0) {
                appendPendingMsgIds(sp, postedMsgIds);
            }
            // 弹到新消息 → 延长快节奏窗口（连发批次接着来）
            if (anyPosted) {
                long now = System.currentTimeMillis();
                if (now + FAST_AFTER_HIT_MS > fastUntil) fastUntil = now + FAST_AFTER_HIT_MS;
            }
        }
        // 逐会话弹（锁外——间隔的 sleep 链不阻塞主循环/poke；id 已在锁内标记
        // 去重，后续轮询不会重复弹同一批）
        Context ctx = appContext;
        for (NotificationJob job : jobs) {
            try {
                postHeadsUp(ctx, job, "/");
            } catch (Throwable ignored) {
                // 单会话失败不影响后续
            }
            try {
                Thread.sleep(POST_SPACING_MS);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    /** 单条消息待发通知（v2.4.30：一消息一弹窗——一条消息一条独立通知） */
    private static final class NotificationJob {
        /** 通知 tag（bgm-<消息id>：每条消息唯一，通知栏逐条独立堆叠绝不覆盖） */
        final String tag;
        /** 通知标题（会话角色名） */
        final String title;
        /** 本条消息文本（单条；超长省略号折叠，BigTextStyle 展开全文） */
        final String text;
        /** 机主所选 APP 图标（绝对 URL；空 = 回落会话头像） */
        final String appIcon;
        /** 会话头像（压缩 dataURL；空 = 不带大图标） */
        final String avatar;
        final String target;

        NotificationJob(String tag, String title, String text, String avatar, String target) {
            this.tag = tag;
            this.title = title;
            this.text = text;
            this.avatar = avatar;
            this.target = target;
            this.appIcon = null; // 由 postHeadsUp 内按 base 动态解析
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
     * 弹一条消息的 heads-up 通知（IMPORTANCE_HIGH 渠道 + 消息类目 + 点击直达）。
     * v2.4.30 排版（机主规格·一消息一弹窗，推翻 v2.4.29 合并口径）：
     * - 一条消息 = 一条独立通知：tag=bgm-<消息id>（唯一 (tag,id)，系统绝不合并/覆盖）；
     * - 标题 = 角色名，正文 = 该条消息（超长省略号折叠）；
     * - BigTextStyle 展开显示该条消息全文（多行）；
     * - 渠道轮询：三条 IMPORTANCE_HIGH 渠道（ch_1/2/3）逐条轮着用——部分 ROM 会折叠
     *   同渠道连发通知，轮询渠道从根上杜绝「发来了 N 条新消息」式合并；
     * - PRIORITY_HIGH + setDefaults(DEFAULT_ALL)（声音/震动/亮屏三件全开）；
     * - v2.4.33 图标方向根修（机主规格「左边图标变成我选择的图标，右面显示AI头像」）：
     *   小图标（通知卡左上）= 机主所选 APP 图标彩色位图（cove_prefs/icon_current →
     *   {base}/icons/app/icon-X-192.png 下载，Icon.createWithBitmap；失败回落 ic_stat_cove）；
     *   大图标（通知卡右侧）= 会话角色 AI 头像（job.avatar；缺失不带大图标）。
     *   （旧版 v2.4.30 方向反了：所选 APP 图标放大图标、头像只作回落——机主看到右侧
     *   是 Cove 图标而不是 TA 的头像，左侧则是 ROM 自行渲染的样式。）
     * 点击 → MainActivity（携带 local_notify_url/local_notify_target extras，
     * 走 NativePerceptionPlugin 既有的 handleOnNewIntent → 'local-notify-open'
     * 网页导航链路，直达对应聊天界面；点进 APP 聊天页即可看到完整消息）。
     */
    private static void postHeadsUp(Context ctx, NotificationJob job, String url) {
        if (ctx == null || job == null) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            return; // 未授权：静默跳过（不弹也不报错）
        }
        if (!nm.areNotificationsEnabled()) return;
        // v2.4.30 渠道轮询：三条高优渠道逐条轮着用（防 ROM 同渠道折叠）
        String channel = HIGH_CHANNELS[0];
        if (Build.VERSION.SDK_INT >= 26) {
            for (int ci = 0; ci < HIGH_CHANNELS.length; ci++) {
                NotificationChannel ch = new NotificationChannel(
                        HIGH_CHANNELS[ci],
                        ci == 0 ? "AI 消息（横幅通知）" : ("AI 消息（横幅通知 " + (ci + 1) + "）"),
                        NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("AI 消息横幅通知：一条消息弹一条独立通知（绝不合并）；点击直达对应聊天");
                ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
                ch.enableVibration(true);
                ch.setVibrationPattern(new long[]{0, 180, 90, 180});
                ch.enableLights(true);
                ch.setLightColor(0xFF0A84FF);
                try {
                    ch.setSound(
                            android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
                            new android.media.AudioAttributes.Builder()
                                    .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                    .build());
                } catch (Throwable ignored) {
                }
                nm.createNotificationChannel(ch);
            }
            channel = HIGH_CHANNELS[Math.abs(
                    CHANNEL_ROT.getAndIncrement() % HIGH_CHANNELS.length)];
        }
        Intent contentIntent = new Intent(ctx, MainActivity.class);
        contentIntent.setPackage(ctx.getPackageName());
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        boolean hasDest = (url != null && !url.isEmpty()) || (job.target != null && !job.target.isEmpty());
        if (url != null && !url.isEmpty()) contentIntent.putExtra("local_notify_url", url);
        if (job.target != null && !job.target.isEmpty()) contentIntent.putExtra("local_notify_target", job.target);
        int id = job.tag.hashCode();
        PendingIntent contentPi = PendingIntent.getActivity(ctx, id, contentIntent,
                hasDest
                        ? (PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
                        : PendingIntent.FLAG_IMMUTABLE);

        // ---- v2.4.33 一消息一弹窗排版（图标方向根修·NotifyAvatars 共用构建器） ----
        String title = job.title == null || job.title.isEmpty() ? "新消息" : job.title;
        String text = job.text != null ? job.text : "";
        // 小图标位图：机主所选 APP 图标（下载+LRU 缓存；缩到小图标友好尺寸）
        android.graphics.Bitmap smallBmp = null;
        try {
            String iconUrl = chosenAppIconUrl(ctx);
            if (iconUrl != null) {
                smallBmp = NotifyAvatars.asSmallIconBitmap(NotifyAvatars.decode(iconUrl));
            }
        } catch (Throwable ignored) {
        }
        // 大图标：会话角色 AI 头像（机主规格「右面显示 AI 头像」；缺失不带）
        android.graphics.Bitmap large = null;
        if (job.avatar != null && !job.avatar.isEmpty()) {
            try {
                large = NotifyAvatars.decode(job.avatar);
            } catch (Throwable ignored) {
            }
        }
        Notification n = NotifyAvatars.buildMessageNotification(
                ctx, channel, R.drawable.ic_stat_cove, smallBmp, large,
                title, text, contentPi, true);
        nm.notify(job.tag, id, n);
    }

    /**
     * v2.4.30：机主所选 APP 图标 URL（v2.4.33 起作通知【小】图标位图用）。
     * cove_prefs/icon_current（'1'~'5'，默认 '3'）→ {服务器base}/icons/app/icon-X-192.png。
     * base 取轮询配置里的服务器地址；无配置/异常返回 null（回落 ic_stat_cove 单色资源）。
     */
    private static String chosenAppIconUrl(Context ctx) {
        try {
            if (ctx == null) return null;
            SharedPreferences sp = appPrefs;
            if (sp == null) {
                sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            }
            String base = sp.getString(KEY_URL, null);
            if (base == null || base.isEmpty()) return null;
            SharedPreferences cp = ctx.getSharedPreferences("cove_prefs", Context.MODE_PRIVATE);
            String cur = cp.getString("icon_current", "3");
            if (cur == null || cur.isEmpty()) cur = "3";
            return base + "/icons/app/icon-" + cur + "-192.png";
        } catch (Throwable t) {
            return null;
        }
    }

    /** 超长截断加省略号（v2.4.33 起未用：正文省略由系统 BigTextStyle 自行处理；保留工具方法） */
    @SuppressWarnings("unused")
    private static String ellipsize(String s, int max) {
        if (s == null) return "";
        if (s.length() <= max) return s;
        return s.substring(0, max) + "…";
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

    /** v2.4.32 待认领消息 id 追加（原生已弹 heads-up 的消息：网页回前台后按 id 防双弹） */
    private static void appendPendingMsgIds(SharedPreferences sp, java.util.List<String> ids) {
        try {
            JSONArray arr;
            try {
                arr = new JSONArray(sp.getString(KEY_PENDING_MSG_IDS, "[]"));
            } catch (Throwable t) {
                arr = new JSONArray();
            }
            for (String k : ids) arr.put(k);
            while (arr.length() > PENDING_MSG_IDS_MAX) arr.remove(0);
            sp.edit().putString(KEY_PENDING_MSG_IDS, arr.toString()).apply();
        } catch (Throwable ignored) {
        }
    }
}
