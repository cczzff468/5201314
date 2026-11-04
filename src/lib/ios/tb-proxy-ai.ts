'use client';

/**
 * 淘宝代付 AI 自主决策（机主发起找人代付后，AI 好友按人设/记忆决定是否代付）：
 * 与美团 mt-ai-engage 的 runProxyDecision 同一套交互口径——延时数秒让角色「看到请求」，
 * LLM 结合人设/记忆/金额输出 {"pay":bool,"reply":"..."}；付了 → tbProxyPayOrder（deferCard，
 * 完成卡随回复投递）+ 记忆；婉拒 → tbDeclineProxy + 记忆；最后把完成卡/婉拒回复按
 * 主动消息管线投递（落库 + 灵动岛 + 未读角标）。
 * 可靠性：LLM 失败/空回自动重试（共 3 次尝试，间隔 1.5s），3 次全失败走本地兜底——
 * 直接帮付 + 兜底话术 + 记忆，保证代付请求不会永久 pending 无响应。
 */
import { kvGet, kvSet } from './idb-kv';
import { getContact, ownerProfileFor } from './contacts-store';
import { avatarFor, type ContactRecord } from '../contacts';
import { buildPersonaSystemPrompt } from './persona';
import { getMemSettings } from '@/lib/memory';
import { memChatRecallBlock, memAddEventFragment } from '@/lib/memory';
import { getTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { scheduleAiDelivery } from './ai-delivery';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { useSettings } from './store';
import { getActiveAccountIdFor, type AccountApp } from './accounts';
import { tbDeclineProxy, tbGetProxy, tbProxyPayOrder, tbProxyChannelName } from './tb-share-proxy';

const decisionInFlight = new Set<string>();

/** 机主发起找人代付后调用：延时让该 AI 角色「看到请求」并按人设/记忆决策是否代付 */
export function scheduleTbProxyAiDecision(pid: string): void {
  if (decisionInFlight.has(pid)) return;
  decisionInFlight.add(pid);
  const delay = 5200 + Math.floor(Math.random() * 6800);
  window.setTimeout(() => {
    void runProxyDecision(pid)
      .catch(() => undefined)
      .finally(() => decisionInFlight.delete(pid));
  }, delay);
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as unknown;
    if (j && typeof j === 'object') return j as Record<string, unknown>;
  } catch {
    /* 继续兜底 */
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as unknown;
      if (j && typeof j === 'object') return j as Record<string, unknown>;
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

export { extractJsonObject };

export async function callTbLlm(system: string, userContent: string): Promise<string> {
  const apiConfig = useSettings.getState().apiConfig;
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }], ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: apiConfig });
  } catch {
    raw = '';
  }
  if (!raw.trim()) {
    try {
      raw = await call({ forceSdk: true });
    } catch {
      raw = '';
    }
  }
  return raw;
}

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

interface ProxyDecision {
  pay: boolean;
  reply: string;
}

async function runProxyDecision(pid: string): Promise<void> {
  const p = tbGetProxy(pid);
  if (!p || p.status !== 'pending') return;
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(p.contactId);
  } catch {
    contact = null;
  }
  if (!contact || contact.kind === 'user') return;
  const app = p.idp;
  const sessionKey = `${app}:${contact.id}`;
  const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
  const meName = owner?.realName || p.fromName || '机主';

  const persona = buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : 'QQ',
    userName: owner?.realName || null,
    ownerName: owner?.realName || null,
    accountId: getActiveAccountIdFor(app as AccountApp),
    // 跨 App 身份与记忆感知（与美团代付决策同口径；按每联系人互通开关）
    multiApp: getMemSettings(contact.id).share,
  });
  const summary = p.items.map((i) => `${i.name}x${i.qty}`).join('、');
  const memoryBlock = memChatRecallBlock(contact.id, app, `淘宝 代付 购物 ${p.shopName} ${summary}`, {});
  const timeBlock = getTimeAware(sessionKey) ? buildTimeAwareBlock({ regionHint: contact.region || null }) : '';
  const system = [persona, memoryBlock, timeBlock].filter(Boolean).join('\n\n');

  const user = [
    `【刚收到的淘宝代付请求】\n${meName}（${p.fromName}）在淘宝「${p.shopName}」拍了：${summary}，共 ¥${fmt2(p.amount)}，想请你代付。30 分钟内不付款订单会自动取消。`,
    '【任务】结合你的人设、性格、你们的关系、上面的记忆和金额，决定要不要帮TA付这笔钱（演示语义，不会真花钱）。',
    '一般来说：关系亲近、金额不大、人设大方/爱请客/正好想宠TA → 可以付；人设节俭/关系一般/金额偏大/刚闹过矛盾 → 可以婉拒或调侃。两种选择都自然，没有标准答案。',
    '输出 JSON：{"pay":true或false,"reply":"无论付不付都要给对方的一句话回复（像平时聊天，1~2句；付了可以说已付+一句人设话，婉拒就自然说）"}',
    '严禁输出 JSON 以外的文字。',
  ].join('\n\n');

  // LLM 决策（后台链路自动重试：共 3 次尝试、间隔 1.5s）——解析成功且 reply 非空才落定；
  // 3 次全失败走本地兜底（直接帮付 + 兜底话术），保证请求不会永久 pending 无响应
  let parsed: Partial<ProxyDecision> | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let raw = '';
    try {
      raw = await callTbLlm(system, user);
    } catch {
      raw = '';
    }
    const j = extractJsonObject(raw) as Partial<ProxyDecision> | null;
    if (j && typeof j.reply === 'string' && j.reply.trim()) {
      parsed = j;
      break;
    }
    if (attempt < 2) await new Promise((r) => window.setTimeout(r, 1500));
  }
  const reply = (parsed?.reply ?? '').trim().replace(/^[「"'『]+|[」"'』]+$/g, '').split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';

  // 决策落定前复查状态（机主可能已取消/自己付了）
  const cur = tbGetProxy(pid);
  if (!cur || cur.status !== 'pending') return;

  if (!parsed || !reply) {
    // 兜底（对齐 runProactivePayEngage 的失败兜底模式）：LLM 3 次尝试全失败——本地直接帮付
    // + 一句兜底话术 + 记忆，机主一定能看到这次参与（这句兜底话术是后台链路最后的可靠性保障）
    const res = tbProxyPayOrder(pid, { deferCard: true });
    if (!res.ok || !res.card) return; // 订单已变化（取消/自付）→ B4 同步会把请求收敛为终态
    memAddEventFragment(
      contact.id,
      app,
      `机主${meName}在淘宝请你代付「${cur.shopName}」的订单（¥${fmt2(cur.amount)}，${cur.items.map((i) => `${i.name}x${i.qty}`).join('、')}），你用${tbProxyChannelName(app)}帮TA付了`,
      { eventTime: Date.now(), sourceTag: 'tb-proxy-pay' },
    );
    await deliverPeerMsgs(app, contact, [
      res.card,
      { id: `tbpxr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, role: 'peer', content: '看到你的代付请求了，我先帮你付上啦~', time: Date.now() + 1 },
    ]);
    return;
  }

  const now = Date.now();
  const outMsgs: { id: string; role: 'me' | 'peer'; content: string; time: number; kind?: 'tbpay'; tbpay?: { pid: string; role: 'req' | 'done' } }[] = [];
  if (parsed.pay === true) {
    const res = tbProxyPayOrder(pid, { deferCard: true });
    if (!res.ok || !res.card) return;
    outMsgs.push(res.card);
    const itemSummary = cur.items.map((i) => `${i.name}x${i.qty}`).join('、');
    memAddEventFragment(contact.id, app, `机主${meName}在淘宝请你代付「${cur.shopName}」的订单（¥${fmt2(cur.amount)}，${itemSummary}），你用${tbProxyChannelName(app)}帮TA付了`, { eventTime: now, sourceTag: 'tb-proxy-pay' });
  } else {
    // 婉拒 → 请求置 declined，请求卡同步变「对方婉拒了」（订单仍待付款，机主可自付/再找别人）
    tbDeclineProxy(pid, '对方婉拒了这次代付');
    memAddEventFragment(contact.id, app, `机主${meName}在淘宝请你代付「${cur.shopName}」的订单（¥${fmt2(cur.amount)}），你婉拒了`, { eventTime: now, sourceTag: 'tb-proxy-decline' });
  }
  outMsgs.push({ id: `tbpxr-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, role: 'peer', content: reply, time: now + 1 });

  await deliverPeerMsgs(app, contact, outMsgs);
}

/** 决策消息投递（落库 + 灵动岛通知 + 未读角标；与主动消息同管线）；tb-ai-engage 复用 */
export async function deliverPeerMsgs(app: 'wx' | 'qq', contact: ContactRecord, msgs: { id: string; role: 'me' | 'peer'; content: string; time: number; kind?: string; tbpay?: { pid: string; role: 'req' | 'done' } }[]): Promise<void> {
  const cid = contact.id;
  const sessionKey = `${app}:${cid}`;
  const notifyApp = app === 'wx' ? ('wechat' as const) : ('qq' as const);
  const { isProactiveChatActive } = await import('./proactive-msg');
  await scheduleAiDelivery<(typeof msgs)[number]>(
    sessionKey,
    msgs,
    (m) => {
      try {
        const key = `${app}-chat-msgs:${cid}`;
        const rawList = kvGet<unknown[]>(key);
        const list = Array.isArray(rawList) ? rawList : [];
        kvSet(key, [...list, m]); // 聊天记录不封顶（此前截 200 条会把旧记录挤丢）
      } catch {
        /* 落库失败静默 */
      }
      pushChatNotification({
        sessionKey,
        app: notifyApp,
        title: contact.name,
        avatar: avatarFor(contact, app),
        body: m.content,
        target: { app: notifyApp, contactId: cid },
      });
      if (!isProactiveChatActive(app, cid)) {
        if (app === 'wx') wxUnreads.bump(cid, 1);
        else qqUnreads.bump(cid, 1);
      }
    },
    { initialDelay: 0 },
  );
}
