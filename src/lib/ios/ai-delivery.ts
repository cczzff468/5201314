/**
 * AI 回复逐条投递调度器（模拟真人连发）：
 * finalize 解析出的多条消息不再一次性落盘上屏，而是按真人打字节奏逐条投递——
 * 每条到达时才落盘（IndexedDB/localStorage）+ 弹灵动岛通知 + 语音频率判定，
 * 每条投递后广播 tick，让聊天页把新落盘的消息合并进本地 state。
 *
 * 调度器在模块层运行，与聊天页是否存活无关（退出聊天页/切 App 都继续投递，重进后无缝接上）。
 * 同一会话的批次串行排队（上一批投完才跑下一批），保证多轮/群聊多角色的消息上屏顺序与落盘顺序一致。
 */

/** 单批投递选项 */
export interface AiDeliveryOptions {
  /** 第 index 条（0 起）与上一条之间的停顿 ms（首条之前是首延迟）；缺省按内容长度模拟打字节奏 */
  delay?: (index: number, total: number) => number;
  /**
   * 本批第一条投递前的停顿 ms（模拟对方正在打字；首批传 0 立即上屏）。
   * 分段流式投递（边接收边逐条显示）时，第二批起的停顿让消息像真人连发一样逐条冒出。
   */
  initialDelay?: number;
  /**
   * 本批从队列移除（投递完成或被失效丢弃）时的收尾回调：与 resolve 同步触发、
   * 先于 pump 跑下一批 —— beginChatStream 的 M6 边界清位用它保证「旧尾巴全部投完」
   * 与「新回合照旧追加」之间没有同步投递的空隙（.then 微任务会晚于下一批的同步首条）。
   */
  onDrained?: () => void;
}

interface Batch {
  items: readonly unknown[];
  deliver: (item: unknown, index: number) => void;
  opts?: AiDeliveryOptions;
  resolve: () => void;
  /** 已投递条数（peekPendingMsgs 用：运行中批的未投递尾部 = items.slice(deliveredIndex)） */
  deliveredIndex: number;
}

/** 每会话待投递批次队列（首批 = 正在跑） */
const queues = new Map<string, Batch[]>();
/** 会话是否正在投递（队列非空或当前批未跑完） */
const running = new Set<string>();
/** 每条投递后的 tick 订阅（聊天页用：把新落盘消息合并进本地 state） */
const tickListeners = new Map<string, Set<() => void>>();
/** 投递状态变化订阅（聊天页用：「正在输入」指示） */
const activeListeners = new Set<() => void>();

/** 默认停顿：各端通常传 typingDelayOf 按内容长度模拟打字；这里给一个保守的通用节奏 */
function defaultDelay(): number {
  return 700 + Math.random() * 600;
}

/**
 * 页面不可见（切走标签页 / 最小化）时浏览器会对后台 setTimeout 链强节流
 * （先 1s 对齐、几分钟后降到 1 次/分钟），逐条打字节奏会被拖到分钟级——
 * 用户感知就是「打开网页以后 AI 才回复」。页面不可见时改为立即同步投完：
 * 每条立刻落盘 + 走 Web Notification 弹系统通知（页面隐藏时 island-notify 会发系统通知），
 * 回到页面后恢复正常节奏。
 */
function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** 按内容长度估算停顿（各端文字消息用；卡片类消息走默认） */
export function typingDelayOf(text: string): number {
  const len = text.trim().length;
  return Math.min(2400, 850 + len * 45 + Math.random() * 400);
}

function emitActive(): void {
  for (const fn of activeListeners) fn();
}

function emitTick(sessionKey: string): void {
  const set = tickListeners.get(sessionKey);
  if (!set) return;
  for (const fn of [...set]) fn();
}

/** 泵：跑掉队列里的一批；批内逐条 setTimeout 链式投递 */
function pump(sessionKey: string): void {
  const queue = queues.get(sessionKey);
  const batch = queue?.[0];
  if (!batch) {
    // 队列空：释放 running 与 queues 的空数组引用（避免 Map 保留空数组永不释放）
    running.delete(sessionKey);
    queues.delete(sessionKey);
    emitActive();
    return;
  }
  const { items, deliver, opts, resolve } = batch;
  const delayOf = opts?.delay ?? defaultDelay;
  let index = 0;
  const step = (): void => {
    // 批可能被 flush/purge 清空：每步重新校验
    const q = queues.get(sessionKey);
    if (!q || q[0] !== batch) {
      resolve();
      batch.opts?.onDrained?.();
      pump(sessionKey);
      return;
    }
    if (index >= items.length) {
      q.shift();
      resolve();
      batch.opts?.onDrained?.();
      pump(sessionKey);
      return;
    }
    // 页面不可见：跳过打字节奏，分块异步投完本批剩余（后台定时器被强节流，逐条等会是分钟级；
    // 每条投递都会立刻走 Web Notification 弹系统通知，与真机离开屏幕时收通知的体验一致）；
    // 大批量（如 30 条）若一次性 while 同步投完会阻塞主线程，按 CHUNK=5 分块、每块后
    // await new Promise(r => setTimeout(r, 0)) 让出事件循环，保持投递顺序不变
    if (isPageHidden()) {
      const CHUNK = 5;
      void (async () => {
        while (index < items.length) {
          // 每块迭代开头（尤其 await 让出后）重新校验队列头：purge/失效后旧批停止投递，
          // 与同步 step 的失效路径同款收尾（resolve + onDrained + 泵下一批 + 退出）——
          // 否则换号/清队列后旧批的剩余消息仍会在后台继续落盘（L8 重入校验缺口）
          const head = queues.get(sessionKey);
          if (!head || head[0] !== batch) {
            resolve();
            batch.opts?.onDrained?.();
            pump(sessionKey);
            return;
          }
          for (let k = 0; k < CHUNK && index < items.length; k++) {
            const item = items[index];
            try {
              deliver(item, index);
            } catch {
              // 单条投递异常不阻断后续
            }
            batch.deliveredIndex = index + 1;
            emitTick(sessionKey);
            index += 1;
          }
          if (index < items.length) {
            await new Promise<void>((r) => window.setTimeout(r, 0));
          }
        }
        const q = queues.get(sessionKey);
        if (q && q[0] === batch) q.shift();
        resolve();
        batch.opts?.onDrained?.();
        pump(sessionKey);
      })();
      return;
    }
    const item = items[index];
    try {
      deliver(item, index);
    } catch {
      // 单条投递异常不阻断后续（与逐条落盘的容错口径一致）
    }
    batch.deliveredIndex = index + 1;
    emitTick(sessionKey);
    index += 1;
    const wait = Math.max(0, Math.round(delayOf(index - 1, items.length)));
    window.setTimeout(step, wait);
  };
  running.add(sessionKey);
  emitActive();
  // 首条前停顿（分段投递的批间打字节奏）；期间 running 保持，聊天页「正在输入」不闪断。
  // 页面不可见时跳过停顿（定时器被节流，等不到；直接同步投递）
  if (opts?.initialDelay && opts.initialDelay > 0 && !isPageHidden()) {
    window.setTimeout(step, Math.round(opts.initialDelay));
  } else {
    step();
  }
}

/**
 * 调度一批逐条投递；同一会话的批次串行排队（上一批投完才跑本批）。
 * 空批次也参与排队（仅作占位）：调用方靠返回的 Promise 等待「本批及此前排队的同会话批次
 * 全部投递完」（记忆提取等「一轮结束」动作挂在它后面，保证读到完整落盘数据）。
 */
export function scheduleAiDelivery<T>(
  sessionKey: string,
  items: readonly T[],
  deliver: (item: T, index: number) => void,
  opts?: AiDeliveryOptions
): Promise<void> {
  return new Promise<void>((resolve) => {
    let queue = queues.get(sessionKey);
    if (!queue) {
      queue = [];
      queues.set(sessionKey, queue);
    }
    queue.push({
      items,
      deliver: deliver as (item: unknown, index: number) => void,
      opts,
      resolve,
      deliveredIndex: 0,
    });
    if (!running.has(sessionKey)) pump(sessionKey);
  });
}

/** 该会话是否正在投递（含排队中的批次）——聊天页用来显示「正在输入」 */
export function isAiDelivering(sessionKey: string): boolean {
  return running.has(sessionKey) || (queues.get(sessionKey)?.length ?? 0) > 0;
}

/** 全部正在投递（含排队）的会话键快照：pagehide 时逐会话上报未落盘尾部（bg-turn 接力用） */
export function getDeliveringSessionKeys(): string[] {
  const out: string[] = [];
  running.forEach((key) => out.push(key));
  queues.forEach((_q, key) => {
    if (!out.includes(key)) out.push(key);
  });
  return out;
}

/**
 * 偷看某会话「已调度但还没落盘投递」的消息（按投递顺序）：
 * - 运行中批：返回未投递尾部（deliveredIndex 之后的部分）；
 * - 排队中的后续批：全部返回。
 * 群聊多成员回合用（#22 修复）：下一位成员组装上下文时，上一位成员的消息可能还在打字节奏的
 * 投递队列里（逐条停顿几百毫秒到几秒）——只读已落盘消息会漏看，把队列尾部拼进历史即可完整衔接。
 */
export function peekPendingMsgs<T>(sessionKey: string): T[] {
  const out: T[] = [];
  const queue = queues.get(sessionKey);
  if (!queue) return out;
  queue.forEach((batch, i) => {
    const items = batch.items as readonly T[];
    const start = i === 0 ? Math.max(0, batch.deliveredIndex) : 0;
    for (let j = start; j < items.length; j++) out.push(items[j]);
  });
  return out;
}

/**
 * 投递插入边界（#35 上下文时序修复）：
 * 用户在「上一轮还在流式/连发投递」时发消息（busy 排队路径），该消息立刻落库上屏，
 * 而上一轮的回复还在投递队列里、之后才逐条落库——若照旧追加到末尾，旧回复会排在
 * 用户新消息之后（落库顺序 ≠ 对话时序）：显示上旧气泡倒挂在用户新消息下面，
 * 下一轮 AI 上下文以自己的旧消息收尾 → 无视用户最新消息、自言自语。
 *
 * 边界 = busy 路径里那条（批）用户消息的 id：之后投递的 AI 消息插到它前面而不是追加，
 * 落库顺序即对话时序。同会话第一条用户消息为界（连发多条时都插在第一条之前）；
 * 新回合开始（beginChatStream）时清除——此后投递的都是对新消息的回复，照旧追加。
 */
const insertBeforeIds = new Map<string, string>();

/** 标记插入边界（busy 排队路径调用；已有边界时保留第一条——连发的多条用户消息都在边界之后） */
export function markDeliverBoundary(sessionKey: string, userMsgId: string): void {
  if (!userMsgId) return;
  if (!insertBeforeIds.has(sessionKey)) insertBeforeIds.set(sessionKey, userMsgId);
}

/** 清除插入边界（新回合开始时调用；此后投递照旧追加） */
export function clearDeliverBoundary(sessionKey: string): void {
  insertBeforeIds.delete(sessionKey);
}

/**
 * 清空会话键以 prefix 开头的全部待投递批次并复位投递状态（换号 purge 用，审计 #3）：
 * - 运行中批：队列被移除后，step 的下一节拍会发现「队列头 ≠ 当前批」而自行 resolve 退出
 *  （现有重入校验，无需新增取消标记），未投递的尾巴不再落盘——旧账号会话的回复不会
 *   在换号后写进对应聊天记录键；
 * - 排队中的后续批：随队列整体丢弃，但逐批补调 resolve（Promise 幂等，与运行中批的
 *   失效路径双调无害）——原实现直接整队丢弃，排队批的 resolve 永不调用，挂在其后的
 *   await scheduleAiDelivery(...)（回合结算/记忆提取等）会永远悬挂；resolve 后挂在其上的
 *   回调按「投递完成」收尾（不 reject，不阻塞）；
 * - 投递插入边界（markDeliverBoundary）一并清除。
 * 只影响前缀匹配的会话（如 'qq:'），其他端（wx: / sms:）的投递队列不受影响。
 * 返回被清理的会话键数量（0 = 该前缀无待投递项）。
 */
export function purgeDeliveryQueueByPrefix(prefix: string): number {
  const keys: string[] = [];
  queues.forEach((_queue, key) => {
    if (key.startsWith(prefix)) keys.push(key);
  });
  for (const key of keys) {
    const queue = queues.get(key);
    if (queue) {
      for (const batch of queue) {
        try {
          batch.resolve();
        } catch {
          // resolve 回调异常不影响其余批清理
        }
      }
    }
    queues.delete(key);
    insertBeforeIds.delete(key);
  }
  if (keys.length > 0) emitActive();
  return keys.length;
}

/** 带边界的落库拼接：有边界且边界消息还在列表里时，把 item 插到边界消息之前；否则照旧追加 */
export function appendWithBoundary<T extends { id: string }>(sessionKey: string, list: readonly T[], item: T): T[] {
  const boundaryId = insertBeforeIds.get(sessionKey);
  const idx = boundaryId ? list.findIndex((x) => x.id === boundaryId) : -1;
  if (idx < 0) return [...list, item];
  return [...list.slice(0, idx), item, ...list.slice(idx)];
}

/**
 * 按消息创建时间稳定排序（#35 时序兜底）：落库合并/state 合并历史上可能把「上一轮还在投递
 * 队列里的回复」排到用户新消息之后（旧数据或竞态窗口），时间戳记录的是真实创建顺序，
 * 稳定排序只修复倒置、不改动正常数据（同时间戳保持原相对顺序）。历史构建与 state 合并共用。
 */
export function sortMsgsByTime<T extends { time: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.time - b.time);
}

/** 订阅每条投递后的 tick（返回退订函数） */
export function subscribeAiDelivery(sessionKey: string, cb: () => void): () => void {
  let set = tickListeners.get(sessionKey);
  if (!set) {
    set = new Set();
    tickListeners.set(sessionKey, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
    if (set && set.size === 0) tickListeners.delete(sessionKey);
  };
}

/** 订阅投递状态变化（任意会话开始/结束投递时触发；返回退订函数） */
export function subscribeAiDeliveryActive(cb: () => void): () => void {
  activeListeners.add(cb);
  return () => activeListeners.delete(cb);
}
