'use client';

/**
 * 吃醋·全工具查岗引擎（Full-Sweep Interrogation v1.0）。
 *
 * 机主规格（第八轮）：吃醋流程让 AI 使用添加的**所有工具**来查——通知、APP 时长、
 * 屏幕使用时长、截屏、最近应用、应用清单、日程、待办、电量、音量、前台应用、天气……
 *
 * 架构决策：不做 FC 自主选择（模型可能偷懒只调两个装样子），而是**系统直接把全部
 * 查询/感知类工具各真实执行一遍**（Promise.allSettled 并行、单项独立超时、单项失败
 * 各自缺席），把全部工具的真实回传格式化成证据行，并入吃醋决策的 LLM 上下文——
 * 决策模型一次调用里拿着「全工具证据」做人设化决策（锁/警告/拉回/偷窥）。
 *
 * 与各层的关系：
 * - 证据与 jealousy-sense 七维感知**互补**：sense 管「前台+停留+通知栏+键盘」等
 *   高频实时位；sweep 管「使用账本/最近应用/应用清单/日程/待办/电量/音量/天气/截屏」
 *   等全工具位。两者在决策上下文里并列呈现。
 * - **静默铁律**：查岗是 AI 的暗中行为——绝不推工具气泡（不走 runPhoneToolRound）、
 *   绝不弹灵动岛卡（setToolSessionContext 挂上会话后 island() 自动哑火）、
 *   绝不写记忆碎片（查询类工具本就不触发 rememberToolAction）。
 * - **不动手**：sweep 白名单只含查询/感知类工具——冻结/发消息/放歌/切回这类动手
 *   工具一概不进（动手由决策 JSON 的 lock/pullback/peek 字段说了算）。
 *
 * 容错：任一工具失败/超时 → 该行缺席（附降级说明），绝不炸整轮查岗；
 * 模式隔离：网页模式只查网页工具，真机模式加查真机工具（截屏/通知/电量/音量/前台）。
 */

import { execWebTool } from './phone-tools';
import { getToolSessionContext, setToolSessionContext } from './web-tools';

/** sweep 单项超时：普通本地查询（秒级）给 12s 截足 */
const SWEEP_ITEM_TIMEOUT_MS = 12_000;
/** 截屏/看屏幕（Shizuku + VLM 识图，最慢的一项）单独给 35s */
const SWEEP_SCREENSHOT_TIMEOUT_MS = 35_000;
/** 证据行总长度上限（防 token 膨胀：全部证据拼进决策 user 段） */
const SWEEP_LINE_MAX = 320;
/** 全部证据总长度上限 */
const SWEEP_TOTAL_MAX = 3600;

/** sweep 触发场景（决定 prompt 措辞与证据侧重） */
export type SweepCause = 'trigger' | 'watch' | 'patrol' | 'manual';

export interface JealousySweepOpts {
  /** 吃醋剧情归属角色的联系人 id（会话上下文锚点） */
  contactId: string;
  /** 该角色所在的聊天 App */
  app: 'wx' | 'qq' | 'sms';
  /** 角色名（气泡/上下文口吻用） */
  charName: string;
  /** 触发场景 */
  cause: SweepCause;
  /** 感知模式：'web'=只查网页工具；'device'=追加真机查询工具 */
  senseMode: 'web' | 'device';
  /** 是否允许截屏偷窥（真机模式；对齐吃醋锁 peekEnabled 设置） */
  allowScreenshot?: boolean;
}

export interface JealousySweepResult {
  /** 证据行（每行 = 一个工具的真实回传摘要；空数组 = 全军覆没/被跳过） */
  lines: string[];
  /** 实际执行成功的工具名（去重；供 lastIntel 与设置页反馈） */
  calledTools: string[];
  /** 整轮降级说明（null = 至少一项成功） */
  degrade: string | null;
}

/** sweep 工具条目定义：工具名 + 中文短标签（证据行前缀）+ 超时档 */
interface SweepItem {
  name: string;
  label: string;
  timeoutMs: number;
  /** 真机专属（仅 senseMode='device' 时执行） */
  device?: boolean;
}

/**
 * 全工具查岗白名单（查询/感知类全集；不动手类一概不进）。
 * 网页 7 项 + 真机 5 项——AI 工具箱里的全部「能查」工具都在这了。
 */
const SWEEP_ITEMS: SweepItem[] = [
  // ---- 网页工具（恒查；全部无必填参数，可盲调） ----
  { name: 'getWebState', label: '网页手机状态', timeoutMs: SWEEP_ITEM_TIMEOUT_MS },
  { name: 'getUsageStats', label: '今日各应用使用时长', timeoutMs: SWEEP_ITEM_TIMEOUT_MS },
  { name: 'getRecentApps', label: '最近用过/后台应用', timeoutMs: SWEEP_ITEM_TIMEOUT_MS },
  { name: 'getWebInstalledApps', label: '已安装应用清单与冻结状态', timeoutMs: SWEEP_ITEM_TIMEOUT_MS },
  { name: 'getCalendarEvents', label: '今日日程', timeoutMs: SWEEP_ITEM_TIMEOUT_MS },
  { name: 'getTodoList', label: '备忘录待办', timeoutMs: SWEEP_ITEM_TIMEOUT_MS },
  { name: 'queryWeather', label: '天气', timeoutMs: SWEEP_ITEM_TIMEOUT_MS },
  // ---- 真机工具（仅 senseMode='device'；经 Shizuku 读真实手机） ----
  { name: 'getForegroundApp', label: '真实手机前台应用', timeoutMs: SWEEP_ITEM_TIMEOUT_MS, device: true },
  { name: 'getNotifications', label: '真实手机通知栏', timeoutMs: SWEEP_ITEM_TIMEOUT_MS, device: true },
  { name: 'getBatteryStatus', label: '真实手机电量', timeoutMs: SWEEP_ITEM_TIMEOUT_MS, device: true },
  { name: 'getVolume', label: '真实手机音量', timeoutMs: SWEEP_ITEM_TIMEOUT_MS, device: true },
  { name: 'takeScreenshot', label: '真实手机截屏偷窥', timeoutMs: SWEEP_SCREENSHOT_TIMEOUT_MS, device: true },
];

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => window.setTimeout(() => rej(new Error('timeout')), ms))]);
}

/** sessionKey 形如 wx:<contactId> / qq:<contactId> / sms:c:<contactId>（与 web-tools 同构） */
function sessionKeyOf(app: 'wx' | 'qq' | 'sms', contactId: string): string {
  if (app === 'wx') return `wx:${contactId}`;
  if (app === 'qq') return `qq:${contactId}`;
  return `sms:c:${contactId}`;
}

const CAUSE_DESC: Record<SweepCause, string> = {
  trigger: '吃醋剧情刚被触发',
  watch: '暗中观察例行查岗',
  patrol: '锁定期间主动巡检',
  manual: '机主手动替你查了一次岗',
};

/**
 * 跑一轮全工具查岗：把白名单里的全部查询工具各真实执行一遍（并行、静默、容错），
 * 返回证据行数组。任何失败都不抛——查岗本身永远不能把吃醋决策链炸掉。
 */
export async function runJealousySweep(opts: JealousySweepOpts): Promise<JealousySweepResult> {
  const items = SWEEP_ITEMS.filter((it) => !it.device || opts.senseMode === 'device')
    // 截屏偷窥对齐 peekEnabled：设置里关了/未开启就不偷看
    .filter((it) => it.name !== 'takeScreenshot' || (opts.allowScreenshot === true));

  if (items.length === 0) {
    return { lines: [], calledTools: [], degrade: '（全工具查岗：无可用查询工具）' };
  }

  // 静默锚点：挂上会话上下文后 web-tools 的 island() 自动哑火（不弹灵动岛卡）；
  // sweep 不走 runPhoneToolRound，工具气泡天然不存在。查岗是暗中的。
  const sk = sessionKeyOf(opts.app, opts.contactId);
  const prevCtx = getToolSessionContext();
  setToolSessionContext(sk, opts.charName);

  try {
    const settled = await Promise.allSettled(
      items.map(async (it) => {
        const out = await withTimeout(execWebTool(it.name, {}), it.timeoutMs);
        return { it, out };
      }),
    );
    const lines: string[] = [];
    const calledTools: string[] = [];
    let okCount = 0;
    let failCount = 0;

    for (const r of settled) {
      if (r.status !== 'fulfilled') {
        failCount += 1;
        continue;
      }
      const { it, out } = r.value;
      if (out.startsWith('【成功】')) {
        okCount += 1;
        calledTools.push(it.name);
        // 去【成功】前缀 + 内层工具自带标题壳的残屑（如「】机主…」），只留正文
        const body = out.slice(3).replace(/^【[^】]*】?/, '').replace(/^[】\s]+/, '').trim();
        if (body) lines.push(`【${it.label}】${clip(body)}`);
      } else {
        failCount += 1;
        // 失败也留一行降级说明（真机工具在浏览器里跑会如实报不可用——这本身就是信息）
        const body = out.replace(/^【失败】/, '').replace(/^【[^】]*】?/, '').replace(/^[】\s]+/, '').trim();
        if (body) lines.push(`（${it.label}：${clip(body, 90)}）`);
      }
    }

    // 截断总长（防 token 膨胀）：逐行累加，超限即止
    const capped: string[] = [];
    let total = 0;
    for (const l of lines) {
      if (total + l.length > SWEEP_TOTAL_MAX) break;
      capped.push(l);
      total += l.length;
    }

    if (okCount === 0) {
      return {
        lines: capped,
        calledTools: [],
        degrade: `（全工具查岗全部降级：${failCount} 项工具无一成功——本轮看不到更多证据）`,
      };
    }
    return { lines: capped, calledTools: [...new Set(calledTools)], degrade: null };
  } catch {
    return { lines: [], calledTools: [], degrade: '（全工具查岗异常：本轮跳过）' };
  } finally {
    // 还原会话上下文（防串染后续真正的聊天工具轮）
    setToolSessionContext(prevCtx.sessionKey || '', prevCtx.charName || '');
  }
}

function clip(s: string, max = SWEEP_LINE_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * 证据块渲染（并入决策 LLM 的 user 段）：
 * 【你动用全部工具查到的证据】标题 + 逐行证据。全失败时只给降级说明。
 */
export function renderSweepBlock(res: JealousySweepResult, cause: SweepCause): string {
  if (res.lines.length === 0 && res.degrade) return res.degrade;
  if (res.lines.length === 0) return '';
  return [`【你动用全部工具查到的证据（${CAUSE_DESC[cause]}）】`, ...res.lines].join('\n');
}

/** sweep 结果摘要（lastIntel / 设置页手动查岗反馈用）：一句话 + 工具数 */
export function sweepBrief(res: JealousySweepResult): string {
  if (res.calledTools.length === 0) return res.degrade ?? '（全工具查岗：本轮无证据）';
  return `全工具查岗：动用 ${res.calledTools.length} 项工具查到 ${res.lines.length} 条证据`;
}

// ---------------- dev 测试钩子（仅 dev 生效；生产构建零暴露面） ----------------

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const w = window as typeof window & {
    __sweepTest?: { run: () => Promise<JealousySweepResult> };
  };
  w.__sweepTest = {
    run: () =>
      runJealousySweep({
        contactId: 'sweep-dev-test',
        app: 'sms',
        charName: '测试角色',
        cause: 'manual',
        senseMode: 'web',
      }),
  };
}
