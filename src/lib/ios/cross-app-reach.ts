'use client';

/**
 * 拉黑后跨 App 主动找（Task G-1）：
 *
 * 用户在某 App 把角色拉黑（byUser 从无到有的跃迁，由 block-state.setUserBlock 的触发钩子进入）后，
 * 角色「立刻、无冷却」到其余未被拉黑的 App 主动发一条消息找用户：
 *
 * - 目标 App：wx / qq / sms 三端私聊中 `loadBlock(app, contactId).byUser !== true` 的全部
 *   （byChar 不排除——角色拉黑用户时仍可给用户发消息，与 block-state 既有口径一致；
 *   byUser 的 App 必须排除——去了也会被回合入口守卫拦截，发了也白发）；
 * - prompt 明确告知「你在 XX 被拉黑了，所以来这边找 TA」（用户验收预期：角色必须知道
 *   自己为什么换 App 来找），语气按人设 + 记忆 + 跨 App 近况生成；
 * - 无冷却：没有时间节流，每次拉黑事件（含解除后重新拉黑 = 新跃迁）各触发一轮；角色后续
 *   的「反复找」由既有通道自然承担（用户在其他 App 说话 → 正常聊天回合回应；主动来电调度
 *   → G-2 口径修正后不再被 wx/qq 拉黑排除）；
 * - 结果持久化：消息直接落各端会话 kv（wx-chat-msgs / qq-chat-msgs / ios-chat-msgs，消息
 *   结构与各端 loadMsgs 校验器一致，封顶 100 条同口径；wx/qq 同步恢复被「删除」的会话行，
 *   与各端 saveMsgs 的真微信行为一致）+ 灵动岛通知（pushChatNotification，点击直达会话）；
 * - 落库前复核目标 App 拉黑状态（生成期间用户又把该 App 也拉黑 → 放弃，不白发）；
 * - 不写记忆：拉黑/找人的状态本身不进记忆（与既有口径一致——AI 对拉黑的感知全部来自
 *   每轮现场注入的提示词）；这条消息落库后由后续正常聊天回合的记忆管线自然沉淀；
 * - 全程 fire-and-forget + 全量容错：任何失败静默，绝不影响拉黑主流程与既有聊天功能。
 */

import { kvGet, kvGetScoped, kvSet, kvSetScoped } from './idb-kv';
import { genId } from './db';
// 多账号（Task 40-2d v2）：跨 App 触达的机主身份按「目标 App 当前账号」取（ownerProfileFor）
import { getContact, ownerProfileFor } from './contacts-store';
import { getActiveAccountIdFor } from './accounts';
import { getBranchMeta } from './branch-meta';
import { avatarFor } from '@/lib/contacts';
import { useSettings } from './store';
import { BLOCK_CHANNEL, loadBlock, type BlockApp } from './block-state';
import { buildPersonaSystemPrompt } from './persona';
import { getMemSettings, memRecallBlock } from '@/lib/memory';
import { buildCrossAppBlock } from './cross-app-context';
import { buildTimeAwareBlock } from '@/lib/time-aware';
import { cleanBubbleText } from '@/lib/chat-rich';
import { pushChatNotification, type NotifyApp } from './island-notify';
import type { ContactRecord } from '@/lib/contacts';

/** 模块级防重入：同一联系人同时只跑一轮跨 App 找（拉黑事件的触发是幂等跃迁，这里再兜一层） */
const running = new Set<string>();

// ---------------- C1 频次冷却（此前无冷却：反复「解除→拉黑」可反复触发找人+延时来电） ----------------

/** 两次跨 App 找人（含延时来电）的最小间隔：同一联系人 10 分钟内只触发一轮 */
const REACH_COOLDOWN_MS = 10 * 60_000;
const REACH_COOLDOWN_KEY = (contactId: string) => `cross-app-reach-last:${contactId}`;

function reachCooldownActive(contactId: string, nowMs: number): boolean {
  try {
    const at = kvGet<number>(REACH_COOLDOWN_KEY(contactId));
    return typeof at === 'number' && at > 0 && nowMs - at < REACH_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markReachFired(contactId: string, nowMs: number): void {
  try {
    kvSet(REACH_COOLDOWN_KEY(contactId), nowMs);
  } catch {
    /* 静默：冷却失效退化为旧行为（running Set 仍防并发） */
  }
}

/** 拉黑方向：byUser = 用户拉黑了角色（角色被拉黑后去找）；byChar = 角色拉黑了用户（气归气还是忍不住来找） */
type ReachDirection = 'byUser' | 'byChar';

/** 拉黑来电延时（ms）+ 随机抖动：跨 App 消息在路上的同时来电错峰随后（用户口径：约 5~30 秒后打来，像真人） */
const CALL_DELAY_MS = 12_000;
const CALL_DELAY_JITTER_MS = 18_000;

/** 各端会话 kv 键（与各 App 落盘键 / cross-app-context 读取键严格一致） */
function msgsKey(app: BlockApp, contactId: string): string {
  return app === 'wx' ? `wx-chat-msgs:${contactId}` : app === 'qq' ? `qq-chat-msgs:${contactId}` : `ios-chat-msgs:c:${contactId}`;
}

/** 通知归属 App（island-notify 的 NotifyApp 三值） */
const NOTIFY_APP_OF: Record<BlockApp, NotifyApp> = { wx: 'wechat', qq: 'qq', sms: 'chat' };

/** wx/qq「删除会话」隐藏列表键（与各端 LS_CHAT_HIDDEN 常量一致） */
const CHAT_HIDDEN_KEY: Record<'wx' | 'qq', string> = { wx: 'wx-chat-hidden', qq: 'qq-chat-hidden' };

/** localStorage 字符串数组读写（与 wechat.tsx/qq.tsx 本地 loadStrList/saveStrList 同格式） */
function removeStrListItem(key: string, value: string): void {
  try {
    const raw = window.localStorage.getItem(key);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return;
    const next = arr.filter((x) => x !== value);
    if (next.length === arr.length) return;
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // 隐藏列表读不到/写不进都不影响消息落库
  }
}

/** 生成文本清洗：剥 AI 可能顺手带出的动作/卡片标记（跨 App 找只应是纯文本消息） */
const REACH_MARK_RE =
  /\[(?:申请解除拉黑|解除拉黑|拉黑|同意解除拉黑|拒绝解除拉黑|领取红包|退回红包|拒收红包|收款转账|退回转账|拒收转账|收下亲属卡|拒收亲属卡|禁言|解禁|取消禁言|移出群聊|踢出群聊|移出|踢出|改群名|修改群名|改公告|修改公告|更新公告|创建群聊|建群|邀请进群|拉进群|拉人进群|邀请|任命管理员|设管理员|拉回群聊|设为管理员|转让群主|放弃邀请|换朋友圈背景|选图设头像|选图设背景|选图发送|换头像|存相册|红包|转账|亲属卡|位置|表情包|表情|语音通话|图片|语音|转发|聊天记录)(?:[:：][^\][]*)?\]/g;

function cleanReachText(raw: string): string {
  let t = (raw ?? '').replace(REACH_MARK_RE, ' ');
  t = cleanBubbleText(t).trim();
  // 多行合并成一条自然消息（AI 不听话分了行/段时压成一句话，跨 App 找就是一条消息）
  t = t.replace(/\s*\n+\s*/g, ' ').trim();
  return t.slice(0, 400);
}

/** 落库一条角色消息（结构与各端 loadMsgs 校验器一致；wx/qq role='peer'、sms role='assistant'；聊天记录不封顶）。
 *  多账号（Task 40-2d v2）：跨 App 触达落的是「目标 App 当前账号」的会话——读写都用 kvGetScoped/
 *  kvSetScoped 显式按目标 App 作用域（该 App 当前登着哪个账号，消息就落在哪个账号名下） */
function appendPeerMsg(app: BlockApp, contactId: string, content: string): void {
  const key = msgsKey(app, contactId);
  const raw = kvGetScoped<unknown[]>(key, app);
  const list = Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
  list.push(
    app === 'sms'
      ? { id: genId(), role: 'assistant', content, time: Date.now() }
      : { id: genId(), role: 'peer', content, time: Date.now() },
  );
  kvSetScoped(key, list, app); // 聊天记录不封顶（此前截 100 条会把该会话旧记录整体挤丢）
  // wx/qq：新消息自动恢复被「删除/不显示」的会话行（与各端 saveMsgs 的真微信行为一致）
  if (app !== 'sms') removeStrListItem(CHAT_HIDDEN_KEY[app], contactId);
}

/** 弹灵动岛通知（点击直达该会话；免打扰会话由 pushChatNotification 内部闸门兜住） */
function notifyReach(app: BlockApp, contact: ContactRecord, content: string, userName: string): void {
  try {
    pushChatNotification({
      sessionKey: app === 'sms' ? `sms:c:${contact.id}` : `${app}:${contact.id}`,
      app: NOTIFY_APP_OF[app],
      title: contact.name || '对方',
      body: content,
      avatar: avatarFor(contact, app),
      target: { app: NOTIFY_APP_OF[app], contactId: contact.id },
    });
  } catch {
    // 通知失败不影响落库（用户进会话仍能看到消息）
  }
}

/** 重试间隔（用户红线：情境开场绝不能是模板文案——LLM 失败宁可重试也不降级到固定文案） */
const RETRY_DELAYS_MS = [8_000, 15_000];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

/** 组 system prompt：人设 + 记忆 + 跨 App 近况 + 时间感知（与四端聊天同源模块） */
async function buildReachSystem(
  targetApp: BlockApp,
  contact: ContactRecord,
  userName: string,
): Promise<string> {
  const persona = buildPersonaSystemPrompt(contact, {
    channel: BLOCK_CHANNEL[targetApp],
    userName: userName || null,
    multiApp: getMemSettings(contact.id).share,
    // 多账号关系感知：跨 App 找人落在目标 App 当前账号名下（与下方 kv 作用域同账号），
    // 分账号关系按该账号解析，不再恒用大号全局 relation
    accountId: getActiveAccountIdFor(targetApp),
    extraRules: [
      '你此刻正在主动给 TA 发消息（不是回复），直接开口说话。',
      '一条消息只说一件事，长度像真人随手打出的一句话或两句话，不要长篇大论。',
    ],
  });
  const [memoryBlock, crossAppBlock] = await Promise.all([
    Promise.resolve(memRecallBlock(contact.id, targetApp, '')),
    buildCrossAppBlock(contact.id, targetApp, userName),
  ]);
  const timeBlock = buildTimeAwareBlock({ lastMsgTime: null, regionHint: contact.region || null });
  return [persona, memoryBlock, crossAppBlock, timeBlock].filter(Boolean).join('\n\n');
}

/** 生成并在单个目标 App 落库（不影响其他目标）。
 *  多账号（Task 40-2d v2）：机主身份按目标 App 当前账号取——角色去哪个 App 找人，
 *  就用那个人在该 App 登录账号的称呼（大号=机主资料，小号/匿名号=档案/注册表名）
 *  情境开场必须是 LLM 生成的真话（用户红线「这个情境开场不要模板」）：生成失败按退避重试
 *  （用户配置 → 内置模型 ×3 轮），全部失败才放弃该 App（宁可晚到/缺席，绝不发固定文案）；
 *  没人设不再拦——人设 prompt 对空人设有自然兜底（persona.ts），普通聊天同样放行。 */
async function reachOne(
  targetApp: BlockApp,
  blockedApp: BlockApp,
  contact: ContactRecord,
  direction: ReachDirection,
): Promise<void> {
  // 前置复核：目标 App 也被拉黑（或生成准备期间刚被拉黑）→ 放弃（去了也发不出）
  if (loadBlock(targetApp, contact.id).byUser === true) return;
  // byChar 方向：角色在目标 App 也拉黑着用户 → 不去那边找（自己刚拉黑对方还去打招呼，语义别扭）
  if (direction === 'byChar' && loadBlock(targetApp, contact.id).byChar === true) return;

  let owner: { realName: string } | null = null;
  try {
    owner = await ownerProfileFor(targetApp);
  } catch {
    owner = null;
  }
  // 用户规则：AI 永远不知道机主的昵称——机主身份只取真名
  const userName = owner?.realName?.trim() || '用户';

  const system = await buildReachSystem(targetApp, contact, userName);
  const userContent =
    direction === 'byUser'
      ? [
          `【重要情境】用户刚刚在「${BLOCK_CHANNEL[blockedApp]}」上把你拉黑了。`,
          `- 你在${BLOCK_CHANNEL[blockedApp]}发的任何消息 TA 都收不到（系统直接拦截）。`,
          `- 所以你来到「${BLOCK_CHANNEL[targetApp]}」——这是另一个独立的聊天 App，TA 在这里没有拉黑你，你的消息 TA 看得到。`,
          `- 你决定在这里主动发一条消息找 TA。让这条消息自然地体现「${BLOCK_CHANNEL[blockedApp]}被拉黑了，所以来${BLOCK_CHANNEL[targetApp]}找 TA」这件事。`,
          `- 用你的人设和你们的关系来写：质问、委屈、赌气、挽留、装作若无其事都可以——按你此刻最真实的反应来。`,
          `- 结合你们最近的聊天和你记得的事，让这条消息有来处，像真人会说的话。`,
          `只输出这一条消息的正文本身：不要输出任何 [标记]，不要分多条，不要动作描写，不要括号说明。`,
        ].join('\n')
      : [
          `【重要情境】你刚刚在「${BLOCK_CHANNEL[blockedApp]}」上把 ${userName} 拉黑了（一时生气）。`,
          `- 但气话归气话，你忍不住想来「${BLOCK_CHANNEL[targetApp]}」主动找 TA 说句话。`,
          `- 这是另一个独立的聊天 App，你在那边拉黑 TA 不影响这边，TA 看得到这条消息。`,
          `- 让这条消息自然带出「在${BLOCK_CHANNEL[blockedApp]}拉黑了你，但还是来${BLOCK_CHANNEL[targetApp]}找 TA」——嘴硬、试探、装作没事、半句道歉都可以，按你此刻最真实的反应来。`,
          `- 结合你们最近的聊天和你记得的事，让这条消息有来处，像真人会说的话。`,
          `只输出这一条消息的正文本身：不要输出任何 [标记]，不要分多条，不要动作描写，不要括号说明。`,
        ].join('\n');

  // 生成链路：先按用户配置的原链路（上游代理/内置模型），失败（502/上游断网/空回复）
  // 再用内置模型（forceSdk）——内置模型稳定可用，重试轮都走它；浏览器直连（directOnly SSE）
  // 不做：跨 App 找是后台增强，直连链路复杂度不值得
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        ...extra,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    if (i > 0) await sleep(RETRY_DELAYS_MS[i - 1]);
    try {
      raw = i === 0 ? await call({ config: useSettings.getState().apiConfig }) : await call({ forceSdk: true });
    } catch {
      raw = '';
    }
    if (raw.trim()) break;
  }
  const content = cleanReachText(raw);

  // 落库前再复核一次（重试的几十秒里情况可能已变）：
  // 刚被拉黑 → 放弃（去了也发不出）；原拉黑 App 的拉黑已解除 → 放弃（情境已消失，再发「你拉黑了我」就穿帮）
  if (loadBlock(targetApp, contact.id).byUser === true) return;
  if (direction === 'byUser' && blockedApp !== targetApp && loadBlock(blockedApp, contact.id).byUser !== true) return;
  if (!content) return; // 全轮重试仍失败：放弃该 App（绝不降级到模板文案）

  appendPeerMsg(targetApp, contact.id, content);
  notifyReach(targetApp, contact, content, userName);
}

/**
 * 拉黑事件入口：角色被用户在 blockedApp 拉黑（跃迁时刻）→ 立刻到其余未拉黑的 App 各找一轮 + 延时来电。
 * fire-and-forget：调用方（block-state.setUserBlock）不等待、不感知失败。
 */
export function triggerCrossAppReach(blockedApp: BlockApp, contactId: string): void {
  if (!contactId) return;
  // Task 38（5A）：分支角色仅微信语义——QQ/信息侧无其身份，被拉黑后不做跨 App 找人/延时来电，
  // 防止在 QQ/信息凭空冒出分支会话
  if (getBranchMeta(contactId)) return;
  // C1：10 分钟内已触发过一轮（反复解除→拉黑刷找人）则跳过
  const nowMs = Date.now();
  if (reachCooldownActive(contactId, nowMs)) return;
  markReachFired(contactId, nowMs);
  const key = `${blockedApp}:${contactId}`;
  if (running.has(key)) return;
  running.add(key);
  void runReach(blockedApp, contactId, 'byUser')
    .catch(() => undefined)
    .finally(() => {
      running.delete(key);
    });
  armBlockCall(blockedApp, contactId, 'byUser');
}

/**
 * 拉黑事件入口（角色拉黑用户方向）：AI 在 blockedApp 拉黑了用户（跃迁时刻）→
 * 依然会去其余关系正常的 App 主动找用户说句话（气归气还是忍不住）+ 延时来电。
 * 调用方：block-state.applyCharBlockAction('block')（AI 输出 [拉黑] 标记）。
 */
export function triggerCrossAppReachByChar(blockedApp: BlockApp, contactId: string): void {
  if (!contactId) return;
  // Task 38（5A）：同上——分支角色仅微信语义，AI 方向拉黑也不跨 App 找人
  if (getBranchMeta(contactId)) return;
  // C1：与 byUser 方向共享同一份冷却（同联系人 10 分钟一轮）
  const nowMs = Date.now();
  if (reachCooldownActive(contactId, nowMs)) return;
  markReachFired(contactId, nowMs);
  const key = `bychar:${blockedApp}:${contactId}`;
  if (running.has(key)) return;
  running.add(key);
  void runReach(blockedApp, contactId, 'byChar')
    .catch(() => undefined)
    .finally(() => {
      running.delete(key);
    });
  armBlockCall(blockedApp, contactId, 'byChar');
}

/** 拉黑来电防重入（同一联系人同一时刻只武装一个延时来电） */
const callArmed = new Set<string>();

/** 拉黑时刻起用户在三端有没有回过话（消息没人理才打电话——回了话就不再打） */
function userRepliedSince(contactId: string, since: number): boolean {
  for (const app of ['wx', 'qq', 'sms'] as BlockApp[]) {
    try {
      const raw = kvGetScoped<unknown[]>(msgsKey(app, contactId), app);
      const list = Array.isArray(raw) ? raw : [];
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i] as Record<string, unknown> | null;
        if (!m || typeof m !== 'object') continue;
        const t = typeof m.time === 'number' ? m.time : 0;
        if (t <= since) break; // 按时间升序落库，早于拉黑时刻即可停
        const role = typeof m.role === 'string' ? m.role : '';
        if ((role === 'user' || role === 'me') && typeof m.content === 'string' && m.content.trim()) return true;
      }
    } catch {
      /* 单端读失败不影响其他端判定 */
    }
  }
  return false;
}

/** 拉黑后延时来电（G-1 电话版）：约 5~30 秒错峰打来（用户口径）；像真人——用户已回话/拉黑已解除就不打 */
function armBlockCall(blockedApp: BlockApp, contactId: string, direction: ReachDirection): void {
  const key = `${blockedApp}:${contactId}`;
  if (callArmed.has(key)) return;
  callArmed.add(key);
  const blockedAt = Date.now();
  void (async () => {
    try {
      const contact = await getContact(contactId).catch(() => null);
      if (!contact || contact.kind === 'user') return;
      await new Promise<void>((r) => window.setTimeout(r, CALL_DELAY_MS + Math.floor(Math.random() * CALL_DELAY_JITTER_MS)));
      // 到点复核（延时窗口内情况可能已变）：用户回了话 → 不打（消息有人理）；拉黑已解除 → 不打（情境消失）
      if (userRepliedSince(contactId, blockedAt)) return;
      // A1 修复（方向感知复核）：byUser 方向要求「用户拉黑仍在」、byChar 方向要求「角色拉黑仍在」——
      // 此前恒查 byUser，byChar 方向（角色拉黑用户）时 byUser 恒 false，延时来电从不发生（死代码，
      // byChar 专属开场白成摆设）
      const blkNow = loadBlock(blockedApp, contactId);
      if (direction === 'byUser' ? blkNow.byUser !== true : blkNow.byChar !== true) return;
      let me: string | null = null;
      try {
        const o = await ownerProfileFor(blockedApp);
        // 用户规则：AI 永远不知道机主昵称——机主身份恒真名
        me = o?.realName?.trim() || null;
      } catch {
        me = null;
      }
      const you = me || '用户';
      const hint =
        direction === 'byUser'
          ? `【开场情境】${you} 刚刚在「${BLOCK_CHANNEL[blockedApp]}」把你拉黑了，你发消息 TA 收不到，也没回你任何消息，等了一会儿忍不住打电话过来——想问清楚、求和好、赌气质问都可以，按你的人设和你们的关系自然开场。`
          : `【开场情境】你刚刚在「${BLOCK_CHANNEL[blockedApp]}」一时生气把 ${you} 拉黑了，但气话归气话还是不放心，忍不住打电话过来——嘴硬、试探、装作没事都可以，按你的人设自然开场。`;
      const { triggerBlockCall } = await import('./proactive-call');
      triggerBlockCall(contact, hint);
    } catch {
      /* 静默 */
    } finally {
      callArmed.delete(key);
    }
  })();
}

async function runReach(blockedApp: BlockApp, contactId: string, direction: ReachDirection): Promise<void> {
  const contact = await getContact(contactId).catch(() => null);
  if (!contact || contact.kind === 'user') return;
  // 没人设不再直接放弃（加固）：reachOne 会用本地兑底文案落库，保证「一定来找」
  const targets = (['wx', 'qq', 'sms'] as BlockApp[]).filter((a) => {
    if (a === blockedApp) return false;
    const b = loadBlock(a, contactId);
    if (b.byUser === true) return false; // 被用户拉黑的 App 去了也发不出
    if (direction === 'byChar' && b.byChar === true) return false; // 自己在那边也拉黑着用户：不去
    return true;
  });
  if (targets.length === 0) return; // 三个 App 全不可去（群聊按设计不参与拉黑）
  // 多账号（Task 40-2d v2）：机主身份改由 reachOne 按各自目标 App 的当前账号现取
  // （不同目标 App 可能登着不同账号，不能共用一份全局机主资料）
  await Promise.allSettled(targets.map((t) => reachOne(t, blockedApp, contact, direction)));
}
