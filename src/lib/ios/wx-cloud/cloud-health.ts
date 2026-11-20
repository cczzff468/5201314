'use client';

/**
 * 云端（Supabase）健康断路器 v22 —— 「本地权威、云端尽力而为镜像」的站内侧对偶。
 *
 * 与网关侧（mini-services/im-gateway/index.ts 的 fetch 拦截器）同语义同参数：连续
 * N 次 402/429/401/403/5xx/网络错 → 冷却 15 分钟 → 到点后下一次真实调用即半开探测
 * （成功→闭合恢复云端镜像；失败→再冷却一轮）。状态跃迁各只打一次 console 日志。
 *
 * 覆盖范围（站内所有「程序化」云端 IO——熔断期间静默跳过云端通道、回落本地）：
 * - 写：自动同步运行包（autoSyncRunPackageIfDeployed——402 重试风暴的站内主源；本地
 *   网关直推照做，网关配置保持新鲜）；
 * - 读：云端心跳（fetchCloudHeartbeat——回落最近已知值，不清空）、云端历史拉取
 *   （pullWx/QqCloudHistory——网关本地通道优先，云端段跳过）、主动消息云端兜底
 *   （relayViaCloud——网关没成且熔断中就不再烧请求）。
 *
 * 用户手动动作（一键部署 / 重新同步运行包 / 云端测试）不硬拦：点了按钮就照发——
 * 手动结果本身就是最好的探测；成功即重置熔断。
 *
 * 说明：项目早前有 api-circuit-breaker.ts（LLM API 失败→全局暂停智能生成）——该功能
 * 已按用户要求下线成直通封装，语义不可复用（那是「暂停站内智能生成」的全局闸，本模块
 * 是「云端镜像通道」的静默降级开关，不碰任何站内生成行为）。
 *
 * 持久化：localStorage（页面刷新/重开站点后冷却窗口延续，不重复计失败数）。
 */

export interface CloudHealthState {
  /** ok = 云端镜像正常；cooling = 冷却中（云端 IO 静默跳过、回落本地） */
  state: 'ok' | 'cooling';
  /** 连续失败计数（成功即清零） */
  fails: number;
  /** 最近一次失败摘要（HTTP 码或网络错误文本） */
  lastErr: string;
  /** 冷却截止时刻（epoch ms；0 = 未在冷却） */
  until: number;
}

/** v22 熔断参数：连续失败阈值 / 冷却时长（与网关侧 GW_SUPA_* 一致） */
const FAIL_N = 3;
const COOLDOWN_MS = 15 * 60_000;
const LS_KEY = 'wx-cloud-health-v1';

let st: CloudHealthState = { state: 'ok', fails: 0, lastErr: '', until: 0 };

try {
  const raw = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
  if (raw) {
    const j = JSON.parse(raw) as Partial<CloudHealthState>;
    if (j && (j.state === 'ok' || j.state === 'cooling')) {
      st = {
        state: j.state,
        fails: Number(j.fails) || 0,
        lastErr: String(j.lastErr || ''),
        until: Number(j.until) || 0,
      };
    }
  }
} catch {
  /* 隐私模式/坏数据：默认 ok */
}

function persist(): void {
  try {
    if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(st));
  } catch {
    /* 隐私模式等忽略 */
  }
}

/** 当前快照（ClawBox 状态源消费；冷却过期自动视为 ok——半开在下一次真实调用里体现） */
export function cloudHealthSnapshot(): CloudHealthState {
  if (st.state === 'cooling' && Date.now() >= st.until) {
    return { state: 'ok', fails: st.fails, lastErr: st.lastErr, until: 0 };
  }
  return { ...st };
}

/** 是否处于熔断冷却（云端 IO 应静默跳过、回落本地） */
export function cloudCooling(): boolean {
  return st.state === 'cooling' && Date.now() < st.until;
}

/** 冷却剩余毫秒（0 = 未在冷却） */
export function cloudCoolingRemainMs(): number {
  return st.state === 'cooling' ? Math.max(0, st.until - Date.now()) : 0;
}

function note(ok: boolean, err: string): void {
  const before = st.state;
  const beforeUntil = st.until;
  if (ok) {
    st = { state: 'ok', fails: 0, lastErr: '', until: 0 };
    if (before !== 'ok') console.log('[wx-cloud] 云端熔断已恢复（探测成功，云端镜像续写）');
    persist();
    return;
  }
  st = { ...st, fails: st.fails + 1, lastErr: err.slice(0, 120) };
  if (st.fails >= FAIL_N) {
    st = { ...st, state: 'cooling', until: Date.now() + COOLDOWN_MS };
    if (before !== 'cooling') {
      console.warn('[wx-cloud] 云端熔断开启：' + st.lastErr + '——15 分钟内站内走本地通道（网关收发不受影响），到点自动探测恢复');
    } else if (Date.now() >= beforeUntil) {
      console.warn('[wx-cloud] 云端熔断半开探测仍失败（' + st.lastErr + '）——再冷却 15 分钟');
    }
  }
  persist();
}

/** 402/429/401/403/5xx 才计入（平台风控/鉴权/限流/不可达；404/400 等业务态不熔断） */
function restricted(status: number): boolean {
  return status === 401 || status === 402 || status === 403 || status === 429 || status >= 500;
}

/**
 * 记一次云端 IO 结果（读/写都算——免费层风控读写两端同病；成功即重置计数与冷却）。
 * statusOrErr：HTTP 状态码（数字）或网络错误文本（字符串）。
 */
export function noteCloudIo(ok: boolean, statusOrErr: number | string): void {
  if (ok) {
    note(true, '');
    return;
  }
  if (typeof statusOrErr === 'number') {
    if (!restricted(statusOrErr)) return; // 业务态（404/400…）：不熔断不计
    note(false, 'HTTP ' + statusOrErr);
    return;
  }
  note(false, statusOrErr);
}
