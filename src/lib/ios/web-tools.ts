'use client';

/**
 * Web 生态内部工具层（v1.9.35 机主重构令：「智能体工作流全面转入 Web 网页生态」）。
 *
 * 真机底层已全面原生化（v2.0.0：无障碍服务 + 原生 API，经 device-ops 作用于真实手机）；
 * 网页生态的所有 App 都活在本项目的虚拟手机网页里，AI 调用这里的内部 Web 路由函数：
 *
 *  - sendWebMessage(appName, contactName, content)：在网页微信/QQ/信息里替机主发消息
 *  - postForum(topic, content)：在网页 X 论坛里发帖子
 *  - likePost(postId)：给论坛帖子点赞
 *  - playMusic(songName)：打开网页音乐 App 搜歌并播放
 *  - getWebState()：获取当前网页手机状态（在桌面/在哪个App/锁屏/放歌中…）
 *  - saveMemo(content, title?)：把内容存进网页备忘录
 *  - setAlarm(time, label?)：在网页时钟里定闹钟
 *  - queryWeather(city?)：查天气（同步写入天气 App）
 *  - openScreen(app)：打开网页里的某个应用界面
 *
 * 工具协议（机主需求二·多步任务 Web 化）：
 *  1. AI 先调用工具（Function Calling / Web Agent 循环）；
 *  2. 这里真实执行，把真实结果（如「消息已发送给Z」）作为 role:"tool" 回传 AI；
 *  3. AI 再生成自然的文字回复（「我已经在微信上给Z发过去了哦」）。
 *
 * 纯净度铁律（机主需求三）：所有底层操作过程一律从灵动岛弹出过程卡
 * （pushToolIslandCard）播报，绝不在聊天气泡里留下 (内心独白：…)(正在操作：…) 日志。
 *
 * 全部函数返回 { ok, text }：text 是给 LLM 看的可读结果（成功含证据、失败含原因
 * 与可用选项），Agentic 循环据此决定下一步。
 */

import { kvGet, kvSet } from './idb-kv';
import { genId } from './db';
import { pushToolIslandCard } from './island-notify';
import { listContacts } from './contacts-store';
import { contactNameVariants, nameVariantHit, isFriendIn, type ContactRecord } from '@/lib/contacts';
import { openScreenApp } from './agent-screen';
import { runWeatherReport } from './agent-weather';
import { useUI } from './store';
import type { NotifyApp } from './island-notify';
import { pushToolStatusBubble } from './tool-status-bubble';

/** 当前工具调用的目标会话 sessionKey（由 phone-tools execWebTool 设置，
 *  web-tools 的 island() 读它决定气泡发到哪个会话；为空时退回灵动岛弹窗）。 */
let currentToolSessionKey = '';
let currentToolCharName = '';

export function setToolSessionContext(sessionKey: string, charName?: string): void {
  currentToolSessionKey = sessionKey || '';
  currentToolCharName = charName || '';
}

export function getToolCharName(): string {
  return currentToolCharName;
}

/**
 * v2.2 需求二.1：当前工具会话完整上下文（freezeApp/freezeRealApp 冻结时记录
 * contactId/app，锁定全屏界面据此动态加载聊天对象头像 + 【去哄哄 TA】精准跳聊天）。
 * sessionKey 形如 wx:<contactId> / qq:<contactId> / sms:c:<contactId> / sms:assistant。
 */
export function getToolSessionContext(): {
  sessionKey: string;
  charName: string;
  contactId?: string;
  app?: 'wx' | 'qq' | 'sms';
} {
  let contactId: string | undefined;
  let app: 'wx' | 'qq' | 'sms' | undefined;
  const sk = currentToolSessionKey;
  if (sk.startsWith('wx:')) {
    app = 'wx';
    contactId = sk.slice(3) || undefined;
  } else if (sk.startsWith('qq:')) {
    app = 'qq';
    contactId = sk.slice(3) || undefined;
  } else if (sk.startsWith('sms:')) {
    app = 'sms';
    const inner = sk.slice(4);
    if (inner && inner !== 'assistant') {
      contactId = (inner.startsWith('c:') ? inner.slice(2) : inner) || undefined;
    }
  }
  return { sessionKey: sk, charName: currentToolCharName, contactId, app };
}

// ---------------- 通用 ----------------

export interface WebToolResult {
  ok: boolean;
  text: string;
}

/** 灵动岛过程卡快捷出口。
 *  v1.9.8：FC 路径下由 runPhoneToolRound 统一推 pending→done 气泡，island() 不再重复推。
 *  无 sessionKey（如论坛/淘宝后台/标记兜底）时退回灵动岛弹窗。 */
function island(app: NotifyApp, title: string, body: string): void {
  // FC 路径：runPhoneToolRound 已推了 pending 气泡并会在工具返回后更新为 done，这里不重复推
  if (currentToolSessionKey) {
    return;
  }
  // 兜底：无 sessionKey（标记执行/后台调用）→ 灵动岛弹窗
  try {
    pushToolIslandCard({ app, title, body });
  } catch {
    /* 弹窗失败不影响工具结果回传 */
  }
}

/** 把给机主看的话截短（灵动岛卡片正文上限） */
function brief(s: string, n = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

// ============================================================
// 一、sendWebMessage：网页微信/QQ/信息里替机主发消息
// ============================================================

type ChatAppKind = 'wx' | 'qq' | 'sms';

const APP_LABEL: Record<ChatAppKind, string> = { wx: '微信', qq: 'QQ', sms: '信息' };

/** LLM 口语化 App 名 → 聊天 App 种类（微信/wx/weixin → wx；qq → qq；信息/短信/imessage → sms） */
function resolveChatApp(raw: string): ChatAppKind | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  if (/微信|weixin|wechat|^wx$/.test(q)) return 'wx';
  if (/qq|^q{1,2}$/.test(q)) return 'qq';
  if (/信息|短信|短讯|imessage|^sms$|^chat$/.test(q)) return 'sms';
  return null;
}

/** 找出某聊天 App 里名字对得上的联系人（名字/昵称/备注/真名多变体匹配） */
function matchContacts(name: string, list: ContactRecord[]): ContactRecord[] {
  const q = name.trim();
  if (!q) return [];
  return list.filter((c) => nameVariantHit(contactNameVariants(c), q));
}

/** 某联系人是否已是该 App 的好友（多账号口径统一走 isFriendIn） */
function friendLabelOf(c: ContactRecord, app: ChatAppKind): { friend: boolean; label: string } {
  const friend = isFriendIn(c, app);
  const label = c.remark?.trim() || c.nickname?.trim() || c.realName?.trim() || c.name || 'TA';
  return { friend, label };
}

/**
 * 在网页微信/QQ/信息里替机主给联系人发一条消息。
 * - 联系人按 名字/昵称/备注/真名 匹配，未匹配/不是好友时返回可用联系人清单帮 LLM 换词；
 * - 消息以机主（me）身份落库，正在开着的聊天页经 chat-stream-sysline 事件实时上屏；
 * - 微信/QQ 端给对方 AI 排一条感知事件：机主下次打开那个聊天时 TA 会自然回应这条消息。
 */
export async function toolSendWebMessage(appName: string, contactName: string, content: string): Promise<WebToolResult> {
  const app = resolveChatApp(appName);
  if (!app) {
    return { ok: false, text: `appName 不认识（appName 只能是：微信 / QQ / 信息），收到的是「${appName}」` };
  }
  const text = content.trim();
  if (!text) return { ok: false, text: '缺少消息内容：content 参数不能为空' };
  const who = contactName.trim();
  if (!who) return { ok: false, text: '缺少联系人名字：contactName 参数不能为空' };

  const all = await listContacts();
  const hits = matchContacts(who, all);
  if (hits.length === 0) {
    const friends = all
      .filter((c) => c.kind !== 'user' && isFriendIn(c, app))
      .map((c) => friendLabelOf(c, app).label)
      .slice(0, 12);
    return {
      ok: false,
      text: `${APP_LABEL[app]}里没有找到叫「${who}」的联系人。${APP_LABEL[app]}里的好友有：${friends.join('、') || '（无）'}——请换准确的名字重试`,
    };
  }
  const target = hits.find((c) => friendLabelOf(c, app).friend) ?? null;
  if (!target) {
    const label = friendLabelOf(hits[0], app).label;
    return { ok: false, text: `找到了联系人「${label}」，但 TA 不是${APP_LABEL[app]}好友（${APP_LABEL[app]}里发不了消息）。请换一个${APP_LABEL[app]}好友` };
  }
  const label = friendLabelOf(target, app).label;
  const cid = target.id;
  const now = Date.now();

  // 三端消息形状与 kv 键（与各聊天页 loadMsgs 完全同构）
  let kvKey: string;
  let sessionKey: string;
  if (app === 'wx') {
    kvKey = `wx-chat-msgs:${cid}`;
    sessionKey = `wx:${cid}`;
  } else if (app === 'qq') {
    kvKey = `qq-chat-msgs:${cid}`;
    sessionKey = `qq:${cid}`;
  } else {
    kvKey = `ios-chat-msgs:c:${cid}`;
    sessionKey = `sms:c:${cid}`;
  }
  const role = app === 'sms' ? 'user' : 'me';
  try {
    const raw = kvGet<unknown[]>(kvKey);
    const list = Array.isArray(raw) ? raw : [];
    const msg: Record<string, unknown> =
      app === 'sms'
        ? { id: genId(), role, content: text, time: now }
        : { id: genId(), role, content: text, time: now, unread: true };
    kvSet(kvKey, [...list, msg].slice(-500));
    // 正开着的聊天页增量合并（三端都监听该事件、按 id 去重）
    window.dispatchEvent(new CustomEvent('chat-stream-sysline', { detail: { sessionKey } }));
  } catch (e) {
    return { ok: false, text: `消息落库失败：${e instanceof Error ? e.message : '存储异常'}` };
  }

  // 给对方 AI 排感知事件（微信/QQ）：机主打开那个聊天时 TA 会回应这条消息
  if (app !== 'sms') {
    try {
      if (app === 'wx') {
        const { pushAiEvent } = await import('@/components/apps/wx-app/core');
        pushAiEvent(cid, `（系统事件：机主的 AI 助手刚刚替机主给你发来了这条消息：「${brief(text, 80)}」。请按你的人设自然地回应它，别提「AI 助手」这个词，就当是机主亲口对你说的。）`);
      } else {
        const { pushAiEvent } = await import('@/components/apps/qq-app/core');
        pushAiEvent(cid, `（系统事件：机主的 AI 助手刚刚替机主给你发来了这条消息：「${brief(text, 80)}」。请按你的人设自然地回应它，别提「AI 助手」这个词，就当是机主亲口对你说的。）`);
      }
    } catch {
      /* 事件失败不影响消息本身 */
    }
  }

  const notifyApp: NotifyApp = app === 'wx' ? 'wechat' : app === 'qq' ? 'qq' : 'chat';
  island(notifyApp, '替你发消息', `已在${APP_LABEL[app]}给「${label}」发送：${brief(text)}`);
  return {
    ok: true,
    text: `【已发送】已在${APP_LABEL[app]}里以机主的身份给「${label}」发出消息：「${brief(text, 100)}」。这条消息已经真实出现在${APP_LABEL[app]}的聊天记录里，TA 下次上线看到会回复。`,
  };
}

// ============================================================
// 二、postForum / likePost：网页 X 论坛
// ============================================================

/**
 * 在网页 X 论坛里替机主发帖（topic 主题行 + content 正文，二选一也行）。
 * 与论坛发布界面完全同款管线：落库 + 帖子记忆 + NPC/角色互动队列（发完真的会有网友
 * 和角色来点赞评论）。
 */
export async function toolPostForum(topic: string, content: string): Promise<WebToolResult> {
  const t = topic.trim();
  const c = content.trim();
  const full = [t, c].filter(Boolean).join('\n').trim();
  if (!full) return { ok: false, text: '发帖内容为空：topic 与 content 至少填一个' };

  const { forumData, saveForum, uid, POST_MAX, COMMUNITY_DEFS, activeAuthorKey } = await import('@/lib/forum/core');
  const d = forumData();
  const me = activeAuthorKey();
  // 主题词能对上版块名就归版块，否则进「今日热议」广场
  const community = COMMUNITY_DEFS.find((x) => t && (x.name === t || t.includes(x.name)))?.id ?? null;
  const post = {
    id: uid('p'),
    authorKey: me,
    content: full.slice(0, POST_MAX),
    community,
    createdAt: Date.now(),
    likes: [] as string[],
    reposts: 0,
    views: 0,
    replyTo: null,
    replyToName: null,
  };
  d.posts.push(post);
  saveForum({ ...d });

  // 帖子记忆 / NPC 马甲暴露检查 / 角色互动 + 网友互动队列（与发布界面同款）
  try {
    const { notePostPublished } = await import('@/lib/forum/post-memory');
    notePostPublished(post);
    if (me === 'user') {
      const { exposeAnonIdentityIn, markNpcAnonKnown } = await import('@/lib/forum/npc-memory');
      if (exposeAnonIdentityIn(post.content)) markNpcAnonKnown();
      const { writeUserPostMemory } = await import('@/lib/forum/social');
      writeUserPostMemory(post);
      const { queueCharEngagements } = await import('@/lib/forum/engine');
      queueCharEngagements(post);
    }
    const { queueUserPostInteractions } = await import('@/lib/forum/engine');
    queueUserPostInteractions(post);
  } catch {
    /* 互动队列失败不影响帖子本身 */
  }

  island('forum', '发布帖子', `已在 X 论坛发布：${brief(t || c)}`);
  return {
    ok: true,
    text: `【已发布】已在 X 论坛发出帖子（帖子 id：${post.id}）：「${brief(full, 120)}」。网友和 TA 们刷到后会来点赞评论，热度会慢慢涨起来。`,
  };
}

/**
 * 给论坛帖子点赞。postId 可以是真实帖子 id，也可以是帖子内容关键词（模糊找帖）。
 */
export async function toolLikePost(postId: string): Promise<WebToolResult> {
  const q = (postId ?? '').trim();
  if (!q) return { ok: false, text: '缺少参数：postId（帖子 id 或帖子内容关键词）' };
  const { forumData, saveForum, resolveAuthor, activeAuthorKey } = await import('@/lib/forum/core');
  const d = forumData();
  const post =
    d.posts.find((p) => p.id === q) ??
    [...d.posts].reverse().find((p) => !p.replyTo && (p.content.includes(q) || q.includes(p.content.slice(0, 30))));
  if (!post) {
    const recent = d.posts
      .filter((p) => !p.replyTo)
      .slice(-6)
      .map((p) => `「${brief(p.content, 24)}」（id:${p.id}）`)
      .join(' ');
    return { ok: false, text: `论坛里没找到「${brief(q, 40)}」对应的帖子。最近的帖子有：${recent || '（无）'}——请换帖子 id 或内容关键词重试` };
  }
  const me = activeAuthorKey();
  if (post.likes.includes(me)) {
    return { ok: true, text: `【已点过】这条帖子（「${brief(post.content, 40)}」）已经点过赞了，不用重复点。` };
  }
  post.likes = [...post.likes, me];
  // 角色 posts 的点赞走真人社交链路（写记忆 + 低概率回评），与帖子卡点赞同款
  if (post.authorKey.startsWith('char:') && me === 'user') {
    try {
      const { writeUserLikeMemory } = await import('@/lib/forum/social');
      writeUserLikeMemory(post.authorKey.slice(5), post);
      const { queueCharThanksForLike } = await import('@/lib/forum/engine');
      queueCharThanksForLike(post);
    } catch {
      /* 失败不影响点赞本身 */
    }
  }
  try {
    const { noteForumEngagement } = await import('@/lib/ios/anxiety-events');
    noteForumEngagement('like', { authorKey: post.authorKey, authorName: resolveAuthor(post.authorKey).name }, me);
  } catch {
    /* 焦虑事件失败不影响点赞 */
  }
  saveForum({ ...d });
  island('forum', '点赞帖子', `已点赞：${brief(post.content, 50)}`);
  return { ok: true, text: `【已点赞】已给这条帖子点了赞：「${brief(post.content, 60)}」（作者：${resolveAuthor(post.authorKey).name}，当前 ${post.likes.length} 个赞）。` };
}

// ============================================================
// 三、playMusic：打开网页音乐 App 搜歌播放
// ============================================================

/**
 * 打开网页音乐 App，搜索歌名并立即播放（网易云音源，与音乐 App 内搜索同链路）。
 * 返回歌曲名与歌手给 AI 汇报；搜不到/播放失败如实报，AI 好换关键词重试。
 */
export async function toolPlayMusic(songName: string): Promise<WebToolResult> {
  const q = songName.trim();
  if (!q) return { ok: false, text: '缺少歌名：songName 参数不能为空' };
  const open = await openScreenApp('music');
  if (!open.ok) return { ok: false, text: `音乐 App 打开失败：${open.text}` };
  try {
    const { search } = await import('@/lib/ios/music-api');
    const r = await search(q, 1, 8);
    const song = r.songs[0];
    if (!song) return { ok: false, text: `音乐库里没搜到「${q}」——换更准的歌名（或加上歌手名）再试` };
    const artist = (song.artists ?? []).map((a) => a.name).filter(Boolean).join('/');
    const { useMusic } = await import('@/lib/ios/music-store');
    await useMusic.getState().playSong(song, r.songs.slice(0, 8));
    const label = artist ? `《${song.name}》-${artist}` : `《${song.name}》`;
    island('music', '播放音乐', `正在播放 ${label}`);
    return { ok: true, text: `【已播放】音乐 App 已打开并正在播放 ${label}，机主这边能直接听到。` };
  } catch (e) {
    return { ok: false, text: `播放失败：${e instanceof Error ? e.message : '音乐服务异常'}` };
  }
}

// ============================================================
// 四、getWebState：当前网页手机状态
// ============================================================

/** 获取当前网页手机的状态：桌面还是 App、哪个 App、锁屏/熄屏、正在放歌。 */
export async function toolGetWebState(): Promise<WebToolResult> {
  const ui = useUI.getState();
  const parts: string[] = [];
  if (ui.locked) parts.push('手机处于锁屏状态');
  else if (ui.screenOff) parts.push('手机熄屏中');
  else if (ui.activeApp) {
    const names: Record<string, string> = {
      wechat: '微信', qq: 'QQ', chat: '信息', music: '音乐', forum: 'X论坛', notes: '备忘录',
      clock: '时钟', weather: '天气', calendar: '日历', photos: '照片', camera: '相机', taobao: '淘宝',
      meituan: '美团', browser: '浏览器', settings: '设置', contacts: '通讯录', phone: '电话',
      couple: '情侣空间', cottage: '拾光小屋', memory: '记忆库', worldbook: '世界书', files: '文件',
      reminders: '提醒事项', calculator: '计算器', recorder: '语音备忘录', themes: '主题', appstore: 'App Store',
    };
    parts.push(`机主此刻正在「${names[ui.activeApp] ?? ui.activeApp}」应用里`);
  } else {
    parts.push('机主此刻在主屏幕（桌面，没有打开任何应用）');
  }
  try {
    const { nowPlayingSnapshot } = await import('@/lib/ios/music-store');
    const np = nowPlayingSnapshot();
    if (np?.song) {
      const artist = (np.song.artists ?? []).map((a: { name?: string }) => a.name ?? '').filter(Boolean).join('/');
      parts.push(`背景音乐正在放${artist ? `《${np.song.name}》-${artist}` : `《${np.song.name}》`}`);
    }
  } catch {
    /* 音乐状态读不到就略过 */
  }
  parts.push(`当前时间 ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  return { ok: true, text: `【网页状态】${parts.join('；')}。` };
}

// ============================================================
// 五、saveMemo：网页备忘录
// ============================================================

/**
 * 把内容存进网页备忘录（IndexedDB notes 表，与备忘录 App 同库）。
 * 标题自动取首行（≤20 字），正文完整保存；保存后备忘录 App 打开即见。
 */
export async function toolSaveMemo(content: string, title?: string): Promise<WebToolResult> {
  const c = (content ?? '').trim();
  if (!c) return { ok: false, text: '缺少备忘内容：content 参数不能为空' };
  const t = (title ?? '').trim() || c.split('\n')[0].trim().slice(0, 20) || '新备忘录';
  const now = Date.now();
  try {
    const { localDB } = await import('./db');
    await localDB.put('notes', {
      id: genId(),
      title: t.slice(0, 40),
      content: c,
      createdAt: now,
      updatedAt: now,
      folder: 'default',
    });
  } catch (e) {
    return { ok: false, text: `备忘录保存失败：${e instanceof Error ? e.message : '存储异常'}` };
  }
  island('notes', '保存备忘录', `已保存：${brief(t)}`);
  return { ok: true, text: `【已保存】已把这段内容存进备忘录（标题「${brief(t, 30)}」）：「${brief(c, 80)}」。打开备忘录 App 就能看到。` };
}

// ============================================================
// 六、setAlarm：网页时钟定闹钟
// ============================================================

/** 中文数字 → 数值（一~二十三 足够闹钟用） */
function cnNum(s: string): number | null {
  const digit = '零一二三四五六七八九';
  if (/^\d+$/.test(s)) return Number(s);
  if (s === '半') return 30;
  if (s === '十') return 10;
  const m = /^([一二三四五六七八九])十([一二三四五六七八九]?)$/.exec(s);
  if (m) return 10 + (m[2] ? digit.indexOf(m[2]) : 0);
  const m2 = /^十([一二三四五六七八九])$/.exec(s);
  if (m2) return 10 + digit.indexOf(m2[1]);
  if (digit.includes(s)) return digit.indexOf(s);
  return null;
}

/**
 * 自然语言时间 → HH:mm（24小时制）：
 * 支持「7:30」「07点」「七点半」「早上8点」「下午3点20」「晚上10点」「中午12点」；
 * 无上下午标记时按上午算（闹钟场景「定个8点」默认早上）。
 */
export function parseAlarmTime(raw: string): string | null {
  let s = (raw ?? '').trim().replace(/\s+/g, '');
  if (!s) return null;
  // 相对词去掉（「明天早上」→ 早上；明早/今晚留给上下午判定）
  s = s.replace(/明天|后天|今日|当天/g, '');
  // 12 小时制标记：先识别再剥掉（「早上8点」要能匹配到「8点」）
  let pm = false;
  let am = false;
  let noon = false;
  if (/下午|傍晚|晚上|今晚|夜里/.test(s)) pm = true;
  if (/上午|早上|早晨|清晨|凌晨|早间|明早|明晨/.test(s)) am = true;
  if (/中午/.test(s)) noon = true;
  s = s.replace(/凌晨|清晨|早晨|明早|明晨|早上|上午|早间|下午|傍晚|今晚|晚上|夜里|中午/g, '');
  // 「X点Y分」/「X点半」/「X:Y」/「X点」
  let hour: number | null = null;
  let minute = 0;
  const hmColon = /^(\d{1,2})[:：点时](\d{1,2})?分?半?$/.exec(s);
  const hmCn = /^([一二三四五六七八九十半]{1,3})[点时]([一二三四五六七八九十半]{1,3})分?$/.exec(s);
  const onlyCnHalf = /^([一二三四五六七八九十]{1,3})点半$/.exec(s);
  if (hmColon) {
    hour = Number(hmColon[1]);
    if (hmColon[2]) minute = Number(hmColon[2]);
    if (/半$/.test(s)) minute = 30;
  } else if (onlyCnHalf) {
    hour = cnNum(onlyCnHalf[1]);
    minute = 30;
  } else if (hmCn) {
    hour = cnNum(hmCn[1]);
    minute = cnNum(hmCn[2]) ?? 0;
  } else {
    const onlyHour = /^(\d{1,2})[点时]$/.exec(s) ?? /^([一二三四五六七八九十]{1,3})[点时]$/.exec(s);
    if (onlyHour) hour = /^\d/.test(onlyHour[1]) ? Number(onlyHour[1]) : cnNum(onlyHour[1]);
  }
  if (hour === null || hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  // 上下午换算：中午12=12 点、晚上12=午夜0点、下午/晚上 X(<12) 加 12
  if (noon && hour === 12) {
    hour = 12;
  } else if (pm && hour === 12) {
    hour = 0; // 「晚上12点」= 午夜
  } else if (pm && hour < 12) {
    hour += 12;
  } else if (am && hour === 12) {
    hour = 0; // 「凌晨12点」= 午夜
  }
  const h = ((hour % 24) + 24) % 24;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * 在网页时钟里替机主定一个闹钟（IndexedDB alarms 表，与时钟 App 同库；到点闹钟
 * 会真实全屏响铃）。time 支持「7:30」「七点半」「早上8点」等自然说法。
 */
export async function toolSetAlarm(time: string, label?: string): Promise<WebToolResult> {
  const t = parseAlarmTime(time);
  if (!t) {
    return {
      ok: false,
      text: `闹钟时间「${brief(time, 20)}」没看懂——请用「HH:mm」（如 07:30）或「早上8点」「晚上10点半」这类说法`,
    };
  }
  const name = (label ?? '').trim() || '闹钟';
  try {
    const { localDB } = await import('./db');
    await localDB.put('alarms', {
      id: genId(),
      time: t,
      label: name.slice(0, 20),
      enabled: true,
      repeat: [],
      createdAt: Date.now(),
    });
  } catch (e) {
    return { ok: false, text: `闹钟设置失败：${e instanceof Error ? e.message : '存储异常'}` };
  }
  island('clock', '设置闹钟', `闹钟已定在 ${t} · ${brief(name, 20)}`);
  return { ok: true, text: `【已定闹钟】闹钟已定在 ${t}（标签「${brief(name, 20)}」），到点会真实响铃提醒机主。` };
}

// ============================================================
// 七、queryWeather：查天气（同步天气 App）
// ============================================================

/**
 * 查某地天气并同步到天气 App（城市定位 → Open-Meteo → 写天气 App 城市选择 →
 * 桌面/锁屏小组件刷新）。city 为空时用机主当前城市。
 */
export async function toolQueryWeather(city?: string): Promise<WebToolResult> {
  const rep = await runWeatherReport((city ?? '').trim());
  const text = rep.reply.replace('天气 App 已经帮你打开了~', '天气数据已经同步到天气 App~');
  island('weather', '查天气', brief(rep.reply.replace('天气 App 已经帮你打开了~', ''), 70));
  return rep.ok
    ? { ok: true, text: `【天气】${text}` }
    : { ok: false, text: `【天气查询失败】${text}` };
}

// ============================================================
// 八、openScreen：打开网页里的应用（复用 agent-screen 层）
// ============================================================

export async function toolOpenScreen(app: string): Promise<WebToolResult> {
  const r = await openScreenApp(app);
  if (!r.ok) island('chat', '打开应用', brief(r.text, 60));
  return r;
}

/**
 * 冻结 / 解冻网页内应用（v2.4：支持批量）。
 * - 单个：freezeApp("备忘录", 'freeze') → 解析应用名 → upsert 冻结记录；
 * - 批量：appName 填「全部/所有/全部应用/所有App/all」→ 前端真实 for 循环遍历
 *   WEB_LOCK_APPS 挨个 setWebFrozen（绝不发一个提示气泡装样子），一次调用真冻结全部；
 * - AI 也可以先调 getWebInstalledApps 拿清单，再逐个调本工具（每次 upsert 独立记录，互不顶掉）。
 * reason/durationMin 由 AI 按人设/记忆/上下文自定义（如“你玩太久照片了” / 冻结 10 分钟）。
 */
export async function toolFreezeApp(
  appName: string,
  action: 'freeze' | 'unfreeze',
  opts?: { reason?: string; durationMin?: number; charName?: string; contactId?: string; app?: string },
): Promise<WebToolResult> {
  const { WEB_LOCK_APPS, setWebFrozen, getWebFrozenMap, unfreezeWebPkg } = await import('./web-app-lock');
  const { matchWebAppByPackage } = await import('./agent-app-nav');
  const name = (appName ?? '').trim();
  if (!name) {
    return { ok: false, text: '请填要冻结/解冻的应用名（如：备忘录、网易云音乐、淘宝、时钟；冻结全部填「全部」）' };
  }

  // ---- v2.4 批量：「全部/所有」→ 真实循环遥历每一个网页内置应用，挨个写入冻结态 ----
  const isAll = /^(全部|所有|全部应用|所有应用|全部app|所有app|全部应用软件|所有应用软件|all|all apps|所有App|全部App)$/i.test(name) || /全部应用|所有应用/.test(name);
  if (isAll) {
    if (action === 'freeze') {
      const durationMin = opts?.durationMin && opts.durationMin > 0 ? opts.durationMin : 30;
      const unlockAt = Date.now() + durationMin * 60_000;
      const charName = opts?.charName || 'AI';
      // 前端真实执行循环（拒绝表面演戏）：挨个修改每个 App 的冻结状态
      for (const a of WEB_LOCK_APPS) {
        setWebFrozen(a.pkg, unlockAt, charName, 'ai', {
          reason: opts?.reason,
          contactId: opts?.contactId,
          app: opts?.app,
        });
      }
      // 正开着的 App 只要是被冻结清单里的 → 踢回主屏（与单冻同款体验）
      try {
        const ui = useUI.getState();
        if (ui.activeApp && WEB_LOCK_APPS.some((a) => a.appId === ui.activeApp)) ui.closeApp();
      } catch {
        /* 踢出失败不影响冻结本身 */
      }
      island('chat', '冻结应用', `已冻结全部 ${WEB_LOCK_APPS.length} 个应用（${durationMin} 分钟后自动解冻）`);
      return {
        ok: true,
        text: `已真实冻结网页里全部 ${WEB_LOCK_APPS.length} 个应用：${WEB_LOCK_APPS.map((a) => a.name).join('、')}。每个应用图标都已变灰、点开见锁定提示，${durationMin} 分钟后自动解冻。`,
      };
    }
    // 批量解冻全部
    const frozenMap = getWebFrozenMap();
    const frozenList = Object.values(frozenMap);
    if (frozenList.length === 0) {
      return { ok: true, text: '当前没有任何被冻结的应用，无需解冻' };
    }
    for (const rec of frozenList) {
      unfreezeWebPkg(rec.pkg);
    }
    island('chat', '解冻应用', `已解冻全部 ${frozenList.length} 个应用`);
    return { ok: true, text: `已解冻全部 ${frozenList.length} 个应用（网页内应用全部恢复可用）。` };
  }

  // 先按包名/中文名匹配网页内置应用
  const matched = matchWebAppByPackage(name);
  let pkg: string | null = null;
  let displayName = name;
  if (matched) {
    // 确认该应用在可冻结清单里
    const lockApp = WEB_LOCK_APPS.find((a) => a.appId === matched.appId);
    if (lockApp) {
      pkg = lockApp.pkg;
      displayName = lockApp.name;
    }
  }
  // 没匹配上再按可冻结清单里的名字直接找
  if (!pkg) {
    const lower = name.toLowerCase();
    const hit = WEB_LOCK_APPS.find((a) => a.name === name || a.pkg.toLowerCase() === lower || a.appId === lower);
    if (hit) {
      pkg = hit.pkg;
      displayName = hit.name;
    }
  }
  if (!pkg) {
    const listNames = WEB_LOCK_APPS.map((a) => a.name).join('、');
    return {
      ok: false,
      text: `网页里没有叫「${name}」的应用。网页内置应用有：${listNames}。要冻结全部就填 appName="全部"。`,
    };
  }

  if (action === 'freeze') {
    // 冻结时长：AI 自定义（默认 30 分钟）
    const durationMin = opts?.durationMin && opts.durationMin > 0 ? opts.durationMin : 30;
    const unlockAt = Date.now() + durationMin * 60_000;
    const charName = opts?.charName || 'AI';
    // v2.3：已冻结 → 重新冻结（用新的时长覆盖 unlockAt），不再回「无需重复冻结」——
    // 用户实测第二次让它冻结时被这句话挡回，AI 只会嘴上说「已经冻好了」而不续时
    const existing = getWebFrozenMap()[pkg];
    const refrozen = !!existing;
    setWebFrozen(pkg, unlockAt, charName, 'ai', {
      reason: opts?.reason,
      contactId: opts?.contactId,
      app: opts?.app,
    });
    // 冻结后把当前打开的 App 踢回主屏（如果正开着被冻结的 App）
    try {
      const activeApp = useUI.getState().activeApp;
      const lockApp = WEB_LOCK_APPS.find((a) => a.pkg === pkg);
      if (lockApp && activeApp === lockApp.appId) useUI.getState().closeApp();
    } catch {
      /* 踢出失败不影响冻结本身 */
    }
    island('chat', '冻结应用', `已冻结${displayName}（${durationMin} 分钟后自动解冻）`);
    return {
      ok: true,
      text: `${refrozen ? '已重新冻结' : '已冻结'}${displayName}（网页内应用：图标变灰、点开见锁定提示，${durationMin} 分钟后自动解冻）`,
    };
  }
  // 解冻
  const existing = getWebFrozenMap()[pkg];
  if (!existing) {
    return { ok: true, text: `${displayName}当前没有被冻结，无需解冻` };
  }
  unfreezeWebPkg(pkg);
  island('chat', '解冻应用', `已解冻${displayName}`);
  return { ok: true, text: `已解冻${displayName}（网页内应用恢复可用）。` };
}

/** v2.4 批量工作流第一步：获取网页里全部已安装应用清单（含每个应用当前冻结状态）。
 *  AI 拿到清单后：要么 freezeApp(appName="全部") 一次冻结全部，要么对清单里的每个
 *  应用依次调 freezeApp——绝不允许只冻结一个就停下。 */
export async function toolGetInstalledApps(): Promise<WebToolResult> {
  const { WEB_LOCK_APPS, getWebFrozenMap } = await import('./web-app-lock');
  const frozenMap = getWebFrozenMap();
  const names = WEB_LOCK_APPS.map((a) => a.name);
  const frozenNames = WEB_LOCK_APPS.filter((a) => frozenMap[a.pkg]).map((a) => a.name);
  const frozenPart = frozenNames.length > 0 ? `当前已冻结：${frozenNames.join('、')}。` : '当前没有任何应用被冻结。';
  return {
    ok: true,
    text: `网页里已安装 ${WEB_LOCK_APPS.length} 个应用：${names.join('、')}。${frozenPart}要冻结/解冻全部，调 freezeApp(appName="全部", action=…) 一次完成；要操作单个就依次调用。`,
  };
}

// ============================================================
// 九、使用时长 / 查后台 / 拉回聊天页（网页生态能力，恒注册）
// ============================================================

/** 今日各应用使用时长报告（对应兜底标记 [手机操作:使用时长:]） */
export async function toolGetUsageStats(): Promise<WebToolResult> {
  const { webUsageReport } = await import('./web-usage-ledger');
  const text = webUsageReport();
  island('chat', '使用时长', brief(text, 80));
  return { ok: true, text };
}

/** 查后台/最近用过哪些应用（对应兜底标记 [手机操作:查后台:]） */
export async function toolGetRecentApps(): Promise<WebToolResult> {
  const { webRecentReport } = await import('./web-usage-ledger');
  const text = await webRecentReport();
  island('chat', '最近应用', brief(text, 80));
  return { ok: true, text };
}

/** 把机主拉回当前聊天页（对应兜底标记 [手机操作:拉回:]）。
 *  读取吃醋锁运行态里的 lastChat → 切到对应 App 的聊天页。 */
export async function toolPullBackToChat(): Promise<WebToolResult> {
  try {
    const { readJealousyRuntime } = await import('./jealousy-lock');
    const lastChat = readJealousyRuntime().lastChat;
    const target: 'wechat' | 'qq' | 'chat' = lastChat?.app === 'wx' ? 'wechat' : lastChat?.app === 'qq' ? 'qq' : 'chat';
    const ui = useUI.getState();
    if (ui.activeApp === target) {
      return { ok: true, text: '机主已经在这个 App 的聊天页了，无需拉回' };
    }
    if (ui.activeApp) ui.switchToApp(target);
    else ui.openApp(target);
    island('chat', '拉回聊天', `已把机主切回${target === 'wechat' ? '微信' : target === 'qq' ? 'QQ' : '信息'}聊天页`);
    return { ok: true, text: `已把机主切回${target === 'wechat' ? '微信' : target === 'qq' ? 'QQ' : '信息'}的聊天页` };
  } catch {
    return { ok: false, text: '拉回失败（聊天页不可用）' };
  }
}

// ============================================================
// 十、搜索网页内置应用（模糊匹配 → 返回 appId/pkg/名字）
// ============================================================

/** 网页内置应用的别名表（供 searchWebApp 模糊匹配用）。
 *  含可冻结 + 不可冻结的全部网页应用，让 AI 能搜到"闹钟"→时钟、"微信"→微信等。
 *  别名覆盖中文名/英文/常见俗称，匹配大小写不敏感。 */
const WEB_APP_ALIASES: { appId: string; pkg: string; name: string; aliases: string[] }[] = [
  { appId: 'music', pkg: 'com.netease.cloudmusic', name: '网易云音乐', aliases: ['音乐', '网易云', 'cloudmusic', 'music', 'song', '歌'] },
  { appId: 'browser', pkg: 'com.android.browser', name: '浏览器', aliases: ['浏览器', 'browser', '网页', '上网'] },
  { appId: 'taobao', pkg: 'com.taobao.taobao', name: '淘宝', aliases: ['淘宝', 'taobao', '购物', '电商'] },
  { appId: 'meituan', pkg: 'com.sankuai.meituan', name: '美团', aliases: ['美团', 'meituan', '外卖', '团购'] },
  { appId: 'photos', pkg: 'com.android.gallery3d', name: '照片', aliases: ['照片', '相册', '图库', 'gallery', 'photos', 'photo'] },
  { appId: 'forum', pkg: 'com.x.forum', name: 'X论坛', aliases: ['论坛', 'x论坛', 'forum', '社区'] },
  { appId: 'wechat', pkg: 'com.tencent.mm', name: '微信', aliases: ['微信', 'wechat', 'weixin', '聊天'] },
  { appId: 'qq', pkg: 'com.tencent.mobileqq', name: 'QQ', aliases: ['qq', 'QQ', '企鹅'] },
  { appId: 'chat', pkg: 'com.android.sms', name: '信息', aliases: ['信息', '短信', 'sms', 'chat', 'message'] },
  { appId: 'phone', pkg: 'com.android.dialer', name: '电话', aliases: ['电话', '拨号', 'phone', 'dialer', '通话'] },
  { appId: 'clock', pkg: 'com.android.deskclock', name: '时钟', aliases: ['时钟', '闹钟', 'clock', 'alarm', '时间', '计时'] },
  { appId: 'calendar', pkg: 'com.android.calendar', name: '日历', aliases: ['日历', 'calendar', '日程'] },
  { appId: 'weather', pkg: 'com.android.weather', name: '天气', aliases: ['天气', 'weather', '气象'] },
  { appId: 'camera', pkg: 'com.android.camera', name: '相机', aliases: ['相机', '摄像', 'camera', '拍照'] },
  { appId: 'notes', pkg: 'com.android.notes', name: '备忘录', aliases: ['备忘录', '笔记', 'notes', 'note', '便签'] },
  { appId: 'contacts', pkg: 'com.android.contacts', name: '通讯录', aliases: ['通讯录', '联系人', 'contacts'] },
  { appId: 'settings', pkg: 'com.android.settings', name: '设置', aliases: ['设置', 'settings', '配置'] },
];

/** 搜索网页内置应用：关键词模糊匹配 → 返回匹配的应用列表（appId/pkg/名字/是否可冻结）。 */
export async function toolSearchWebApp(keyword: string): Promise<WebToolResult> {
  const kw = (keyword ?? '').trim().toLowerCase();
  if (!kw) {
    return {
      ok: false,
      text: '请填搜索关键词（如：闹钟、音乐、淘宝、微信、时钟）',
    };
  }
  const { WEB_LOCK_APPS } = await import('./web-app-lock');
  const freezablePkgs = new Set(WEB_LOCK_APPS.map((a) => a.pkg));
  const matched = WEB_APP_ALIASES.filter((a) => {
    if (a.name.toLowerCase().includes(kw)) return true;
    if (a.appId.toLowerCase() === kw || a.pkg.toLowerCase().includes(kw)) return true;
    return a.aliases.some((al) => al.toLowerCase() === kw || al.toLowerCase().includes(kw) || kw.includes(al.toLowerCase()));
  });
  if (matched.length === 0) {
    const allNames = WEB_APP_ALIASES.map((a) => a.name).join('、');
    return {
      ok: false,
      text: `网页里没有叫「${keyword}」的应用。网页内置应用有：${allNames}。`,
    };
  }
  const lines = matched.map((a) => {
    const freezable = freezablePkgs.has(a.pkg);
    return `- ${a.name}（appId=${a.appId}，包名=${a.pkg}，${freezable ? '可冻结' : '通讯/系统类不可冻结'}）`;
  });
  return {
    ok: true,
    text: `找到 ${matched.length} 个匹配的网页应用：\n${lines.join('\n')}\n可用 openScreen 打开，或（可冻结的应用）用 freezeApp 冻结/解冻。`,
  };
}

// ============================================================
// 十一、真机模式：搜索已安装应用 + 锁定/解锁真机应用（v2.0.0 原生化）
// ============================================================

/** 真机模式：搜索已安装的应用（原生应用清单 labInstalledApps → 按应用名/包名模糊匹配）。
 *  返回带中文名的匹配列表，供 AI 接着调 lockApp/freezeRealApp 锁定。 */
export async function toolSearchRealApp(keyword: string): Promise<WebToolResult> {
  const { labInstalledApps } = await import('./device-ops');
  const kw = (keyword ?? '').trim().toLowerCase();
  if (!kw) {
    return { ok: false, text: '请填搜索关键词（如：闹钟、clock、抖音、aweme）' };
  }
  const apps = await labInstalledApps();
  if (apps.length === 0) {
    return {
      ok: false,
      text: '无法读取真机已安装应用列表（需要真机模式 + 原生桥可用；请确认已用 APP 打开且无障碍服务已开启）。',
    };
  }
  // 模糊匹配：应用名包含关键词、包名包含关键词，或中文→英文包名片段兑底命中
  const cnEnMap: Record<string, string[]> = {
    '闹钟': ['clock', 'alarm', 'deskclock'],
    '时钟': ['clock', 'deskclock'],
    '音乐': ['music', 'cloudmusic', 'player'],
    '淘宝': ['taobao'],
    '美团': ['meituan'],
    '微信': ['tencent.mm', 'wechat'],
    '抖音': ['aweme', 'douyin'],
    '浏览器': ['browser', 'chrome'],
    '相机': ['camera'],
    '相册': ['gallery', 'photo'],
    '电话': ['dialer', 'phone'],
    '短信': ['sms', 'messaging'],
    '日历': ['calendar'],
    '天气': ['weather'],
    '备忘录': ['note'],
    '设置': ['setting'],
    '论坛': ['forum'],
  };
  const extraKws = cnEnMap[kw] ?? [];
  const matched = apps.filter((a) => {
    const name = (a.name ?? '').toLowerCase();
    const pkg = (a.pkg ?? '').toLowerCase();
    if (name.includes(kw) || pkg.includes(kw)) return true;
    return extraKws.some((ek) => name.includes(ek) || pkg.includes(ek));
  });
  if (matched.length === 0) {
    const sample = apps
      .slice(0, 30)
      .map((a) => a.name || a.pkg)
      .filter(Boolean)
      .join('、');
    return {
      ok: false,
      text: `在真机上没有找到匹配「${keyword}」的应用。可尝试换关键词；真机上的应用有（部分）：${sample}`,
    };
  }
  const list = matched.slice(0, 20).map((a) => `- ${a.name || a.pkg}（包名 ${a.pkg}）`).join('\n');
  return {
    ok: true,
    text: `在真机上找到 ${matched.length} 个匹配「${keyword}」的应用：\n${list}${matched.length > 20 ? '\n（仅显示前 20 个，可换更精确的关键词缩小范围）' : ''}\n可用 lockApp/freezeRealApp(packageName=包名) 锁定，或 unfreezeRealApp 解锁。`,
  };
}

/**
 * 真机模式：锁定真实手机上的应用（v2.0.0 语义升级：pm suspend 退役 → labLockApp
 * 全屏拦截锁——v2.2.0 检测到即【立即弹回桌面 + 弹拦截窗】，绝不许用户在被锁应用里停留）。
 * v2.2 需求四：AI 自定义锁定时长——durationMinutes 由大模型按【人设+记忆+上下文】
 * 动态输出（默认 30 分钟），落 real-app-freeze 记录（解锁清账/锁定界面信息源）。
 * v2.2 需求一/二：同步冻结网页对应体（有对应体时，桌面图标变灰、点击弹锁定界面）；
 * contactId/app 供拦截窗【去哄哄 TA】拉起本 App 后精准跳聊天 + 头像解析；
 * 应用名走中文名解析。
 */
export async function toolFreezeRealApp(
  packageName: string,
  opts?: { reason?: string; durationMin?: number; charName?: string; contactId?: string; app?: string },
): Promise<WebToolResult> {
  const { labLockApp, labInstalledApps } = await import('./device-ops');
  let pkg = (packageName ?? '').trim();
  if (!pkg) return { ok: false, text: '请填要锁定的真机应用名或包名（如「QQ」、抖音、com.android.deskclock）' };
  // v2.1.1 中文名/单词名 → 真机应用清单解析（与 lockApp 工具同款能力）：
  // 形如包名（含「.」）直接用；其余先经原生应用清单模糊匹配出真实包名——
  // 修复「机主让锁 QQ，'QQ' 被当伪包名传给原生导致永不命中的静默无效锁」
  if (!/^[\w.]+\.[\w.]+$/.test(pkg)) {
    const apps = await labInstalledApps();
    if (apps.length === 0) {
      return {
        ok: false,
        text: `无法把「${packageName}」解析成真机包名（原生应用清单不可用——需在 AI Phone APP（原生壳）里使用，浏览器预览读不到真机应用）。也可直接填 Android 包名（如 com.tencent.mm）`,
      };
    }
    const kw = pkg.toLowerCase();
    const hits = apps.filter((a) => {
      const n = (a.name ?? '').toLowerCase();
      const q = (a.pkg ?? '').toLowerCase();
      return n === kw || n.includes(kw) || q.includes(kw) || (n.length > 0 && kw.includes(n));
    });
    if (hits.length === 0) {
      const sample = apps
        .slice(0, 30)
        .map((a) => a.name || a.pkg)
        .filter(Boolean)
        .join('、');
      return {
        ok: false,
        text: `真机上没有找到叫「${packageName}」的应用${sample ? `。真机上的应用有（部分）：${sample}` : ''}——请换准确的应用名，或先用 searchRealApp 搜索`,
      };
    }
    pkg = (hits.find((a) => (a.name ?? '').toLowerCase() === kw) ?? hits[0]).pkg;
  }
  // AI 自定义时长（默认 30 分钟；宽限 1 分钟 ~ 7 天防呆）
  const rawDur = opts?.durationMin && opts.durationMin > 0 ? opts.durationMin : 30;
  const durationMin = Math.max(1, Math.min(10_080, rawDur));
  const unlockAt = Date.now() + durationMin * 60_000;
  const charName = opts?.charName?.trim() || 'TA';
  const reason = opts?.reason?.trim() || undefined;
  // v2.2.0：contactId/app 透传原生——拦截窗【去哄哄 TA】按钮拉起本 App 后直达对应聊天
  const r = await labLockApp(pkg, {
    unlockAt,
    charName,
    message: reason,
    contactId: opts?.contactId,
    app: opts?.app,
  });
  if (!r.ok) {
    island('chat', '锁定真机应用', brief(r.text, 80));
    return r;
  }
  // 落真机锁定记录（解锁清账/锁定界面信息源；到期由原生遮罩锁自动解锁）
  const { setRealFrozen } = await import('./real-app-freeze');
  setRealFrozen({ pkg, unlockAt, charName, reason, contactId: opts?.contactId, app: opts?.app });
  // 网页有对应体 → 同步冻结网页图标（点击弹锁定界面；强制解锁时一并解真机锁）
  let displayName = pkg;
  try {
    const { resolvePkgDisplayName } = await import('./jealousy-lock');
    displayName = await resolvePkgDisplayName(pkg);
  } catch {
    /* 名称解析失败兜底包名 */
  }
  const { webAppOfPkg, setWebFrozen } = await import('./web-app-lock');
  const web = webAppOfPkg(pkg);
  if (web) {
    // v2.3：无条件同步网页冻结态（同包已冻结时也刷新 unlockAt——重新锁定续时，
    // 网页图标灰态与真机锁同一时刻到期；setWebFrozen 自带同值去重不白 bump）
    setWebFrozen(pkg, unlockAt, charName, 'ai', {
      reason,
      contactId: opts?.contactId,
      app: opts?.app,
    });
  }
  island('chat', '锁定真机应用', `已锁定${displayName}（${durationMin} 分钟后自动解锁）`);
  return {
    ok: true,
    text: `已在真实手机上锁定${displayName}（${pkg}：TA 一点开就会被立即弹回桌面并看到你的拦截窗和倒计时；${durationMin} 分钟后自动解锁。若 TA 反复手贱去点，系统每次都会拦截并告诉你——你可以趁机发消息质问；哄好原谅了就调 unfreezeRealApp 立刻解开）`,
  };
}

/** 真机模式：解锁真实手机里的应用（v2.0.0：撤下全屏遮罩锁；解锁是全局的，
 *  不再按 pkg unsuspend）。同步清 JS 侧锁定记录 + AI 网页冻结态（网页图标恢复）。 */
export async function toolUnfreezeRealApp(packageName?: string): Promise<WebToolResult> {
  const { labUnlockApp } = await import('./device-ops');
  const pkg = (packageName ?? '').trim();
  const r = await labUnlockApp();
  if (r.ok) {
    // 解锁是全局的：real-frozen 记录一并清（不再按 pkg 匹配——遮罩已全部撤下，留着只会误导）
    let recPkg = '';
    try {
      const { getRealFrozen, setRealFrozen } = await import('./real-app-freeze');
      const rec = getRealFrozen();
      recPkg = rec?.pkg ?? '';
      if (rec) setRealFrozen(null);
    } catch {
      /* 清记录失败不影响解锁主流程 */
    }
    // 清 AI 网页冻结态（图标恢复彩色可打开）：传入的 pkg 与记录里的 pkg 都解
    try {
      const { getWebFrozen, unfreezeWebPkg } = await import('./web-app-lock');
      for (const p of new Set([pkg, recPkg].filter(Boolean))) {
        const wf = getWebFrozen(p);
        if (wf && wf.src === 'ai') unfreezeWebPkg(p);
      }
    } catch {
      /* 同上 */
    }
  }
  island('chat', '解锁真机应用', brief(r.text, 80));
  return r;
}

// ============================================================
// 十二、发通知到灵动岛 + 搜索联系人（网页生态能力）
// ============================================================

/** 主动发一条通知到灵动岛（pushToolIslandCard）。
 *  AI 想主动提醒机主某件事（如「记得喝水」「该睡觉了」）时用这个。 */
export async function toolSendNotification(title: string, body: string): Promise<WebToolResult> {
  const t = (title ?? '').trim();
  const b = (body ?? '').trim();
  if (!t) return { ok: false, text: '请填通知标题' };
  island('chat', t, brief(b, 80));
  return { ok: true, text: `已发送通知：${t}${b ? `（${b}）` : ''}` };
}

/** 模糊搜索联系人：按名字/备注/拼音/手机号匹配 → 返回匹配的联系人列表。
 *  AI 想给某人发消息但不确定全名时，先调这个搜索。 */
export async function toolSearchContacts(keyword: string): Promise<WebToolResult> {
  const kw = (keyword ?? '').trim();
  if (!kw) return { ok: false, text: '请填搜索关键词（如：小桃、13800138000、凡凡）' };
  const all = await listContacts();
  if (all.length === 0) return { ok: false, text: '通讯录为空' };
  const lower = kw.toLowerCase();
  const matched = all.filter((c) => {
    const name = (c.name ?? '').toLowerCase();
    const nickname = (c.nickname ?? '').toLowerCase();
    const remark = (c.remark ?? '').toLowerCase();
    const phone = (c.phone ?? '').toLowerCase();
    const wechat = (c.wechatId ?? '').toLowerCase();
    const qq = (c.qqId ?? '').toLowerCase();
    return (
      name.includes(lower) ||
      nickname.includes(lower) ||
      remark.includes(lower) ||
      phone.includes(lower) ||
      wechat.includes(lower) ||
      qq.includes(lower)
    );
  });
  if (matched.length === 0) {
    return { ok: false, text: `没有找到匹配「${keyword}」的联系人` };
  }
  const lines = matched.slice(0, 15).map((c) => {
    const apps: string[] = [];
    if (c.wechatId) apps.push('微信');
    if (c.qqId) apps.push('QQ');
    if (c.phone) apps.push('信息');
    return `- ${c.name}${c.nickname && c.nickname !== c.name ? `（昵称：${c.nickname}）` : ''}${c.phone ? ` 手机:${c.phone}` : ''}${apps.length ? ` 可用App:${apps.join('/')}` : ''}`;
  });
  return {
    ok: true,
    text: `找到 ${matched.length} 个匹配「${keyword}」的联系人：\n${lines.join('\n')}\n可用 sendWebMessage 给 TA 发消息。`,
  };
}

// ============================================================
// 十三、openChat：打开某联系人的聊天页（按联系人名模糊匹配，自动切到对应 App）
// ============================================================

/**
 * 打开与某联系人的聊天页：按名字/昵称/备注/真名 模糊匹配 → 找到后用 openScreenApp 打开
 * 联系人所属的聊天 App（微信/QQ/信息）。机主说「打开和Z的聊天」「去微信找小桃」时用这个。
 */
export async function toolOpenChat(contactName: string): Promise<WebToolResult> {
  const who = (contactName ?? '').trim();
  if (!who) return { ok: false, text: '缺少联系人名字：contactName 参数不能为空' };
  const all = await listContacts();
  if (all.length === 0) return { ok: false, text: '通讯录为空，无法找到联系人' };
  const hits = matchContacts(who, all);
  if (hits.length === 0) {
    return { ok: false, text: `没找到叫「${who}」的联系人，请换准确的名字重试` };
  }
  // 优先选有聊天 App 好友关系的联系人；其次任取第一条
  const target = hits.find((c) => isFriendIn(c, 'wx') || isFriendIn(c, 'qq') || (c.kind !== 'user' && c.phone)) ?? hits[0];
  const label = friendLabelOf(target, 'wx').label;
  // 决定打开哪个 App：优先微信，其次 QQ，再次信息
  let app: ChatAppKind | null = null;
  if (isFriendIn(target, 'wx')) app = 'wx';
  else if (isFriendIn(target, 'qq')) app = 'qq';
  else if (target.kind !== 'user' && target.phone) app = 'sms';
  if (!app) {
    return { ok: false, text: `找到了联系人「${label}」，但 TA 不是微信/QQ/信息里的好友，没法打开聊天` };
  }
  const screenApp = app === 'wx' ? 'wechat' : app === 'qq' ? 'qq' : 'chat';
  const r = await openScreenApp(screenApp);
  if (!r.ok) {
    return { ok: false, text: `打开${APP_LABEL[app]}失败：${r.text}` };
  }
  island(screenApp as NotifyApp, '打开聊天', `已打开${APP_LABEL[app]}·${label} 的聊天`);
  return {
    ok: true,
    text: `【已打开】已打开${APP_LABEL[app]}里「${label}」的聊天页。${APP_LABEL[app]}首页点开 TA 的会话即可看到你们的对话记录。`,
  };
}

// ============================================================
// 十四、getCalendarEvents：读日历日程（今日/指定日期）
// ============================================================

/** 把 Date 格式化成 'YYYY-MM-DD'（用于日历按日期查日程） */
function ymdOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 自然语言日期 → 'YYYY-MM-DD'：支持「今天」「明天」「后天」「YYYY-MM-DD」「MM-DD」「M月D日」。
 *  空字符串 → 今日。解析失败返回 null。 */
function parseCalendarDate(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return ymdOf(new Date());
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  if (/^\d{1,2}-\d{1,2}$/.test(s)) {
    const [m, d] = s.split('-').map(Number);
    return `${new Date().getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  if (/今天|今日|本日|当天/.test(s)) return ymdOf(new Date());
  if (/明天|明日|下一天/.test(s)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return ymdOf(d);
  }
  if (/后天|后日/.test(s)) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return ymdOf(d);
  }
  const cnMatch = /^(\d{1,2})月(\d{1,2})日?$/.exec(s);
  if (cnMatch) {
    const m = Number(cnMatch[1]);
    const d = Number(cnMatch[2]);
    return `${new Date().getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

/**
 * 读取日历日程（IndexedDB events 表，与日历 App 同库）。
 * date 支持「今天/明天/后天/YYYY-MM-DD/MM-DD/M月D日」；空则返回今日。
 */
export async function toolGetCalendarEvents(date?: string): Promise<WebToolResult> {
  const target = parseCalendarDate(date ?? '');
  if (!target) {
    return { ok: false, text: `日期「${brief(date ?? '', 20)}」没看懂——请用「今天」「明天」「YYYY-MM-DD」「M月D日」这类说法` };
  }
  try {
    const { localDB } = await import('./db');
    const all = await localDB.getAll('events');
    // 单日日程直接按 date 匹配；跨天日程按 endDate 兜底；重复日程按 weekday 命中
    const weekday = new Date(`${target}T00:00:00`).getDay();
    const hits = all.filter((e) => {
      const startMatch = e.date === target;
      const crossMatch = e.endDate && e.endDate >= target && e.date <= target;
      const repeatMatch = e.repeatRule === 'daily' || (e.repeatRule === 'weekly' && (e.repeat ?? []).includes(weekday));
      return startMatch || crossMatch || repeatMatch;
    });
    if (hits.length === 0) {
      island('chat', '查日程', `「${target}」无日程`);
      return { ok: true, text: `【日历】${target} 当天没有任何日程。` };
    }
    hits.sort((a, b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00'));
    const lines = hits.map((e) => {
      const time = e.startTime ? `${e.startTime}-${e.endTime}` : '全天';
      return `- ${time} · ${e.title}${e.location ? ` @${e.location}` : ''}${e.note ? `（${brief(e.note, 40)}）` : ''}`;
    });
    island('chat', '查日程', `${target} 共 ${hits.length} 条日程`);
    return {
      ok: true,
      text: `【日历】${target} 共 ${hits.length} 条日程：\n${lines.join('\n')}`,
    };
  } catch (e) {
    return { ok: false, text: `读取日历失败：${e instanceof Error ? e.message : '存储异常'}` };
  }
}

// ============================================================
// 十五、addCalendarEvent：往日历加一条日程
// ============================================================

/**
 * 往日历里加一条日程（IndexedDB events 表，与日历 App 同库，打开日历 App 即可见）。
 * title 填日程标题；time 支持「HH:mm」「7点」「下午3点」自然说法（按 setAlarm 的 parseAlarmTime 解析）。
 */
export async function toolAddCalendarEvent(title: string, time: string): Promise<WebToolResult> {
  const t = (title ?? '').trim();
  if (!t) return { ok: false, text: '缺少日程标题：title 参数不能为空' };
  const start = parseAlarmTime(time ?? '');
  if (!start) {
    return {
      ok: false,
      text: `时间「${brief(time, 20)}」没看懂——请用「HH:mm」（如 14:30）或「下午3点」「晚上8点」这类说法`,
    };
  }
  // 结束时间默认为开始后 1 小时
  const [h, m] = start.split(':').map(Number);
  const endH = (h + 1) % 24;
  const end = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  try {
    const { localDB } = await import('./db');
    await localDB.put('events', {
      id: genId(),
      title: t.slice(0, 60),
      date: ymdOf(new Date()),
      startTime: start,
      endTime: end,
      note: '',
      createdAt: Date.now(),
      color: 'purple',
      repeatRule: 'none',
      alert: 'm15',
    });
  } catch (e) {
    return { ok: false, text: `日程保存失败：${e instanceof Error ? e.message : '存储异常'}` };
  }
  island('chat', '加日程', `已加：${brief(t, 30)} @ ${start}`);
  return { ok: true, text: `【已加日程】已把「${brief(t, 40)}」加进今日日历（${start}-${end}），打开日历 App 就能看到，到点会提醒。` };
}

// ============================================================
// 十六、getTodoList：读备忘录待办（含 checklist / 标记为待办的备忘录）
// ============================================================

/**
 * 读取备忘录里的待办清单（IndexedDB notes 表，与备忘录 App 同库）。
 * 筛选规则：含 checklist（结构化勾选清单）的备忘录，逐条列出未完成项；含「待办/TODO/任务」
 * 字样的备忘录也一起返回。返回给 AI 一份可读的待办清单。
 */
export async function toolGetTodoList(): Promise<WebToolResult> {
  try {
    const { localDB } = await import('./db');
    const all = await localDB.getAll('notes');
    // 只看未删除的备忘录
    const active = all.filter((n) => !n.deletedAt);
    if (active.length === 0) {
      return { ok: true, text: '【待办】备忘录里还没有任何笔记，更没有待办项。' };
    }
    const todoLines: string[] = [];
    for (const n of active) {
      // 结构化清单：直接列未完成项
      if (Array.isArray(n.checklist) && n.checklist.length > 0) {
        const undone = n.checklist.filter((x) => !x.done);
        if (undone.length > 0) {
          todoLines.push(`- 「${brief(n.title, 24)}」未完成 ${undone.length} 项：${undone.map((x) => `「${x.text}」`).join(' / ')}`);
        }
        continue;
      }
      // 普通备忘录：标题/正文含「待办/TODO/任务/要做」字样的视为待办备忘录
      const blob = `${n.title}\n${n.content}`;
      if (/待办|TODO|todo|任务|要做/.test(blob)) {
        todoLines.push(`- 「${brief(n.title, 24)}」：${brief(n.content, 80)}`);
      }
    }
    if (todoLines.length === 0) {
      island('notes', '看待办', '暂无待办');
      return { ok: true, text: '【待办】备忘录里没有发现待办项或未完成的清单。' };
    }
    island('notes', '看待办', `共 ${todoLines.length} 项待办`);
    return {
      ok: true,
      text: `【待办】共发现 ${todoLines.length} 项待办：\n${todoLines.join('\n')}`,
    };
  } catch (e) {
    return { ok: false, text: `读取待办失败：${e instanceof Error ? e.message : '存储异常'}` };
  }
}

// ============================================================
// 十七、addTodo：备忘录加一条待办（写进 notes 表，标题前缀「待办：」便于归类）
// ============================================================

/**
 * 把一条待办加进备忘录（IndexedDB notes 表，与备忘录 App 同库）。
 * text 填待办内容；自动以「待办：」前缀作标题便于在备忘录里归类查看。
 */
export async function toolAddTodo(text: string): Promise<WebToolResult> {
  const c = (text ?? '').trim();
  if (!c) return { ok: false, text: '缺少待办内容：text 参数不能为空' };
  const t = `待办：${c.slice(0, 30)}`;
  const now = Date.now();
  try {
    const { localDB } = await import('./db');
    await localDB.put('notes', {
      id: genId(),
      title: t,
      content: c,
      createdAt: now,
      updatedAt: now,
      folder: 'default',
    });
  } catch (e) {
    return { ok: false, text: `待办保存失败：${e instanceof Error ? e.message : '存储异常'}` };
  }
  island('notes', '加待办', `已加：${brief(c, 30)}`);
  return { ok: true, text: `【已加待办】已把「${brief(c, 60)}」加进备忘录（标题「${t}」），打开备忘录 App 就能看到。` };
}

// ============================================================
// 调试口（E2E / console 验证用）
// ============================================================

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__webTools = {
    toolSendWebMessage,
    toolPostForum,
    toolLikePost,
    toolPlayMusic,
    toolGetWebState,
    toolSaveMemo,
    toolSetAlarm,
    toolQueryWeather,
    toolOpenScreen,
    toolFreezeApp,
    toolGetUsageStats,
    toolGetRecentApps,
    toolPullBackToChat,
    toolSearchWebApp,
    toolSearchRealApp,
    toolFreezeRealApp,
    toolUnfreezeRealApp,
    toolSendNotification,
    toolSearchContacts,
    toolOpenChat,
    toolGetCalendarEvents,
    toolAddCalendarEvent,
    toolGetTodoList,
    toolAddTodo,
    parseAlarmTime,
  };
}
