'use client';

/**
 * 网页虚拟使用时长账本（v1.9.28）——吃醋锁巡检的网页降级数据源。
 *
 * 真机有 usagestats 系统账本（dumpsys usagestats）；网页端（浏览器预览）没有——
 * 本模块订阅 useUI.activeApp 的变化，给虚拟手机里的每个 App 记「今日前台累计时长」，
 * 让 AI 巡检降级到网页内部时依然能拿到「TA 今天刷了多久、正在干嘛」的真实数据。
 *
 * - 记账粒度：activeApp 变化时把上一段时长落到上一 App；30s 周期兜底长开同一 App 的段；
 * - 存储：localStorage `web-usage-ledger-v1`（{ day, apps, lastApp, lastAt }，跨日自动清零）；
 * - 消费方：吃醋锁巡检 collectPatrolIntel / [手机操作:使用时长] / getAppUsage 工具。
 *
 * 依赖方向：本模块 → store（动态 import，避免加载期循环）；无任何反向依赖。
 */

const KEY = 'web-usage-ledger-v1';

/** 虚拟手机 AppId → 展示名（AI/巡检情报读的口径） */
const APP_NAMES: Record<string, string> = {
  chat: 'AI 助手（聊天）',
  wechat: '微信',
  qq: 'QQ',
  taobao: '淘宝',
  phone: '电话',
  photos: '照片',
  camera: '相机',
  music: '网易云音乐',
  browser: '浏览器',
  weather: '天气',
  clock: '时钟',
  themes: '主题',
  files: '文件',
  reminders: '提醒事项',
  calculator: '计算器',
  notes: '备忘录',
  calendar: '日历',
  recorder: '录音机',
  contacts: '联系人',
  settings: '设置',
  appstore: 'App Store',
  memory: '记忆',
  worldbook: '世界书',
  meituan: '美团',
  couple: '情侣空间',
  cottage: '小屋',
  forum: 'X论坛',
  __home: '主屏（没开任何应用）',
};

export function webAppName(app: string): string {
  return APP_NAMES[app] ?? app;
}

interface Ledger {
  /** 记账日（YYYY-MM-DD；跨日自动清零） */
  day: string;
  /** appId → 今日累计毫秒 */
  apps: Record<string, number>;
  /** 记账中最后一段的应用（null=主屏） */
  lastApp: string | null;
  /** 最后一段起点 */
  lastAt: number;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readLedger(): Ledger {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Ledger>;
      if (p && typeof p === 'object' && typeof p.apps === 'object') {
        return {
          day: typeof p.day === 'string' ? p.day : today(),
          apps: p.apps,
          lastApp: typeof p.lastApp === 'string' ? p.lastApp : null,
          lastAt: typeof p.lastAt === 'number' ? p.lastAt : Date.now(),
        };
      }
    }
  } catch {
    /* 损坏重置 */
  }
  return { day: today(), apps: {}, lastApp: null, lastAt: Date.now() };
}

/** 模块内存态（读快 + 写盘失败的会话内兜底） */
let mem: Ledger | null = null;

function ledger(): Ledger {
  if (!mem) {
    mem = readLedger();
    if (mem.day !== today()) mem = { day: today(), apps: {}, lastApp: mem.lastApp, lastAt: Date.now() };
  }
  return mem;
}

function writeLedger(l: Ledger): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* 隐私模式等写入失败静默（内存态继续有效） */
  }
}

/** 把「从 lastAt 到现在」的时长结到 lastApp 头上（不换段，只落账） */
function flush(now = Date.now()): void {
  const l = ledger();
  const key = l.lastApp ?? '__home';
  const delta = Math.max(0, now - l.lastAt);
  if (delta > 0) {
    l.apps[key] = (l.apps[key] ?? 0) + delta;
    l.lastAt = now;
  }
}

let started = false;

/**
 * 启动记账（JealousyWatcher 挂载时调用一次；重复调用安全）。
 * 订阅 useUI.activeApp 变化结段 + 30s 周期兜底落盘（长开同一 App / 刷新恢复）。
 */
export function initWebUsageLedger(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void (async () => {
    try {
      const { useUI } = await import('./store');
      let prevApp = useUI.getState().activeApp;
      // 恢复记账段：从当前时刻重开（刷新期间的断档不猜）
      const l = ledger();
      l.lastApp = prevApp;
      l.lastAt = Date.now();
      useUI.subscribe((s) => {
        const cur = s.activeApp;
        if (cur === prevApp) return;
        flush(); // 上一段结给 prevApp
        const l2 = ledger();
        l2.lastApp = cur;
        l2.lastAt = Date.now();
        prevApp = cur;
        writeLedger(l2);
      });
      window.setInterval(() => {
        flush();
        writeLedger(ledger());
      }, 30_000);
      // 页面隐藏前落一次盘（切走瞬间的时长不丢）
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          flush();
          writeLedger(ledger());
        }
      });
    } catch {
      /* store 不可用（SSR 等）不记账 */
    }
  })();
}

/** 今日各应用使用时长（含当前进行中的一段；降序；同步读 localStorage） */
export function webUsageToday(): { app: string; name: string; ms: number }[] {
  flush();
  const l = ledger();
  return Object.entries(l.apps)
    .map(([app, ms]) => ({ app, name: APP_NAMES[app] ?? app, ms }))
    .sort((a, b) => b.ms - a.ms);
}

/** 今日使用时长文本报告（巡检情报 / [手机操作:使用时长] 网页降级共用） */
export function webUsageReport(): string {
  const rows = webUsageToday();
  if (rows.length === 0) return '【今日使用时长】还没有记录（TA 今天没怎么用这台手机）';
  const total = rows.reduce((s, r) => s + r.ms, 0);
  const lines = rows.slice(0, 8).map((r) => `${r.name}：${Math.max(1, Math.round(r.ms / 60_000))} 分钟`);
  return `【今日使用时长（这台手机）】\n${lines.join('\n')}\n总计：${Math.max(1, Math.round(total / 60_000))} 分钟`;
}

/** 虚拟手机最近用过的应用（AppSwitcher 多任务清单 → 文本报告；异步动态 import store） */
export async function webRecentReport(): Promise<string> {
  try {
    const { useUI } = await import('./store');
    const recents = useUI.getState().recentApps ?? [];
    const active = useUI.getState().activeApp;
    const parts: string[] = [];
    if (active) parts.push(`正在使用：${APP_NAMES[active] ?? active}`);
    if (recents.length > 0) parts.push(`最近用过：${recents.map((a) => APP_NAMES[a] ?? a).join('、')}`);
    if (parts.length === 0) return '【后台/最近应用】TA 最近没有打开过其他应用';
    return `【后台/最近应用（多任务）】${parts.join('；')}`;
  } catch {
    return '【后台/最近应用】暂不可用';
  }
}
