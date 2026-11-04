'use client';

/**
 * 恋爱水平考试分享（第十五轮）——考试 ⇄ 微信/QQ 聊天卡片流。
 *
 * 用户规格：
 * - 我可以喊 TA 来答题：把当前试卷以卡片发进会话，TA（AI）延时认真作答并自评分；
 * - TA 也会自己出卷喊我来答：TA 的卡片点进来直达情侣空间的试卷答题页；
 * 复用 couple-pact-share 的成熟管线（落库 + 广播 + 通知 + 导航事件）。
 */

import { kvGet, kvGetScoped, kvSet, kvSetScoped } from './idb-kv';
import { genId } from './db';
import { getContact } from './contacts-store';
import { avatarFor, displayNameOf } from '@/lib/contacts';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { isProactiveChatActive } from './proactive-msg';
import { COUPLE_CARD_EVENT, dispatchStateEvent, readInviteMeta, type CoupleChannel } from './couple-invite';

// ---------------- 类型 ----------------

/** 恋爱考试卡片数据（挂在消息 examcard 字段；微信/QQ 聊天共用） */
export interface CoupleExamCardData {
  title: string; // 试卷名
  count: number; // 题数
  from: 'me' | 'ta'; // 谁发起（我喊TA答 / TA喊我答）
  fromName: string;
  toName: string;
  app: CoupleChannel;
  contactId: string;
  status?: 'open' | 'done'; // 第十七轮：open=待答 done=已答完（卡片动态更新，点击直达结果）
  at: number;
}

/** 点击卡片后的待打开考试（ExamPage 消费） */
interface PendingExamOpen {
  from: 'me' | 'ta';
  title?: string; // 卡片里的试卷名（区分多张卷子）
  at: number;
}

let pendingExamOpen: PendingExamOpen | null = null;

/** 聊天考试卡片点击 → 写待打开目标（切换 App 时带上） */
export function setPendingExamOpen(from: 'me' | 'ta', title?: string): void {
  pendingExamOpen = { from, title, at: Date.now() };
}

/** ExamPage 挂载时消费待打开目标（读后即清） */
export function consumePendingExamOpen(): PendingExamOpen | null {
  const p = pendingExamOpen && Date.now() - pendingExamOpen.at < 60_000 ? pendingExamOpen : null;
  pendingExamOpen = null;
  return p;
}

/** 供测试/兜底：读当前待打开考试（不清除） */
export function peekPendingExamOpen(): PendingExamOpen | null {
  return pendingExamOpen;
}

// ---------------- 消息落库（与 couple-pact-share 同款管线） ----------------

function msgsKey(channel: CoupleChannel, contactId: string): string {
  return `${channel}-chat-msgs:${contactId}`;
}

/** 恢复被「删除/不显示」的会话行 */
function restoreHiddenChat(channel: CoupleChannel, contactId: string): void {
  try {
    const key = channel === 'wx' ? 'wx-chat-hidden' : 'qq-chat-hidden';
    const raw = window.localStorage.getItem(key);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return;
    const next = arr.filter((x) => x !== contactId);
    if (next.length === arr.length) return;
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* 隐藏列表读不到/写不进都不影响消息落库 */
  }
}

/** 灵动岛通知 + 未读角标 */
async function notifyCard(channel: CoupleChannel, contactId: string, body: string): Promise<void> {
  try {
    const c = await getContact(contactId);
    if (!c) return;
    const notifyApp = channel === 'wx' ? ('wechat' as const) : ('qq' as const);
    pushChatNotification({
      sessionKey: `${channel}:${contactId}`,
      app: notifyApp,
      title: displayNameOf(c),
      avatar: avatarFor(c, channel),
      body,
      target: { app: notifyApp, contactId },
    });
    if (!isProactiveChatActive(channel, contactId)) {
      (channel === 'wx' ? wxUnreads : qqUnreads).bump(contactId, 1);
    }
  } catch {
    /* 通知失败静默 */
  }
}

/**
 * 把一场恋爱水平考试以卡片形式发进微信/QQ 会话。
 * dir='me'：我喊 TA 来答题（卡片 role='me'，随后 AI 延时作答）；
 * dir='ta'：TA（AI）出卷喊我来答（卡片 role='peer'，点击直达答题页）。
 */
export async function sendExamCard(opts: { channel: CoupleChannel; contactId: string; title: string; count: number; dir: 'me' | 'ta' }): Promise<void> {
  const { channel, contactId, title, count, dir } = opts;
  if (!contactId || !title) return;
  let meName = '我';
  let taName = 'TA';
  try {
    const c = await getContact(contactId);
    if (c) taName = displayNameOf(c) || c.name || 'TA';
  } catch {
    /* 静默 */
  }
  try {
    const snap = kvGet<Record<string, unknown>>('couple-space:state') ?? {};
    if (dir === 'me' && typeof snap.meName === 'string' && snap.meName.trim()) meName = snap.meName.trim();
    if (dir === 'me' && typeof snap.taName === 'string' && snap.taName.trim()) taName = snap.taName.trim();
    if (dir === 'ta' && typeof snap.taName === 'string' && snap.taName.trim()) taName = snap.taName.trim();
    if (dir === 'ta' && typeof snap.meName === 'string' && snap.meName.trim()) meName = snap.meName.trim();
  } catch {
    /* 静默 */
  }
  const data: CoupleExamCardData = {
    title,
    count: Math.max(1, count || 1),
    from: dir,
    fromName: dir === 'me' ? meName : taName,
    toName: dir === 'me' ? taName : meName,
    app: channel,
    contactId,
    at: Date.now(),
  };
  const msg = {
    id: genId(),
    role: dir === 'me' ? 'me' : 'peer',
    content: '',
    time: Date.now(),
    kind: 'examcard',
    examcard: data,
  };
  const key = msgsKey(channel, contactId);
  try {
    const raw = kvGetScoped<unknown[]>(key, channel);
    const list = Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
    list.push(msg);
    kvSetScoped(key, list, channel);
  } catch {
    /* 落库失败静默 */
  }
  restoreHiddenChat(channel, contactId);
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid: contactId, app: channel } }));
  } catch {
    /* 广播失败不影响落库 */
  }
  const preview = dir === 'me' ? `我喊你来答题！《${title}》共 ${count} 题，看你能得多少分` : `我出了张卷子《${title}》，点进来答，考考你`;
  void notifyCard(channel, contactId, preview);
}

// ---------------- 导航（卡片点击 → 情侣空间考试页） ----------------

/** 聊天考试卡片点击后的导航事件名（CoupleSpaceApp 监听 → openSub('exam')） */
export const COUPLE_EXAM_NAV_EVENT = 'couple-exam-nav';

/**
 * 聊天里的考试卡片被点击：记下待打开目标 + 切进情侣空间 + 广播导航事件。
 * （ExamPage 挂载后 consumePendingExamOpen 直达对应答题/成绩/答卷界面；已答完的卡点进去是结果页）
 */
export function navToExam(from: 'me' | 'ta', title?: string): void {
  setPendingExamOpen(from, title);
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_EXAM_NAV_EVENT, { detail: { from, title } }));
  } catch {
    /* 非浏览器环境忽略 */
  }
}

/**
 * 按条件批量更新会话里的考试卡片状态（第十七轮：答完 → 卡片回写「已答完」，点击直达结果页）。
 * 返回命中的条数；有命中才落库 + 广播刷新。
 */
export function patchExamCardsWhere(channel: CoupleChannel, contactId: string, match: (d: CoupleExamCardData) => boolean, patch: Partial<CoupleExamCardData>): number {
  const key = msgsKey(channel, contactId);
  let hit = 0;
  try {
    const raw = kvGetScoped<unknown[]>(key, channel);
    if (!Array.isArray(raw)) return 0;
    const list = raw.map((m) => {
      const x = m as { examcard?: unknown };
      if (x && x.examcard && typeof x.examcard === 'object') {
        const d = x.examcard as CoupleExamCardData;
        if (match(d)) {
          hit++;
          return { ...x, examcard: { ...d, ...patch } };
        }
      }
      return m;
    });
    if (hit > 0) kvSetScoped(key, list, channel);
  } catch {
    /* 落库失败静默 */
  }
  if (hit > 0) {
    try {
      window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid: contactId, app: channel } }));
    } catch {
      /* 广播失败不影响 */
    }
  }
  return hit;
}

// ---------------- 我喊 TA 答卷 → TA 延时作答 ----------------

/**
 * 我把卷子分享给 AI 后：TA 延时认真作答（人设 + 记忆）。
 * 第十七轮：TA 只作答交卷，不给自己打分也不写评语——打分和批语由我来给；卡片同步回写「已答完」。
 */
export function scheduleAiExamAnswer(opts: { channel: CoupleChannel; contactId: string; title: string; questions: { q: string; opts: string[] }[] }): void {
  const meta = readInviteMeta();
  if (meta.partnerContactId !== opts.contactId) return; // 只对恋人联系人生效
  window.setTimeout(() => {
    void (async () => {
      try {
        const { aiExamSheet, coupleRemember, aiExamSubmitSay } = await import('./couple-ai');
        const r = await aiExamSheet(opts.title, opts.questions);
        if (!r) return;
        // 第二十四轮：交卷的话由 AI 按人设+记忆+上下文现说（失败就不发文字，只发通知）*/
        const say = await aiExamSubmitSay(opts.title, opts.questions.length);
        // 写进情侣空间状态（TA 的答卷；无自评分/评语，等我批改）
        let taN = 'TA';
        let meN = '我';
        try {
          const s = kvGet<Record<string, unknown>>('couple-space:state') ?? {};
          if (typeof s.taName === 'string' && s.taName.trim()) taN = s.taName.trim();
          if (typeof s.meName === 'string' && s.meName.trim()) meN = s.meName.trim();
          kvSet('couple-space:state', { ...s, examTaSheet: { title: opts.title, picks: r.picks, at: Date.now() } });
          dispatchStateEvent();
        } catch {
          /* 状态落盘失败静默 */
        }
        // 聊天里的考试卡片回写「已答完」（点卡片直达 TA 的答卷/批改页）
        patchExamCardsWhere(opts.channel, opts.contactId, (d) => d.from === 'me' && d.status !== 'done' && d.title === opts.title, { status: 'done' });
        // TA 的交卷消息落到会话（AI 现说的；不说自己答得怎样，等我批）
        if (say) {
          const key = msgsKey(opts.channel, opts.contactId);
          try {
            const raw = kvGetScoped<unknown[]>(key, opts.channel);
            const list = Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
            list.push({
              id: genId(),
              role: 'peer',
              content: say,
              time: Date.now(),
            });
            kvSetScoped(key, list, opts.channel);
          } catch {
            /* 静默 */
          }
          try {
            window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid: opts.contactId, app: opts.channel } }));
          } catch {
            /* 静默 */
          }
          void notifyCard(opts.channel, opts.contactId, say.slice(0, 40));
        }
        coupleRemember(opts.contactId, opts.channel, `${taN}答完了${meN}出的恋爱考试卷《${opts.title}》并交卷，等${meN}批改打分（${taN}还没看到成绩）`);
      } catch {
        /* AI 作答失败静默 */
      }
    })();
  }, 6000 + Math.random() * 7000);
}

/**
 * 第十七轮：我给 TA 的答卷批改（打分 + 批语）后，TA 在「我的批改」下面留一条感想
 * （写进 examTaSheet.taReply + 恋人记忆；延时 3~7s 像真人看完批语再回）。
 */
export function scheduleTaReact(opts: { channel: CoupleChannel; contactId: string; title: string; score: number; comment: string }): void {
  const meta = readInviteMeta();
  if (meta.partnerContactId !== opts.contactId) return; // 只对恋人联系人生效
  window.setTimeout(() => {
    void (async () => {
      try {
        const { aiExamTaReact, coupleRemember } = await import('./couple-ai');
        const text = await aiExamTaReact(opts.title, opts.score, opts.comment);
        if (!text) return;
        let taN = 'TA';
        let meN = '我';
        try {
          const s = kvGet<Record<string, unknown>>('couple-space:state') ?? {};
          if (typeof s.taName === 'string' && s.taName.trim()) taN = s.taName.trim();
          if (typeof s.meName === 'string' && s.meName.trim()) meN = s.meName.trim();
          const sheet = s.examTaSheet as { title?: string } | null | undefined;
          if (sheet && sheet.title === opts.title) {
            kvSet('couple-space:state', { ...s, examTaSheet: { ...sheet, taReply: text } });
            dispatchStateEvent();
          }
        } catch {
          /* 状态落盘失败静默 */
        }
        try {
          coupleRemember(opts.contactId, opts.channel, `${meN}批改后，${taN}在批语下面留言：「${text.slice(0, 40)}」（${taN}知道自己被批了多少分和批语内容）`);
        } catch {
          /* 静默 */
        }
      } catch {
        /* AI 留言失败静默 */
      }
    })();
  }, 3200 + Math.random() * 4200);
}
