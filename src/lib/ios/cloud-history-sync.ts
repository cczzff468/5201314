'use client';

/**
 * 云端聊天记录全局自动同步（v10）——手机壳常驻后台模块（PhoneShell 引入一次，模块级单例）。
 *
 * 用户需求全景（三条一起落地）：
 * 1. 「接入微信和 QQ 以后，不管是云端（Supabase 定时任务代答）还是秒回加速（本站在线时
 *    内置网关代答），聊天记录都要自动显示在网站的聊天记录里」：
 *    - 微信云端对话 → history.json → 自动拉回合入「微信聊天界面」（绑定角色线程）；
 *    - QQ 云端对话 → qq-history.json → 自动拉回合入「QQ 聊天界面」（绑定角色线程）；
 *    - 旧版只有「拉取云端聊天记录」手动按钮 + 打开接入页静默拉一次——本模块让它常驻自动。
 * 2. 「QQ 一直正在连接」的兜底自愈：浏览器里已接入 QQ、云端也部署了，但云端运行包里
 *    没有 QQ 凭证（旧版打包逻辑要求先绑角色——历史遗留）→ 网关 QQ 通道永远「未接入」。
 *    本模块检测到这个组合就自动重推运行包（冷却 5 分钟），凭证上云 → 网关重连点亮。
 * 3. 「秒回加速（本站在线时）」常驻：已部署云端就自动拉起内置网关（用户手动停止过的
 *    尊重选择不追着重开，gateway.ts 落盘标记）。
 *
 * 节奏（成本分层）：
 * - 网关状态轮询 12s（本地 mini-service HTTP，零云端成本）——回复计数变化才触发拉取；
 * - 云端历史全量拉取 60s（覆盖云端定时任务代答路径——不经网关，网关计数看不见）；
 * - 有 serviceKey 时直读 Storage（零函数配额）；没有时经云端函数 read-file 中继（约 1 次/分钟）。
 * 拉取本身静默：结果合入本地线程后广播 chat-stream-sysline，微信/QQ 聊天界面实时刷新。
 */

// ---------------- 常量 ----------------

/** 网关状态轮询间隔（本地服务；回复计数变化 → 触发对应渠道立即拉取） */
const GW_POLL_MS = 12_000;
/** 云端历史全量拉取间隔（覆盖 cron 云端代答：不经网关，只能定期拉） */
const FULL_PULL_MS = 60_000;
/** QQ 凭证自补同步冷却（避免反复重推运行包） */
const QQ_HEAL_COOLDOWN_MS = 5 * 60_000;
/** 网关自动拉起节流（掉线自愈 90s 一次） */
const GW_ENSURE_COOLDOWN_MS = 90_000;
/** 启动延迟（避开首屏挂载高峰；等各 store boot 完） */
const START_DELAY_MS = 4_000;

// ---------------- 单例状态 ----------------

interface SyncMods {
  gw: typeof import('./wx-cloud/gateway');
  cloud: typeof import('./wx-cloud/store');
  qq: typeof import('./qq-connect');
  wx: typeof import('./weixin-connect');
}

let mods: SyncMods | null = null;
let booted = false;
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
/** 网关回复计数快照（变化 = 有新代答 → 立即拉取该渠道历史） */
let lastWxReplied = -1;
let lastQqEvents = -1;
/** 上次全量拉取时间（0 = 首轮即拉一次） */
let lastFullPullAt = 0;
/** 上次 QQ 自愈同步时间 */
let qqHealAt = 0;
/** 上次网关自动拉起时间 */
let gwEnsureAt = 0;
/** 拉取防重入（手动按钮/接入页与本模块并发时共享 store 的 pulling 位，不抢） */
let wxPulling = false;
let qqPulling = false;

// ---------------- 拉取（静默尽力而为） ----------------

async function pullWxSilent(): Promise<void> {
  if (wxPulling) return;
  wxPulling = true;
  try {
    await import('./weixin-connect').then((m) => m.pullWxCloudHistory());
  } catch {
    /* 静默：下一轮再试 */
  } finally {
    wxPulling = false;
  }
}

async function pullQqSilent(): Promise<void> {
  if (qqPulling) return;
  qqPulling = true;
  try {
    await import('./qq-connect').then((m) => m.pullQqCloudHistory());
  } catch {
    /* 静默：下一轮再试 */
  } finally {
    qqPulling = false;
  }
}

// ---------------- 主循环 ----------------

async function tick(): Promise<void> {
  try {
    if (!mods) {
      mods = {
        gw: await import('./wx-cloud/gateway'),
        cloud: await import('./wx-cloud/store'),
        qq: await import('./qq-connect'),
        wx: await import('./weixin-connect'),
      };
    }
    if (!booted) {
      booted = true;
      await mods.cloud.useWxCloud.getState().boot();
      await mods.qq.useQqConnect.getState().boot();
      await mods.wx.useWxConnect.getState().boot();
    }

    const cloudSt = mods.cloud.wxCloudSnapshot();
    const deployed = cloudSt.platform === 'supabase' && (cloudSt.supabase?.deployedAt ?? 0) > 0;
    if (!deployed) return; // 没部署云端：本模块整体无事可做（页面内回复不受影响）

    // —— ① 网关常驻（秒回加速）：没在跑且非用户手动停止 → 自动拉起（节流） ——
    let gwStatus = await mods.gw.fetchImGatewayStatus();
    if (!gwStatus?.running && Date.now() - gwEnsureAt > GW_ENSURE_COOLDOWN_MS) {
      gwEnsureAt = Date.now();
      await mods.gw.ensureImGatewayRunning('本站在线自动加速');
      gwStatus = await mods.gw.fetchImGatewayStatus();
    }

    const wxLogin = mods.wx.wxIlinkLoginSnapshot();
    const qqLogin = mods.qq.qqBotLoginSnapshot();

    // —— ② QQ 凭证自愈：浏览器已接入 QQ、网关在跑但 QQ 通道「未接入」= 云端运行包里
    //    还没有 QQ 凭证（旧版打包逻辑的历史遗留）→ 重推运行包（内部成功后会 refresh
    //    网关立即重连）；冷却 5 分钟，不 await（慢操作不拖本轮节奏） ——
    if (qqLogin?.appId && gwStatus?.running && gwStatus.qq?.state === 'disabled' && Date.now() - qqHealAt > QQ_HEAL_COOLDOWN_MS) {
      qqHealAt = Date.now();
      void import('./wx-cloud/supabase')
        .then((m) => m.autoSyncRunPackageIfDeployed('QQ 凭证自动补同步', 'qq'))
        .catch(() => undefined);
    }

    // —— ③ 秒回加速路径：网关回复计数变化 → 立即拉对应渠道（近实时进聊天界面）。
    //    计数用 !== 而非 > 比较：网关重启后计数清零（下降也是变化），避免旧快照压着漏拉。 ——
    if (wxLogin?.boundContactId) {
      const n = gwStatus?.wx?.replied ?? 0;
      if (lastWxReplied >= 0 && n !== lastWxReplied && n > 0) void pullWxSilent();
      lastWxReplied = n;
    } else {
      lastWxReplied = -1;
    }
    if (qqLogin?.boundContactId) {
      const ev = gwStatus?.qq?.events ?? 0;
      if (lastQqEvents >= 0 && ev !== lastQqEvents && ev > 0) void pullQqSilent();
      lastQqEvents = ev;
    } else {
      lastQqEvents = -1;
    }

    // —— ④ 云端路径全量拉取（cron 定时任务代答不经网关，定期拉兜底；首轮即拉一次） ——
    if (Date.now() - lastFullPullAt > FULL_PULL_MS) {
      lastFullPullAt = Date.now();
      if (wxLogin?.boundContactId) void pullWxSilent();
      if (qqLogin?.boundContactId) void pullQqSilent();
    }
  } catch {
    /* 单轮失败静默：下一轮重试 */
  }
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await tick();
    scheduleNext();
  }, GW_POLL_MS);
}

// ---------------- 启动 ----------------

function start(): void {
  if (typeof window === 'undefined') return; // SSR 安全：只在客户端常驻
  if (started) return; // 幂等（模块单例，重复 import 也不会起第二条循环）
  started = true;
  // 立即跑首轮（首屏挂载高峰后 4s：boot 各 store + 立即拉一次云端历史 + 拉起网关）
  window.setTimeout(
    () => {
      void tick().then(() => scheduleNext());
    },
    START_DELAY_MS,
  );
  // 回前台立即补一轮（切回来马上看到新聊天记录，不等 12s 轮询）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tick();
  });
}

start();
