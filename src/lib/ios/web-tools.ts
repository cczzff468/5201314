'use client';

/**
 * Web 生态内部工具层（v1.9.35 机主重构令：「智能体工作流全面转入 Web 网页生态」）。
 *
 * 真机底层多步自动化（pm suspend / uiautomator / Shizuku 截屏点按）全面退役——
 * 所有 App 都活在本项目的虚拟手机网页里，AI 只需要调用这里的内部 Web 路由函数：
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

// ---------------- 通用 ----------------

export interface WebToolResult {
  ok: boolean;
  text: string;
}

/** 灵动岛过程卡快捷出口（每个工具执行后都弹一张，标题=动作，正文=结果） */
function island(app: NotifyApp, title: string, body: string): void {
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
    parseAlarmTime,
  };
}
