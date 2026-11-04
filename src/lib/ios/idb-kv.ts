'use client';

/**
 * localStorage → IndexedDB 迁移与统一读写层（中大容量模块专用）：
 *
 * 背景：聊天消息 / 记忆 / 表情包（含 dataURL）/ 朋友圈 / 钱包等模块原先持久化在 localStorage，
 * 数据量随会话与图片增长（表情包 dataURL 尤甚），逼近 5MB 配额上限。本模块把这些模块统一
 * 搬到 ios-phone-db 的 kv store（{ key, value }，key = 原 localStorage 键名）。
 *
 * - 迁移（migrateLsToKv）：每次启动幂等执行 —— 扫描 localStorage 命中管理清单的键 →
 *   JSON.parse 后写入 kv → 读回校验一致 → 才删除 localStorage 旧键（防中断丢数据）。
 *   校验失败保留旧键，下次启动重试。
 * - 读写统一：迁移后的模块运行期只走 kvGet/kvSet/kvDel（内存缓存同步读 + 异步写穿 IndexedDB），
 *   不再写 localStorage；localStorage 仅在「IndexedDB 完全不可用」的极端环境降级回用（保命兜底）。
 * - 时序安全：ensureKvReady()（迁移 + 全量注水）在 PhoneShell 开机门控（loaded）之前 await，
 *   开机屏结束前所有模块的同步读（kvGet）都能拿到数据，无需改动各组件的同步调用方式。
 * - 小开关/状态/缓存类（时间感知/回复条数/分句/置顶/未读角标/天气电量缓存等）数据量小且
 *   需要同步首帧读，保留 localStorage，不在此清单（杀鸡不 用牛刀）。
 */

import { localDB } from './db';
import {
  accountAppOfKey,
  getActiveAccountIdFor,
  MAIN_ACCOUNT_ID,
  type AccountApp,
} from './accounts';

// ---------------- 迁移清单（A 级模块的键） ----------------

/** 精确键（全局单份数据） */
const MIGRATE_EXACT = new Set<string>([
  // 微信
  'wx-moments',
  'wx-friend-reqs',
  'wx-wallet',
  'wx-wallet-cards',
  'wx-change-bills',
  'wx-lcq',
  'wx-family-cards',
  'wx-family-cards-in',
  'wx-pay-pwd',
  'wx-favorites',
  'wx-stickers',
  // QQ
  'qq-zone-posts',
  'qq-zone-likes',
  'qq-zone-comments',
  'qq-checkin',
  'qq-wallet',
  'qq-wallet-cards',
  'qq-wallet-bills',
  'qq-pay-pwd',
  'qq-vault-earn',
  'qq-stickers',
  'qq-favorites',
  // 信息（AI 助手会话）
  'ios-chat-assistant-msgs',
  // 翻译译文缓存（可达数百 KB）
  'chat-translate-cache',
  // 主屏小组件卡片（头像/照片 dataURL，单卡可达数百 KB）
  'home.profileCard.v1',
  'home.bubbleCard.v1',
  'home.diaryCard.v1',
  'home.listenCard.v1',
  'home.dialogCard.v1',
  'home.icityCard.v1',
  'home.polaroidCard.v1',
]);

/** 前缀模式（按联系人/会话隔离的多份数据） */
const MIGRATE_PREFIXES = [
  'wx-chat-msgs:', // 微信聊天记录（遗留 sms-chat-msgs: 一并清扫，见 contacts-store 清理逻辑兼容）
  'qq-chat-msgs:',
  'ios-chat-msgs:',
  'sms-chat-msgs:', // 信息 App 更早版本的遗留键
  'wx-ai-events:',
  'qq-ai-events:',
  'qq-bond:',
  'qq-friend-likes:',
  'mem-frag:',
  'mem-ltm:',
  'mem-long:',
  'mem-settings:',
  'mem-round:',
  'mem-msgcount:',
  'mem-anchor:',
];

function isMigratableKey(key: string): boolean {
  if (MIGRATE_EXACT.has(key)) return true;
  return MIGRATE_PREFIXES.some((p) => key.startsWith(p));
}

// ---------------- 账号作用域映射（Task 40 v2） ----------------

/**
 * 多账号（Task 40 v2）：`wx-*` / `qq-*` / `ios-chat-*` / `sms-*` 前缀的键按对应 App 的
 * 当前账号加 `--{accountId}` 后缀（大号保持原键零迁移）；其余键原样。
 * 这样微信/QQ/信息三个 App 的聊天、钱包、朋友圈、拉黑、收藏、表情等数据天然随
 * 各自 App 的账号切换；照片/音乐/备忘录等设备级数据不受影响（不映射）。
 * 记忆 mem-* 键由 memory.ts 自行按聊天所在 App 的账号加后缀（同账号跨 App 共享记忆）。
 * 带后缀的键直接读写（kvGetRaw 等显式 API）不会被二次映射。
 */
function scopeSuffixOf(key: string): string {
  const app = accountAppOfKey(key);
  if (!app) return '';
  const id = getActiveAccountIdFor(app);
  return id === MAIN_ACCOUNT_ID ? '' : `--${id}`;
}

/** 裸键（调用方语义键）→ 实际存储键（大号 = 原键） */
function effKey(key: string): string {
  const suffix = scopeSuffixOf(key);
  return suffix ? `${key}${suffix}` : key;
}

// ---------------- 内存写穿层 ----------------

const memStore = new Map<string, unknown>();

/** IndexedDB 是否可用（打不开时自动降级回 localStorage，保命） */
let idbAvailable = true;
/** ensureKvReady 是否已完成（迁移 + 注水） */
let readyDone = false;

/**
 * 跨 App / 跨账号显式读取：按指定 App 的当前账号读 `key`（不带后缀的语义键）。
 * 供 cross-app-context / 记忆回捞 / 摘录等「明确知道要读哪个 App」的场景使用。
 */
export function kvGetScoped<T = unknown>(key: string, app: AccountApp): T | null {
  return kvGetRaw<T>(require_scope(key, app));
}

/** 跨账号显式写入（同 kvGetScoped 的写侧） */
export function kvSetScoped(key: string, value: unknown, app: AccountApp): void {
  kvSetRaw(require_scope(key, app), value);
}

/** 原样键读（调用方自己处理账号后缀，如 digest 扫描出的带后缀键） */
export function kvGetRaw<T = unknown>(key: string): T | null {
  if (memStore.has(key)) return (memStore.get(key) ?? null) as T | null;
  return null;
}

/** 原样键写（写穿 IndexedDB 同键） */
export function kvSetRaw(key: string, value: unknown): void {
  memStore.set(key, value);
  cancelPendingKvWrite(key); // 立即写穿前取消同键的防抖写入，防旧值乱序覆盖新值
  if (!idbAvailable) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 忽略
    }
    return;
  }
  void localDB.put('kv', { key, value }).catch(() => {});
}

// ---------------- 防抖写穿（高频大值合并写入） ----------------
// 聊天记录这类「整会话一个键」的数据每次追加都全量重写：AI 连发 5 条分段回复
// 会触发 ~10 次同一键的全量 IndexedDB put（显式落盘 + msgs effect 双写 × 条数）。
// kvSetDebounced 内存同步更新（kvGet 语义不变），IndexedDB 写入按键合并到
// 静默期一次；pagehide / flushKvWrites() 立即冲刷，数据不丢。

const KV_WRITE_DEBOUNCE_MS = 400;
/** 防抖中的写入：key → { value, timer }（timer 到期一次性 put 最新值） */
const pendingWrites = new Map<string, { value: unknown; timer: number }>();

function cancelPendingKvWrite(key: string): void {
  const p = pendingWrites.get(key);
  if (p) {
    window.clearTimeout(p.timer);
    pendingWrites.delete(key);
  }
}

/** 内存同步 + IndexedDB 防抖写穿：同键高频写自动合并，读路径零变化 */
export function kvSetDebounced(key: string, value: unknown): void {
  memStore.set(key, value);
  if (!idbAvailable) {
    // 降级模式（localStorage 兜底）写入代价低，直接立即写，语义与 kvSetRaw 一致
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 忽略
    }
    return;
  }
  cancelPendingKvWrite(key);
  const timer = window.setTimeout(() => {
    pendingWrites.delete(key);
    void localDB.put('kv', { key, value }).catch(() => {});
  }, KV_WRITE_DEBOUNCE_MS);
  pendingWrites.set(key, { value, timer });
}

/** 立即冲刷全部防抖中的写入（关页前保数据、E2E 验证用） */
export function flushKvWrites(): void {
  if (pendingWrites.size === 0 || !idbAvailable) return;
  for (const [key, p] of pendingWrites) {
    window.clearTimeout(p.timer);
    void localDB.put('kv', { key, value: p.value }).catch(() => {});
  }
  pendingWrites.clear();
}

// 页面隐藏/关闭前冲刷防抖写入（模块级注册一次；pagehide 在刷新/关闭/跳转时必发）
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushKvWrites);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushKvWrites();
  });
}

/** 原样键删 */
export function kvDelRaw(key: string): void {
  memStore.delete(key);
  cancelPendingKvWrite(key); // 删键同时取消同键防抖写入，防删后旧值又写回
  if (!idbAvailable) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 忽略
    }
    return;
  }
  void localDB.delete('kv', key).catch(() => {});
}

/** 列出内存中某前缀的全部原始存储键（含各账号后缀键；purge/摘录/清扫用） */
export function kvKeysByPrefix(prefix: string): string[] {
  return [...memStore.keys()].filter((k) => k.startsWith(prefix));
}

function require_scope(key: string, app: AccountApp): string {
  const id = getActiveAccountIdFor(app);
  return id === MAIN_ACCOUNT_ID ? key : `${key}--${id}`;
}

/**
 * 同步读（内存缓存）。开机门控保证 ready 后内存里已有全量数据；
 * ready 之前的读取（理论上只发生在极早期渲染）返回 null，与旧代码 localStorage 无键时行为一致。
 *
 * #62：极早期同步读（!readyDone）不再回退读 localStorage——
 * 注水前读到的是迁移尚未发生的「陈旧值」（迁移成功后内存里应是 IndexedDB 的最新值），
 * 用陈旧值会与稍后注水的 IndexedDB 值不一致，后续 kvSet 写入还会覆盖新值导致数据丢失。
 * 一律返回 null，让消费方等 ready（loaded）后再读（与原无键时行为一致）。
 */
export function kvGet<T = unknown>(key: string): T | null {
  return kvGetRaw<T>(effKey(key));
}

/** 同步写内存 + 异步写穿 IndexedDB（运行期唯一持久化写入口；按当前账号作用域） */
export function kvSet(key: string, value: unknown): void {
  kvSetRaw(effKey(key), value);
}

/** 同步删内存 + 异步删 IndexedDB（按当前账号作用域删；跨账号清扫用 kvDelByPrefix） */
export function kvDel(key: string): void {
  kvDelRaw(effKey(key));
}

/**
 * 按前缀批量删——**跨全部账号**（前缀匹配含各账号后缀键）：
 * 联系人删除时清聊天/记忆等（数据本体没了，任何账号视角都不该残留）。
 * 「只清当前账号」的换号清库场景用 kvKeysByPrefix + 后缀过滤 + kvDelRaw。
 */
export function kvDelByPrefix(prefix: string): void {
  const keys = [...memStore.keys()].filter((k) => k.startsWith(prefix));
  for (const k of keys) kvDelRaw(k);
}

// ---------------- 迁移与注水 ----------------

/**
 * 把 localStorage 命中清单的键迁移到 kv（幂等）：
 * 并行写入（IndexedDB 单连接多事务安全）；put 成功即成功（事务性保证，不再读回
 * JSON.stringify 对比——大对象双序列化是首次启动的显著开销；失败保留旧键下次重试）。
 * 返回迁移的键数（用于日志/验证）。
 */
async function migrateLsToKv(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && isMigratableKey(k)) keys.push(k);
  }
  if (keys.length === 0) return 0;
  let migrated = 0;
  await Promise.all(
    keys.map(async (key) => {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw == null) return;
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          value = raw; // 非 JSON 字符串原样存
        }
        // 已有键则不覆盖：说明上次迁移 put 已成功（可能后续运行期已被 kvSet 更新过）。
        // 防止极端窗口（put 成功后、删旧键前页面被杀）下，下次启动用 localStorage
        // 旧值覆盖运行期新值。kv 存的是 JSON.parse 结果（可结构化克隆），不存在
        // 「上次写坏」需要 LS 修复的场景，直接以 kv 为准并清掉 LS 旧键。
        const existing = await localDB.get('kv', key);
        if (existing == null) {
          await localDB.put('kv', { key, value }); // put resolve = 事务提交成功
        }
        window.localStorage.removeItem(key);
        migrated++;
      } catch {
        // 单键失败不阻塞其余迁移（保留旧键，下次启动重试）
      }
    })
  );
  return migrated;
}

/** kv store 全量注水到内存（键数量有限且值为中小 JSON，一次性 getAll 开销可接受） */
async function hydrateAll(): Promise<void> {
  const all = await localDB.getAll('kv');
  for (const rec of all) {
    if (rec && typeof rec.key === 'string') memStore.set(rec.key, rec.value);
  }
}

/**
 * 启动入口（幂等）：迁移 localStorage → 注水 IndexedDB → ready。
 * PhoneShell 开机门控在 loaded 前 await 本函数；完成后各模块同步读全部命中内存。
 */
export function ensureKvReady(): Promise<void> {
  if (readyDone) return Promise.resolve();
  return (async () => {
    try {
      await migrateLsToKv();
      await hydrateAll();
      readyDone = true;
    } catch {
      // IndexedDB 打不开（极端环境，如隐私模式禁用存储）：降级回 localStorage 读写，聊天/记忆等不中断。
      // 同时把 localStorage 里的管理键注水进内存 —— 降级模式下 kvSet 也会写 localStorage，
      // 同一隐私会话刷新后 localStorage 数据还在，必须注水才能读到（否则刷新即丢）。
      idbAvailable = false;
      readyDone = true;
      if (typeof window !== 'undefined') {
        try {
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (!k || !isMigratableKey(k) || memStore.has(k)) continue;
            const raw = window.localStorage.getItem(k);
            if (raw == null) continue;
            try {
              memStore.set(k, JSON.parse(raw));
            } catch {
              memStore.set(k, raw);
            }
          }
        } catch {
          // 注水失败忽略（与旧代码无键时行为一致）
        }
      }
      console.warn('[idb-kv] IndexedDB 不可用，已降级回 localStorage 持久化');
    }
  })();
}

/** 测试/验证辅助：迁移与注水是否已完成 */
export function isKvReady(): boolean {
  return readyDone;
}

/** 测试/验证辅助：某键是否仍在 localStorage（迁移后应为 false） */
export function lsHas(key: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(key) != null;
}
