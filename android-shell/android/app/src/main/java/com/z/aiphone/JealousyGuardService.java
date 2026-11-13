package com.z.aiphone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import rikka.shizuku.Shizuku;

/**
 * 吃醋守护前台服务（v1.9.43）：真机模式「吃醋锁」的原生兜底调度器。
 *
 * 【为什么独立于 WebView】JS 侧 jealousy-lock.ts 在 WebView 活着时自己完成「锁到期
 * 解锁 + 强行解锁检测」；但安卓会把后台 WebView 冻结/回收（App Standby 节流、低内存
 * 杀进程），届时 JS 定时器全部停摆——锁会烂在系统里：应用一直被 pm suspend 挂起，
 * 到期解不开、被强解也无人知。本服务作为前台服务（specialUse 类型）不吃 WebView
 * 存活，独立完成：
 *   1) 锁到期自动解锁（pm unsuspend，30s 一轮的到期判定）；
 *   2) 强行解锁检测（dumpsys package 的 suspended 态，2 分钟节流）；
 *   3) 事件落盘（SharedPreferences 环形 50 条），等 JS 醒来（WebView 重启/回前台）
 *      经 jealousyGuardDrainEvents 一次取走。
 *
 * 【与 JS 侧 jealousy-lock.ts 的分工】建锁/续锁/哄好解锁都由 JS 发起（经插件
 * jealousyGuardSyncLock 把 pkg/unlockAt/charName 同步过来；unlockAt=0 表示「直到
 * 哄好」，原生不判到期只盯强解）；哄好后的解锁由 JS 自己执行 pm unsuspend 并传空
 * pkg 停掉本服务——本服务只兜底，不拥有锁的语义。JS 醒来后按落盘事件对账修正自身
 * 锁状态机（事件是线索不是指令）。
 *
 * 【事件协议】SharedPreferences("jealousy_guard") key "events"，环形上限 50 条（超限
 * 从头淘汰最旧），每条 {ts, type, pkg, text}：
 *   - native-unlock：锁到期，守护服务自动解开（JS 据此把锁状态机收尾）；
 *   - breach：锁仍活跃但已被强行打破（同时发高优通知「TA 已经知道了」）；
 *   - degrade：原生兜底失效线索（Shizuku 断连、到期解锁连续失败放弃等）。
 *
 * 【Shizuku 通道】复用 PerceptionShellService 的 AIDL execFiltered 执行 shell 命令，
 * 但绑定完全独立于 NativePerceptionPlugin（自建 UserServiceArgs + ServiceConnection：
 * processNameSuffix 独立 jealousy_guard，与插件侧 perception_shell 各持一条连接互不
 * 干扰；version 与插件侧保持一致 3——两侧任一侧改动 PerceptionShellService/AIDL
 * 都必须同步 bump）。白名单比插件更严格：只执行本服务自己拼好的两组命令
 * （pm unsuspend <pkg> / dumpsys package <pkg>），lockPkg 进命令前必须通过
 * ^[\w.]+$ 校验（syncLock 入口先验一道、组命令时再验一道）。
 *
 * 【极高容错】guardTick 全程 try-catch 绝不 crash；Shizuku 每步 API 逐个 try-catch
 * （binder 死了就降级记事件，绝不抛出）；通知渠道/图标/应用名解析全部 try-catch 兜底。
 */
public class JealousyGuardService extends Service {

    // ================= 常量 =================

    /** Intent extra：锁包名 / 到期时刻（epoch ms，0=直到哄好）/ 吃醋角色名 */
    private static final String EXTRA_PKG = "pkg";
    private static final String EXTRA_UNLOCK_AT = "unlockAt";
    private static final String EXTRA_CHAR_NAME = "charName";

    /** 事件落盘：SharedPreferences 文件名 / key / 环形上限（超限从最旧的头部淘汰） */
    private static final String PREFS_NAME = "jealousy_guard";
    private static final String EVENTS_KEY = "events";
    private static final int EVENT_RING_MAX = 50;

    /**
     * 常驻前台通知渠道（IMPORTANCE_LOW 静默）与 id；强解警报必须用独立渠道
     * （jealousy_guard_alert，IMPORTANCE_HIGH）+ 独立 id——同一渠道只能有一个重要级
     * （常驻必须静默、警报必须出声，二者不可同渠道），且 stopForeground(REMOVE) 按
     * id 撤销通知，警报若复用 7789 会被收尾的 stopForeground 一并撤掉。
     */
    private static final String CHANNEL_ID = "jealousy_guard";
    private static final int NOTIFY_ID = 7789;
    private static final String CHANNEL_ID_ALERT = "jealousy_guard_alert";
    private static final int BREACH_NOTIFY_ID = 7790;

    /** 守护节拍：首轮延迟（先跑一轮尽快进入判定节奏）/ 周期 30s */
    private static final long FIRST_TICK_DELAY_MS = 3000L;
    private static final long TICK_MS = 30_000L;

    /** 强解检测节流（距上次检测 ≥2 分钟；JS 心跳 re-sync 会重置节流窗——JS 活着时自己检测，原生让位避免双头报） */
    private static final long BREACH_CHECK_INTERVAL_MS = 2 * 60_000L;

    /** 到期解锁连续失败放弃轮数（每轮 30s，8 轮 ≈ 4 分钟重试预算；防死循环空转） */
    private static final int EXPIRY_GIVE_UP_ROUNDS = 8;

    /** Shizuku 断连 degrade 事件：从未成功过且连续失败 ≥4 轮首次落盘 / 此后重报间隔（tick 计，防刷屏） */
    private static final int DISCONNECT_DEGRADE_ROUNDS = 4;
    private static final int DISCONNECT_RELOG_TICKS = 30;

    /** Shizuku UserService 绑定等待上限 */
    private static final long BIND_WAIT_MS = 6000L;

    /** 守护命令的包名白名单（字母/数字/下划线/点；进命令前强校验） */
    private static final Pattern PKG_RX = Pattern.compile("^[\\w.]+$");

    /** dumpsys package 输出中 suspended=true/false token 匹配 */
    private static final Pattern SUSPENDED_EQ_RX = Pattern.compile("suspended=(true|false)");

    // ================= 状态字段 =================

    /** 单例引用（syncLock/snapshot 静态面直接读；stopSelf 后置空） */
    private static volatile JealousyGuardService instance;

    /** 锁定的包名（null=无锁，守护空转直至 stopSelf）；主线程写/守护线程与桥线程读 → volatile */
    private volatile String lockPkg;
    /** 到期时刻（epoch ms；0=「直到哄好」——原生不判到期，只盯强解） */
    private volatile long unlockAt;
    /** 吃醋角色名（通知文案用，缺省 TA） */
    private volatile String charName;

    /** 守护循环载体：独立 HandlerThread（不吃主线程，也不依赖 WebView） */
    private HandlerThread guardThread;
    private Handler guardHandler;

    /** 30s 节拍任务：先 guardTick，再自续（锁字段已清/循环已停时不再续拍） */
    private final Runnable guardTickTask = new Runnable() {
        @Override
        public void run() {
            try {
                guardTick(); // 内部已全兜（单轮异常吞掉、循环照常）
                if (guardHandler != null && lockPkg != null) {
                    guardHandler.postDelayed(this, TICK_MS);
                }
            } catch (Throwable ignored) {
                // 兜底的兜底：HandlerThread looper 上未捕获异常=进程崩溃，绝不允许
                try {
                    if (guardHandler != null && lockPkg != null) {
                        guardHandler.postDelayed(this, TICK_MS);
                    }
                } catch (Throwable ignored2) {
                }
            }
        }
    };

    /** Shizuku UserService 通道（独立于 NativePerceptionPlugin 的私有绑定，不复用其实例） */
    private Shizuku.UserServiceArgs shellArgs;
    private ServiceConnection shellConn;
    private IPerceptionShellService shellSvc;

    /** 到期解锁连续失败轮数（JS re-sync 新锁会话时重置，重试预算刷新） */
    private volatile int expiryFailStreak;
    /** Shizuku 绑定连续失败轮数（规则 4 的 degrade 节流计数） */
    private volatile int bindFailStreak;
    /** Shizuku 通道是否曾成功过（从未成功 + 连续断连才落 degrade，防噪音） */
    private volatile boolean everShellOk;
    /** 最近一次 Shizuku 绑定失败的人话原因（落 degrade 事件用） */
    private volatile String lastBindFailReason;
    /** 距上次「Shizuku 断连」degrade 事件的 tick 数 */
    private volatile int ticksSinceDisconnectDegrade;
    /** 距上次强解检测的时刻（节流窗；主线程重置/守护线程推进 → volatile） */
    private volatile long lastBreachCheckAt;

    // ================= 生命周期 =================

    @Override
    public IBinder onBind(Intent intent) {
        return null; // 纯 started 服务，不对外提供绑定
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        try {
            createChannels();
            guardThread = new HandlerThread("jealousy-guard");
            guardThread.start();
            guardHandler = new Handler(guardThread.getLooper());
        } catch (Throwable ignored) {
            // 极端机型 HandlerThread 起不来：守护循环缺失但前台服务仍在（JS 侧自会兜底）
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 最先 startForeground（Android 11+：startForegroundService 后 5s 内必须调，
        // 晚了系统直接崩 App）：用当下已知字段先立通知，读完 extras 再原地刷新成新锁内容
        try {
            startGuardForeground();
        } catch (Throwable t) {
            stopSelf(); // 连前台都立不住：直接退，不留僵尸
            return START_NOT_STICKY;
        }
        if (intent == null) { // NOT_STICKY 不重投递，纯防御性兜底
            finishSelf();
            return START_NOT_STICKY;
        }
        String pkg = intent.getStringExtra(EXTRA_PKG);
        long at = intent.getLongExtra(EXTRA_UNLOCK_AT, 0L);
        String who = intent.getStringExtra(EXTRA_CHAR_NAME);
        if (pkg == null || pkg.trim().isEmpty()) {
            // 空 pkg = 解除守护（syncLock 静态侧已对活实例 stopSelf，这里兜底重投递场景）
            finishSelf();
            return START_NOT_STICKY;
        }
        lockPkg = pkg.trim();
        unlockAt = at > 0 ? at : 0L;
        charName = (who == null || who.trim().isEmpty()) ? "TA" : who.trim();
        // 新同步 = 新锁会话：重置失败/断连计数；强解节流窗从现在起算
        // （JS 还活着且在心跳时 JS 侧自己在检测，原生让位 2 分钟，避免双头重复报）
        expiryFailStreak = 0;
        bindFailStreak = 0;
        lastBindFailReason = null;
        lastBreachCheckAt = System.currentTimeMillis();
        refreshForegroundNotification();
        scheduleTicks();
        // NOT_STICKY：进程被杀不自动重启（重启也无锁上下文；JS 醒来时会重新 syncLock）
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        // 收尾三件套（均幂等）：解 Shizuku 绑定 / 停守护循环 / 撤常驻通知
        unbindShellQuietly();
        try {
            if (guardHandler != null) guardHandler.removeCallbacksAndMessages(null);
        } catch (Throwable ignored) {
        }
        try {
            if (guardThread != null) guardThread.quitSafely();
        } catch (Throwable ignored) {
        }
        if (instance == this) instance = null;
        try {
            stopForeground(Service.STOP_FOREGROUND_REMOVE); // 常驻通知随服务消失
        } catch (Throwable ignored) {
        }
        super.onDestroy();
    }

    // ================= JS 桥静态入口（插件 NativePerceptionPlugin 转发） =================

    /**
     * 锁状态同步（插件 jealousyGuardSyncLock 转发）：
     * - pkg 非空：startForegroundService 拉起/更新守护（JS bridge 调用时 WebView 在
     *   前台或刚后台，启动合法；Android 8+ 后台 FGS 限制的 IllegalStateException
     *   在此兜底返回失败，交回 JS 走自身降级路径）；
     * - pkg 空：停掉守护（JS 已自己解开锁）。
     * 返回 null=受理成功；非 null=失败人话原因（插件据此 resolve {ok:false, reason}）。
     */
    public static String syncLock(Context ctx, String pkg, long unlockAt, String charName) {
        if (ctx == null) return "无上下文";
        try {
            String p = pkg == null ? null : pkg.trim();
            if (p == null || p.isEmpty()) {
                JealousyGuardService svc = instance;
                if (svc != null) {
                    try {
                        svc.finishSelf();
                    } catch (Throwable ignored) {
                    }
                }
                return null; // 停守护永远视为成功
            }
            if (!PKG_RX.matcher(p).matches()) {
                return "包名非法（仅允许字母/数字/下划线/点）：" + p;
            }
            Intent it = new Intent(ctx, JealousyGuardService.class);
            it.putExtra(EXTRA_PKG, p);
            it.putExtra(EXTRA_UNLOCK_AT, unlockAt);
            it.putExtra(EXTRA_CHAR_NAME, charName);
            try {
                // API 26+ 走 startForegroundService（onStartCommand 5s 内必调 startForeground）；
                // 24-25 由 ContextCompat 降级 startService（彼时无 FGS 概念）
                ContextCompat.startForegroundService(ctx, it);
                return null;
            } catch (IllegalStateException e) {
                // ForegroundServiceStartNotAllowedException（API 31+）为其子类：
                // WebView 被冻结后才醒等极端时序下可能触发——绝不抛出，交 JS 降级
                String msg = e.getMessage();
                return "前台服务启动被系统拒绝：" + (msg == null ? "ForegroundServiceStartNotAllowed" : msg);
            }
        } catch (Throwable t) {
            return "同步守护异常：" + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
        }
    }

    /**
     * 状态快照（插件 jealousyGuardStatus 转发）：running=服务活着、pkg/unlockAt=
     * 当前守护的锁、eventCount=落盘事件数（JS 未取走的）、shizukuAlive=binder 活性。
     * 服务层不依赖 Capacitor 类型，插件侧负责转 JSObject。
     */
    public static Snapshot snapshot(Context ctx) {
        JealousyGuardService svc = instance;
        String pkg = svc == null ? null : svc.lockPkg;
        long unlockAt = svc == null ? 0L : svc.unlockAt;
        int count = storedEventCount(ctx);
        boolean shizukuAlive = false;
        try {
            Shizuku.getVersion(); // 未运行时抛异常（同插件 shizukuBinderAlive 形态）
            shizukuAlive = true;
        } catch (Throwable t) {
            shizukuAlive = false;
        }
        return new Snapshot(svc != null, pkg, unlockAt, count, shizukuAlive);
    }

    /**
     * 取走全部落盘事件（插件 jealousyGuardDrainEvents 转发）：读出后清空存储（含
     * 解析失败的脏数据，防反复解析失败）。返回 org.json.JSONObject 列表，插件侧
     * 转 JSObject。与守护线程的写入并发时最多丢一条正在写的事件（SharedPreferences
     * 同文件原子替换、竞窗极小；事件是尽力而为的对账线索，可接受）。
     */
    public static List<JSONObject> drainEvents(Context ctx) {
        List<JSONObject> out = new ArrayList<>();
        if (ctx == null) return out;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String raw = sp.getString(EVENTS_KEY, "[]");
            try {
                JSONArray arr = new JSONArray(raw);
                for (int i = 0; i < arr.length(); i++) {
                    Object o = arr.opt(i);
                    if (o instanceof JSONObject) out.add((JSONObject) o);
                }
            } catch (Throwable ignored) {
                // 脏数据按空处理：下面照样清空，不留死循环的坏账
            }
            sp.edit().remove(EVENTS_KEY).apply(); // 取走即清空
        } catch (Throwable ignored) {
        }
        return out;
    }

    /** 落盘事件条数（只读不消费；读失败按 0） */
    private static int storedEventCount(Context ctx) {
        if (ctx == null) return 0;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString(EVENTS_KEY, "[]"));
            return arr.length();
        } catch (Throwable t) {
            return 0;
        }
    }

    /** 状态快照载体（纯 Java 值对象） */
    public static final class Snapshot {
        public final boolean running;
        public final String pkg;
        public final long unlockAt;
        public final int eventCount;
        public final boolean shizukuAlive;

        Snapshot(boolean running, String pkg, long unlockAt, int eventCount, boolean shizukuAlive) {
            this.running = running;
            this.pkg = pkg;
            this.unlockAt = unlockAt;
            this.eventCount = eventCount;
            this.shizukuAlive = shizukuAlive;
        }
    }

    // ================= 守护循环核心 =================

    /**
     * 守护节拍（30s 一轮，跑在守护 HandlerThread，全程 try-catch 绝不 crash）：
     * ① 无锁（lockPkg==null）→ 空转返回；
     * ② 锁到期（unlockAt>0 且已过）→ pm unsuspend：成功落 native-unlock 并收工；
     *    失败（Shizuku 断连等）落 degrade 留在本轮不退出、下一轮重试，连续 8 轮
     *    失败落最终 degrade 后收工（防死循环空转）；
     * ③ 强解检测（距上次 ≥2 分钟节流）：dumpsys package 判 suspended 态——
     *    明确「未挂起」→ 落 breach + 高优通知（TA 已经知道了）并收工（锁事实已不
     *    存在）；查询失败/无法判定 → 静默跳过本轮（绝不误报，同 JS 侧
     *    detectForcedBreach 口径），节流窗照样推进（防 30s 一刷）；
     * ④ Shizuku 断连的独立降级记录（noteBindFailure，检测路径调用）：从未成功过
     *    且连续 ≥4 轮绑定失败 → 落一次 degrade；此后每 30 轮（tick 计）再落一次
     *    防刷屏（到期路径自带 degrade 落盘，不重复记）。
     */
    private void guardTick() {
        try {
            if (ticksSinceDisconnectDegrade < Integer.MAX_VALUE) ticksSinceDisconnectDegrade++;
            String pkg = lockPkg;
            if (pkg == null) return; // ① 无锁空转
            long now = System.currentTimeMillis();

            // ② 到期自动解锁（先于强解检测：锁的处置优先且互斥，本轮不再并行检测）
            if (unlockAt > 0 && now >= unlockAt) {
                String failReason = tryExpireUnlock(pkg);
                if (failReason == null) {
                    logEvent("native-unlock", "锁到期，守护服务已自动解开 " + pkg);
                    finishSelf();
                    return;
                }
                expiryFailStreak++;
                logEvent("degrade", "到期解锁失败：" + failReason);
                if (expiryFailStreak >= EXPIRY_GIVE_UP_ROUNDS) {
                    logEvent("degrade", "到期解锁连续 " + expiryFailStreak
                            + " 轮失败，守护放弃重试——锁可能仍挂着，等 JS 醒来接管处理");
                    finishSelf();
                }
                return; // 到期未成：本轮到此为止，下一轮重试
            }

            // ③ 强解检测（2 分钟节流）
            if (now - lastBreachCheckAt >= BREACH_CHECK_INTERVAL_MS) {
                lastBreachCheckAt = now; // 成败都推进节流窗（失败也 2 分钟后再试，防 30s 一刷）
                int suspended = parseSuspendedState(dumpPackageState(pkg));
                if (suspended == 0) {
                    logEvent("breach", "锁仍活跃但已被强行打破：" + pkg);
                    notifyBreach();
                    finishSelf(); // 锁事实已不存在：守护使命结束
                    return;
                }
                // 1=仍在锁中（正常静默）；-1=查询失败/无法判定（静默跳过，绝不误报）
            }
        } catch (Throwable ignored) {
            // 单轮异常吞掉，下一轮照常（守护循环的存活性高于单轮正确性）
        }
    }

    /**
     * 到期解锁一次尝试：经 Shizuku 执行 pm unsuspend <pkg>。
     * 返回 null=成功；非 null=失败人话原因（含 Shizuku 断连细节，供 degrade 文案）。
     * 成功判据：pm 输出不含 error/exception/fail（AOSP 成功输出 "Success" 或空——
     * 对已解开的包重放 unsuspend 也是幂等成功，锁生命周期反正已结束）。
     */
    private String tryExpireUnlock(String pkg) {
        if (!PKG_RX.matcher(pkg).matches()) {
            return "包名非法（" + pkg + "）";
        }
        IPerceptionShellService svc = bindShell();
        if (svc == null) {
            return lastBindFailReason == null ? "Shizuku 断连" : lastBindFailReason;
        }
        try {
            String out = svc.execFiltered(new String[]{"pm", "unsuspend", pkg}, null, 0L, 50, 8000L);
            String low = out == null ? "" : out.toLowerCase();
            if (low.contains("error") || low.contains("exception") || low.contains("fail")) {
                String frag = out == null ? "" : out.trim();
                return "pm unsuspend 报错：" + (frag.length() > 120 ? frag.substring(0, 120) : frag);
            }
            return null; // 空输出 / "Success" 均视为已解开
        } catch (Throwable t) {
            unbindShellQuietly(); // binder 疑似死亡：丢弃连接，下一轮重新绑定重试
            return "Shizuku 命令通道异常（" + t.getClass().getSimpleName() + "）";
        }
    }

    /**
     * 强解检测的查询步：dumpsys package <pkg> 原始输出。
     * 返回 null=查询失败/无法判定（含 Shizuku 断连——由 noteBindFailure 记降级线索）；
     * 判定逻辑在 parseSuspendedState（查询与判定分离：查询失败绝不等于未挂起）。
     */
    private String dumpPackageState(String pkg) {
        if (pkg == null || !PKG_RX.matcher(pkg).matches()) {
            return null; // 包名不合法：宁可漏检不误报
        }
        IPerceptionShellService svc = bindShell();
        if (svc == null) {
            noteBindFailure();
            return null;
        }
        try {
            // 单包 dumpsys 输出几百行量级：不过滤行、上限 2000 行 / 8s 看门狗（服务端另有 400K 字符环形上限）
            return svc.execFiltered(new String[]{"dumpsys", "package", pkg}, null, 0L, 2000, 8000L);
        } catch (Throwable t) {
            unbindShellQuietly();
            noteBindFailure();
            return null;
        }
    }

    /**
     * 记一次 Shizuku 绑定失败（规则 ④，仅检测路径调用）：从未成功过且连续 ≥4 轮 →
     * 落首次 degrade；此后每 30 轮（tick 计）再落一次（防刷屏）。
     * 曾经成功过的情况保持静默：瞬时抖动多半等 Shizuku 自愈（到期路径失败自有其 degrade 记录）。
     */
    private void noteBindFailure() {
        bindFailStreak++;
        if (everShellOk) return;
        if (bindFailStreak == DISCONNECT_DEGRADE_ROUNDS
                || ticksSinceDisconnectDegrade >= DISCONNECT_RELOG_TICKS) {
            logEvent("degrade", "Shizuku 断连，原生守护无法执行（"
                    + (lastBindFailReason == null ? "未知原因" : lastBindFailReason) + "）");
            ticksSinceDisconnectDegrade = 0;
        }
    }

    /**
     * 解析 dumpsys package 输出中的挂起态：1=挂起（锁仍有效）、0=未挂起（锁被强行
     * 打破）、-1=无法判定（绝不误报强解）。
     * 兼容两种形态（Android 版本差异）：
     *   ①「suspended=true/false」token 行（多 user 段任一处 true 都按挂起）；
     *   ②「pkgFlags=[...SUSPENDED...]」flags 行——有 flags 行但不含 SUSPENDED=未挂起。
     * 判「未挂起」必须拿到明确否定证据（任一形态存在且无一为 true）；两种形态都
     * 找不到 → -1 静默跳过。
     */
    private static int parseSuspendedState(String dump) {
        if (dump == null || dump.isEmpty()) return -1;
        // ① suspended=true/false token
        boolean sawEq = false;
        try {
            Matcher m = SUSPENDED_EQ_RX.matcher(dump);
            while (m.find()) {
                sawEq = true;
                if ("true".equals(m.group(1))) return 1;
            }
        } catch (Throwable ignored) {
        }
        // ② flags 行（pkgFlags/privateFlags）：括号列表内含独立词 SUSPENDED=挂起
        boolean sawFlagsLine = false;
        try {
            for (String line : dump.split("\n")) {
                String t = line.trim();
                int b = t.indexOf("Flags=[");
                if (b < 0) continue;
                sawFlagsLine = true;
                String inner = t.substring(b + "Flags=[".length());
                int e = inner.indexOf(']');
                if (e >= 0) inner = inner.substring(0, e);
                for (String tok : inner.split("[^A-Za-z_]+")) {
                    if ("SUSPENDED".equals(tok)) return 1; // 词边界匹配，防 XXX_SUSPENDED 前缀误配
                }
            }
        } catch (Throwable ignored) {
        }
        if (sawEq || sawFlagsLine) return 0; // 有判定形态且无一为 true → 明确未挂起
        return -1; // 两种形态都没出现：无法判定（查询输出残缺等），绝不误报
    }

    /** 启动/重启守护节拍：清掉旧拍子，~3s 后先跑一轮（尽快进入到期/强解判定节奏） */
    private void scheduleTicks() {
        if (guardHandler == null) return;
        try {
            guardHandler.removeCallbacksAndMessages(null);
            guardHandler.postDelayed(guardTickTask, FIRST_TICK_DELAY_MS);
        } catch (Throwable ignored) {
        }
    }

    /** 收工：清锁字段（让残余节拍变空转）+ 解 Shizuku 绑定 + 停服务（常驻通知随之消失） */
    private void finishSelf() {
        try {
            lockPkg = null;
        } catch (Throwable ignored) {
        }
        unbindShellQuietly();
        stopSelf();
    }

    /** 事件落盘（环形 50 条，超限从最旧的头部淘汰）：JS 醒来后 drainEvents 一次取走 */
    private void logEvent(String type, String text) {
        try {
            SharedPreferences sp = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            JSONArray arr;
            try {
                arr = new JSONArray(sp.getString(EVENTS_KEY, "[]"));
            } catch (Throwable t) {
                arr = new JSONArray(); // 脏数据重建，不丢新事件
            }
            JSONObject o = new JSONObject();
            o.put("ts", System.currentTimeMillis());
            o.put("type", type);
            o.put("pkg", lockPkg == null ? "" : lockPkg);
            o.put("text", text == null ? "" : text);
            arr.put(o);
            while (arr.length() > EVENT_RING_MAX) {
                arr.remove(0); // 环形淘汰：从头（最旧）开始丢
            }
            sp.edit().putString(EVENTS_KEY, arr.toString()).apply();
        } catch (Throwable ignored) {
            // 落盘失败不可救也不可 crash（守护主链路继续）
        }
    }

    // ================= Shizuku UserService 通道（独立于插件侧的绑定） =================

    /**
     * 绑定/复用跑在 Shizuku 进程的 shell 服务（6s 等待）：
     * 独立持有 UserServiceArgs/ServiceConnection——processNameSuffix 独立
     * jealousy_guard，与插件侧 perception_shell 各持一条连接互不干扰（Shizuku 为每个
     * bindUserService 建独立 conn）；version 与插件侧保持一致 3（PerceptionShellService
     * 逻辑/AIDL 改动时两侧必须同步 bump，否则 Shizuku 复用旧类不重载）。
     * 失败返回 null 并把人话原因记进 lastBindFailReason（供 degrade 事件文案）。
     */
    private IPerceptionShellService bindShell() {
        if (shellSvc != null) return shellSvc;
        try {
            // binder 活性（getVersion 未运行时抛异常——同插件 shizukuBinderAlive 形态）
            try {
                Shizuku.getVersion();
            } catch (Throwable t) {
                lastBindFailReason = "Shizuku 未运行";
                return null;
            }
            try {
                if (Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) {
                    lastBindFailReason = "Shizuku 未授权";
                    return null;
                }
            } catch (Throwable t) {
                lastBindFailReason = "Shizuku 权限检查失败";
                return null;
            }
            if (shellArgs == null) {
                shellArgs = new Shizuku.UserServiceArgs(
                                new ComponentName(this, PerceptionShellService.class))
                        .processNameSuffix("jealousy_guard")
                        .daemon(false)
                        .version(3); // 与插件侧 requireShellService 的 version 保持一致
            }
            final CountDownLatch latch = new CountDownLatch(1);
            final AtomicReference<IPerceptionShellService> ref = new AtomicReference<>(null);
            ServiceConnection conn = new ServiceConnection() {
                @Override
                public void onServiceConnected(ComponentName name, IBinder service) {
                    try {
                        ref.set(IPerceptionShellService.Stub.asInterface(service));
                    } catch (Throwable ignored) {
                    }
                    latch.countDown();
                }

                @Override
                public void onServiceDisconnected(ComponentName name) {
                    // Shizuku 进程死亡/断连：作废当前引用，下一轮 guardTick 重新绑定
                    shellSvc = null;
                    shellConn = null;
                }
            };
            try {
                Shizuku.bindUserService(shellArgs, conn);
            } catch (Throwable t) {
                lastBindFailReason = "bindUserService 失败（Shizuku 服务进程异常）";
                return null;
            }
            shellConn = conn;
            boolean ok;
            try {
                ok = latch.await(BIND_WAIT_MS, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                try {
                    Shizuku.unbindUserService(shellArgs, conn, true);
                } catch (Throwable ignored) {
                }
                shellConn = null;
                lastBindFailReason = "绑定等待被中断";
                return null;
            }
            if (!ok) {
                try {
                    Shizuku.unbindUserService(shellArgs, conn, true);
                } catch (Throwable ignored) {
                }
                shellConn = null;
                lastBindFailReason = "绑定超时（" + (BIND_WAIT_MS / 1000L) + "s）";
                return null;
            }
            IPerceptionShellService svc = ref.get();
            if (svc == null) {
                try {
                    Shizuku.unbindUserService(shellArgs, conn, true);
                } catch (Throwable ignored) {
                }
                shellConn = null;
                lastBindFailReason = "绑定返回空服务";
                return null;
            }
            shellSvc = svc;
            bindFailStreak = 0; // 连上即打断「连续断连」计数
            everShellOk = true;
            return svc;
        } catch (Throwable t) {
            // 兜底大网：任何没料到的 Shizuku API 异常都不许击穿守护循环
            lastBindFailReason = "Shizuku 绑定异常：" + t.getClass().getSimpleName();
            return null;
        }
    }

    /** 解绑 Shizuku UserService（幂等；onDestroy / finishSelf / 命令通道异常时调用） */
    private void unbindShellQuietly() {
        ServiceConnection conn = shellConn;
        Shizuku.UserServiceArgs args = shellArgs;
        shellConn = null;
        shellSvc = null;
        if (conn != null && args != null) {
            try {
                Shizuku.unbindUserService(args, conn, true);
            } catch (Throwable ignored) {
            }
        }
    }

    // ================= 通知 =================

    /** 双渠道创建（幂等）：常驻守护 LOW 静默 + 强解警报 HIGH 出声（见 CHANNEL_ID 注释） */
    private void createChannels() {
        try {
            if (Build.VERSION.SDK_INT >= 26) { // NotificationChannel 需 API 26+（minSdk 24 版本闸）
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm == null) return;
                NotificationChannel low = new NotificationChannel(
                        CHANNEL_ID, "吃醋守护", NotificationManager.IMPORTANCE_LOW);
                low.setDescription("吃醋锁生效期间的常驻守护通知（锁到期自动解锁/强解检测的后台调度）");
                low.setShowBadge(false);
                nm.createNotificationChannel(low); // 仅首次创建生效，重复调用幂等
                NotificationChannel high = new NotificationChannel(
                        CHANNEL_ID_ALERT, "吃醋守护警报", NotificationManager.IMPORTANCE_HIGH);
                high.setDescription("锁住的应用被强行解开时的高优提醒");
                nm.createNotificationChannel(high);
            }
        } catch (Throwable ignored) {
        }
    }

    /**
     * 立常驻前台通知（id 7789，渠道 jealousy_guard，IMPORTANCE_LOW 静默）：
     * Android 14+ 必须带 specialUse 类型（Manifest 已声明 FOREGROUND_SERVICE_SPECIAL_USE
     * 与 property 子类型）；29-33 无类型两参重载；24-28 单参。onStartCommand 里最先调用。
     */
    private void startGuardForeground() {
        Notification n = buildGuardNotification();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFY_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFY_ID, n, 0);
        } else {
            startForeground(NOTIFY_ID, n);
        }
    }

    /** 常驻通知构造：标题「吃醋守护中」、内容带角色名与被锁应用显示名（FLAG_ONGOING_EVENT 常驻） */
    @SuppressWarnings("deprecation")
    private Notification buildGuardNotification() {
        Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        String role = charName == null || charName.trim().isEmpty() ? "TA" : charName.trim();
        b.setContentTitle("吃醋守护中");
        String pkg = lockPkg;
        if (pkg != null && !pkg.isEmpty()) {
            b.setContentText(role + " 正在吃醋守护（" + appLabel(pkg) + " 锁定中）");
        } else {
            b.setContentText(role + " 正在吃醋守护");
        }
        b.setOngoing(true) // FLAG_ONGOING_EVENT：不可划走，随服务停止消失
                .setOnlyAlertOnce(true); // re-sync 刷新内容时不重复打扰
        applySmallIcon(b);
        return b.build();
    }

    /** re-sync 后把常驻通知原地刷成新锁内容（同 id 7789 替换） */
    private void refreshForegroundNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIFY_ID, buildGuardNotification());
        } catch (Throwable ignored) {
        }
    }

    /**
     * 强解高优警报（id 7790，渠道 jealousy_guard_alert，IMPORTANCE_HIGH）：
     * WebView 已死时这是「TA 已经知道了」的唯一出口（breach 事件才是 JS 对账的
     * 事实源，通知失败不影响落盘）。可点击回应用、可划走（非常驻）。
     */
    @SuppressWarnings("deprecation")
    private void notifyBreach() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) { // 渠道幂等创建（createChannels 正常已建，防 onCreate 失败路径）
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID_ALERT, "吃醋守护警报", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("锁住的应用被强行解开时的高优提醒");
                nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(this, MainActivity.class);
            open.setPackage(getPackageName());
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pi = PendingIntent.getActivity(this, BREACH_NOTIFY_ID, open,
                    PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                    ? new Notification.Builder(this, CHANNEL_ID_ALERT)
                    : new Notification.Builder(this);
            b.setContentTitle("TA 发现你强行解锁了")
                    .setContentText("锁住的应用被强行解开——TA 已经知道了")
                    .setAutoCancel(true) // 点击后消失；非 ongoing 可被划走
                    .setContentIntent(pi);
            applySmallIcon(b);
            nm.notify(BREACH_NOTIFY_ID, b.build());
        } catch (Throwable ignored) {
            // 通知权限被关等场景：breach 事件已落盘，JS 醒来仍能对账
        }
    }

    /** 小图标高容错：优先框架锁图标（API 1 起就有），异常退回应用 launcher 图标 */
    private void applySmallIcon(Notification.Builder b) {
        try {
            b.setSmallIcon(android.R.drawable.ic_lock_lock);
        } catch (Throwable t) {
            try {
                b.setSmallIcon(R.mipmap.ic_launcher);
            } catch (Throwable ignored) {
            }
        }
    }

    /** 被锁应用显示名（QUERY_ALL_PACKAGES 已声明；解析失败退回包名本身） */
    private String appLabel(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            CharSequence label = pm.getApplicationLabel(ai);
            if (label != null && label.length() > 0) return label.toString();
        } catch (Throwable ignored) {
        }
        return pkg;
    }
}
