'use client';

/** 主界面 MainScreen（四 tab 路由） —— v1.9.27 任务10 从 wechat.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, BellOff, CheckCheck, AppWindow, EyeOff, MailOpen, MessageCircle, Newspaper, Pin, PinOff, Plus, QrCode, ScanLine, Search, Tag, Trash2, User, UserPlus, Users, Wallet, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSettings } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
import { openScan } from '../mt-scan';
import { takeNotifyNavigation, ISLAND_NAV_EVENT } from '@/lib/ios/island-notify';
import { groupPreview, getGroup, listGroups, updateGroup as updateGroupRecord, dissolveGroup as dissolveGroupRecord, quitGroup as quitGroupRecord, type ChatGroup } from '@/lib/ios/groups';
import { WxGroupChatPage, WxGroupCreatePage, WxGroupInfoPage, WxGroupListPage, GroupAvatar, groupRowId } from '../wx-group';
// Task 40 错误提示优化 + 草稿箱：错误分类与连续失败冷却、会话草稿持久化、失败灰字提示行组件
import { useChatStreamFinalized } from '@/lib/chat-stream-store';
import {
  WxIcMoments,
  WxIcChannels,
  WxIcScan,
  WxIcListen,
  WxIcStories,
  WxIcSearch,
  WxIcGames,
  WxIcServices,
  WxIcFavorites,
  WxIcWorks,
  WxIcSticker,
  WxIcTheme,
  WxIcSettings,
  WxTabCompassIcon,
} from '../wx-icons';
import { RtChatIcon, RtContactsIcon, RtDiscoverIcon, RtMeIcon, RetroIc, RETRO_ICON_TONES, RtWMoments, RtWChannels, RtWScan, RtWListen, RtWStories, RtWSearch, RtWGames, RtWTheme, RtWWallet, RtWFavorites, RtWWorks, RtWSticker, RtWSettings } from '../retro-icons';
import { setUserBlock } from '@/lib/ios/block-state';
import { setGroupSocialContacts } from '@/lib/ios/group-social';
// 美团×AI 联动（外卖参与/双向代付）：动作执行、上下文块、历史序列化
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// v1.3 Shizuku 自主权：[手机操作:命令] 标记的执行器 + 按开关动态注入的教学规则（设置 APP → AI 动手）
import { memResetConvoCounters } from '@/lib/memory';
// 第十六轮：AI 动态状态（情绪+作息）注入 + 送礼物情绪事件
import { addCharMomentPost, addUserMomentComment, addUserMomentPost, aiPostMoment, deleteMomentComment, deleteMomentPost, enqueuePostInteractions, isPostByPeer, listMomentNotices, listMomentPosts, markAllMomentNoticesRead, subscribeMomentsChanged, toggleUserMomentLike, updateMomentPostContent, type MomentNotice } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { AskPostSheet, EditPostDialog, MomentAutoCfgSheet, MomentInteractionsPage, momentFriendsOf } from '../moments-shared';
import { MomentsSettingsPage } from '../moments-settings';
import { ThemeStylePage } from '../bubble-style-settings';
import { liquidTabLabel, LIQUID_TABS } from '@/lib/ios/liquid-skin';
import { isLiquidTheme, isRetroTheme } from '@/lib/ios/bubble-style';
// 多账号 v2（Task 40-2a）：per-app 账号 API——accLs 键作用域调用时现算；switchAccountFor 切换只写标记+派发事件（不刷新网页）
// 第三十四轮：添加账号弹层（AccountAddSheet）删除——「添加账号」改为直接用账号密码登录（LoginScreen）
import { ACCOUNT_CHANGED_EVENT, getActiveAccountFor } from '@/lib/ios/accounts';
import { updateContact } from '@/lib/ios/contacts-store';
import AlbumPage from '../album';
import { contactByRef, displayNameOf, isFriendIn, liveAvatarOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { addFriendReq, isFriendDeleted, rejectFriendReq, removeFriendByUser, restoreFriendship, setFriendReqStatus, SOURCE_SEARCH_WX, subscribeFriendReqs, charWelcomeReplyToApply, processAltFriendReq, clearFriendDelState, FRIEND_STATE_APPLIED_EVENT, type FriendReqExtras } from '@/lib/ios/friend-state';
import { useUnreadMap } from '@/lib/unread-store';
// v73 AI 聊天悬浮小窗：顶栏「小窗模式」按钮入口（打开全局小窗并退出全屏聊天）
import { peekBgBadgeCounts } from '@/lib/ios/bg-turn';
import { useChatFlags, wxChatFlags as wxChatFlagsStore } from '@/lib/chat-flags';
import { FriendDeleteConfirmDialog } from '../chat-settings';
import { deleteCharacterBranch, getBranchMeta } from '@/lib/ios/branch';
import { BranchDeleteConfirmDialog } from '../branch-dialog';
import { WxServices } from '../wechat-wallet';

import { ChatPage } from './chat-page';
import { FRIEND_POST_TEMPLATES, LS_CHAT_HIDDEN, WxFriendReq, WxMoment, WxMsg, WxUser, fmtListTime, initialOf, loadMoments, loadMsgs, loadReqs, loadStrList, meAsContact, readPreview, saveMsgs, saveStrList, uid, wxUnreads } from './core';
import { ComposeMomentsPage, MomentsPage } from './moments';
import { AddFriendPage, ApplyFriendPage, FriendDetailPage, FriendReqDetailPage, NewFriendsPage, ProfilePage, WxAccountSwitchPage, WxFavoritesPage, WxLookPage, WxSearchPage, WxSettingsPage } from './pages';
import { WxStickersPage } from './stickers';
import { WxAvatar, WxLiquidWidgets, WxMenuRow, WxTileIcon } from './widgets';

// ---------------- 主界面（四 tab） ----------------

export type Tab = 'chats' | 'contacts' | 'discover' | 'me';
export type Page =
  | 'main'
  | 'moments'
  | 'compose'
  | 'momentNotices'
  | 'newFriends'
  | 'addFriend'
  | 'applyFriend'
  | 'friendReqDetail'
  | 'friendDetail'
  | 'friendMoments'
  | 'profile'
  | 'settings'
  | 'services'
  | 'stickers'
  | 'favorites'
  | 'album'
  | 'search'
  | 'momentsSettings'
  | 'accountSwitch'
  | 'look'
  | 'dress';


export function MainScreen({
  me,
  contacts,
  myRealName,
  ownerName,
  reloadContacts,
  onLogout,
  onExit,
  onLoginAccount,
}: {
  me: WxUser;
  contacts: ContactRecord[];
  /** 当前登录用户的真实姓名（钱包持卡人用，非昵称） */
  myRealName: string;
  /** NPC 归属者名字查询（按聊天对端计算，供人设 prompt 使用） */
  ownerName: (peer: ContactRecord) => string | null;
  reloadContacts: () => Promise<ContactRecord[]>;
  onLogout: () => void;
  onExit: () => void;
  /** 切换账号页「登录小号」自由登录成功 → 根组件 handleLogin（Task 41） */
  onLoginAccount: (u: WxUser) => void;
}) {
  const [tab, setTab] = useState<Tab>('chats');
  const [chatPeer, setChatPeer] = useState<ContactRecord | null>(null);
  /** 群聊：群列表缓存 / 正在聊的群 / 群子页（create=发起群聊、list=通讯录群聊列表）/ 群聊信息页 */
  const [wxGroups, setWxGroups] = useState<ChatGroup[]>(() => listGroups('wx'));
  const [groupPeer, setGroupPeer] = useState<ChatGroup | null>(null);
  const [groupPage, setGroupPage] = useState<null | 'create' | 'list'>(null);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const refreshGroups = useCallback(() => setWxGroups(listGroups('wx')), []);
  // 群社交：把联系人快照喂给 group-social（建群/拉人名单、被踢通知的宿主侧数据源）
  useEffect(() => {
    setGroupSocialContacts(contacts);
  }, [contacts]);
  // 退群挽留：AI 把机主拉回群后（quit-flow 恢复群记录并广播事件）立即刷新群列表，恢复的群回到会话列表
  useEffect(() => {
    const fn = () => refreshGroups();
    window.addEventListener('quit-flow:group-restored', fn);
    return () => window.removeEventListener('quit-flow:group-restored', fn);
  }, [refreshGroups]);
  /** 详情页（联系人详细界面）：从聊天设置信息卡片 / 通讯录进入；返回与朋友圈回退链见渲染分支 */
  const [detail, setDetail] = useState<ContactRecord | null>(null);
  /** Task 28-b 详情页通话桥：详情页「音视频通话」ActionSheet 选语音/视频后暂存待拨通话——
   *  宿主关详情页并打开对应聊天页时下发，ChatPage 挂载后消费拨号（openVoiceCall 全链路） */
  const [pendingCall, setPendingCall] = useState<{ contactId: string; media: 'voice' | 'video' } | null>(null);
  /** Task 37 角色分支：待确认删除的分支角色（详情页「删除该分支」→ 二次确认 → 真删） */
  const [branchDelTarget, setBranchDelTarget] = useState<ContactRecord | null>(null);
  /** 正在浏览其朋友圈的好友（page = 'friendMoments'） */
  const [friendMoments, setFriendMoments] = useState<ContactRecord | null>(null);
  const [page, setPage] = useState<Page>('main');
  /** 朋友圈页内容范围：all = 全部动态（发现页入口）；mine = 只看我发的（「我」页/自己详情页入口） */
  const [momentsScope, setMomentsScope] = useState<'all' | 'mine'>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [moments, setMoments] = useState<WxMoment[]>(() => loadMoments());
  /**
   * 头像实时读取（换头像后所有历史展示位立即同步）：朋友圈等历史数据里存的是写入当时的头像快照，
   * 渲染前统一过 liveAvatarOf —— 联系人还在就显示当前头像（App 槽位优先、回退全局），
   * 联系人已删除才回退快照原值（宁旧勿丢）。QQ/微信/信息共用同一套解析（contacts.ts）。
   */
  const liveWxAvatar = useCallback(
    (snapshot: string | null | undefined, ref: { peerId?: string | null; name?: string | null }) =>
      liveAvatarOf(snapshot, ref, contacts, 'wx'),
    [contacts]
  );
  /**
   * 删好友可见性门控（朋友圈/互动消息）：被删好友（wx 端存在 friend-del 状态）的动态与互动
   * 不再展示——数据本体保留，重新加回好友（删除状态清除）后自动恢复可见。
   * contacts 变化（删除/加回都会 reloadContacts）即重算，无需额外事件。
   */
  const isAuthorHidden = useCallback(
    (ref: { peerId?: string | null; name?: string | null }): boolean => {
      const hit = contactByRef(ref, contacts);
      return !!hit && hit.kind !== 'user' && isFriendDeleted('wx', hit.id);
    },
    [contacts]
  );
  const momentsLive = useMemo(
    () => {
      // 自己发的动态（author='user'，peerId=null 仅名字归因）：改名/换头像后按机主联系人实时解析
      // 名字与头像——避免改名后旧帖回退到落库时的旧快照（机主身份随联系人最新资料展示）
      const owner = contacts.find((c) => c.kind === 'user' && !c.altOf) ?? null;
      return moments
        .filter((p) => !isAuthorHidden({ peerId: p.peerId, name: p.authorName }))
        .map((p) =>
          p.author === 'user' && owner
            ? { ...p, authorName: displayNameOf(owner) || p.authorName, avatar: owner.avatar ?? p.avatar }
            : { ...p, avatar: liveWxAvatar(p.avatar, { peerId: p.peerId, name: p.authorName }) }
        );
    },
    [moments, liveWxAvatar, isAuthorHidden, contacts]
  );
  /** 用户 API 配置（让 AI 发动态时按人设生成内容用） */
  const apiConfig = useSettings((s) => s.apiConfig);
  /** 液态玻璃主题（气泡样式设置 › 界面主题）：四 tab 页面铭件（列表玻璃卡/悬浮 TabBar）切换玻璃视觉；
   *  默认主题全部走原类（像素级保持现状），主题只接管页面铭件、不动气泡与功能逻辑 */
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const liquid = isLiquidTheme(bubbleStyle, 'wx');
  /** 古早主题（第五十四轮）：四 tab 页面铭件（淡青灰底/银灰导航/白硬边分组卡/拟物 TabBar）切换拟物复古视觉 */
  const retro = isRetroTheme(bubbleStyle, 'wx');
  /** 液态玻璃皮肤（本轮新增）：分类标签自定义文字 / 列表小组件开关（液态主题下生效） */
  const liquidSkinWx = useSettings((s) => s.liquidSkin.wx);
  /** 「让好友发一条」弹层与生成中的联系人 id */
  const [askOpen, setAskOpen] = useState(false);
  const [askBusyId, setAskBusyId] = useState<string | null>(null);
  /** 正在配置自动发动态的好友（每角色 × 朋友圈） */
  const [cfgPeer, setCfgPeer] = useState<ContactRecord | null>(null);
  /** 正在编辑的动态（id + 当前正文） */
  const [editingPost, setEditingPost] = useState<{ id: string; text: string } | null>(null);
  const [reqs, setReqs] = useState<WxFriendReq[]>(() => loadReqs());
  // AI 加回申请 / 手动添加 / 验证消息线程回复由 friend-state 落盘后广播：订阅刷新列表 + 打开中的详情页
  useEffect(
    () =>
      subscribeFriendReqs(() => {
        setReqs(loadReqs());
        setReqDetail((cur) => (cur ? loadReqs().find((x) => x.id === cur.id) ?? cur : cur));
      }),
    [],
  );
  /** 新的朋友通知头像也实时读取（通知里存的快照 → 联系人在就显示当前头像） */
  const reqsLive = useMemo(
    () =>
      reqs.map((r) => {
        const hit = r.contactId ? contacts.find((c) => c.id === r.contactId) : undefined;
        return { ...r, avatar: liveWxAvatar(r.avatar, { peerId: r.contactId ?? null, name: hit?.name ?? r.name }) };
      }),
    [reqs, liveWxAvatar, contacts]
  );
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  /** 聊天列表管理（真微信同款）：置顶排序、消息免打扰铃铛（chat-flags 总线）、标为未读红点、不显示/删除（新消息自动恢复） */
  const flagsMap = useChatFlags(wxChatFlagsStore);
  const unreads = useUnreadMap(wxUnreads);
  const [hidden, setHidden] = useState<string[]>(() => loadStrList(LS_CHAT_HIDDEN));
  // 好友来信 / 未读变化 tick：会话预览与排序派生自 localStorage，需要 tick 触发 useMemo 重算
  const [msgTick, setMsgTick] = useState(0);
  useEffect(() => wxUnreads.subscribe(() => setMsgTick((t) => t + 1)), []);
  // 全局流式回复落盘 tick：聊天页外收到的 AI 回复写入存储后刷新会话预览/排序
  useChatStreamFinalized('wx:', () => setMsgTick((t) => t + 1));
  // 退出网页后继续回复（服务端接力）：挂载时拉各会话「待达消息」条数点亮未读角标
  //（同一批条目只在第一次查询时提示，正式拉取投递后自动解除；群聊会话不上报接力，天然无待达）
  useEffect(() => {
    void peekBgBadgeCounts().then((counts) => {
      for (const [key, n] of Object.entries(counts)) {
        if (!key.startsWith('wx:') || key.startsWith('wx:group:')) continue;
        wxUnreads.bump(key.slice(3), n);
      }
    });
  }, []);
  /** 长按菜单（QQ 同款竖向卡片：标为未读/置顶该聊天/不显示该聊天/删除该聊天；浅色白底黑字/深色深底白字） */
  const [ctx, setCtx] = useState<null | { contact: ContactRecord; x: number; y: number }>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ timer: number | null; x: number; y: number }>({ timer: null, x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const pinSet = useMemo(
    () => new Set(Object.keys(flagsMap).filter((id) => flagsMap[id]?.pinned === true)),
    [flagsMap]
  );

  /** 返回列表：从聊天页/详情页回来时重同步隐藏列表（saveMsgs 收到新消息会把联系人从隐藏中移除） */
  const backToList = () => {
    setHidden(loadStrList(LS_CHAT_HIDDEN));
    setChatPeer(null);
  };

  // 灵动岛通知点击跳转：打开通知对应的单聊/群聊（App 已打开时由事件驱动，未打开时挂载后自动消费 pending）
  useEffect(() => {
    const consume = () => {
      const t = takeNotifyNavigation('wechat');
      if (!t) return;
      if (t.groupId) {
        const g = getGroup(t.groupId);
        if (!g) return;
        setTab('chats');
        setPage('main');
        setDetail(null);
        setGroupPage(null);
        setHidden(loadStrList(LS_CHAT_HIDDEN));
        setChatPeer(null);
        setGroupPeer(g);
      } else if (t.contactId) {
        const c = contacts.find((x) => x.id === t.contactId);
        if (!c) return;
        setTab('chats');
        setPage('main');
        setDetail(null);
        setGroupPage(null);
        setHidden(loadStrList(LS_CHAT_HIDDEN));
        setGroupPeer(null);
        setChatPeer(c);
      }
    };
    consume();
    window.addEventListener(ISLAND_NAV_EVENT, consume);
    return () => window.removeEventListener(ISLAND_NAV_EVENT, consume);
  }, [contacts]);

  /** 好友（可聊天对象）：CHAR / NPC 中已添加微信好友的（微信好友独立，QQ/信息里添加的不算） */
  const friends = useMemo(
    () => contacts.filter((c) => c.kind !== 'user' && isFriendIn(c, 'wx')),
    [contacts]
  );

  /** 自己的完整联系人资料（个人资料页的性别 / 地区用） */
  const meRecord = useMemo(() => contacts.find((c) => c.id === me.id) ?? null, [contacts, me.id]);

  /** 会话列表：置顶优先，其余按最后消息时间倒序；已删除/不显示的隐藏（新消息自动恢复）；跟自己的会话有消息时也显示（同文件传输助手）；群会话按 group:<gid> 键共用置顶/免打扰/未读设施 */
  const sessions = useMemo<{ key: string; contact: ContactRecord | null; group: ChatGroup | null; preview: string; time: number }[]>(() => {
    const hiddenSet = new Set(hidden);
    const items: { key: string; contact: ContactRecord | null; group: ChatGroup | null; preview: string; time: number }[] = friends
      .filter((c) => !hiddenSet.has(c.id))
      .map((c) => {
        const p = readPreview(c.id);
        return { key: c.id, contact: c, group: null, preview: p.text, time: p.time };
      });
    const mine = readPreview(me.id);
    if (mine.text && !hiddenSet.has(me.id)) {
      const meContact = contacts.find((c) => c.id === me.id) ?? meAsContact(me);
      items.push({ key: meContact.id, contact: meContact, group: null, preview: mine.text, time: mine.time });
    }
    for (const g of wxGroups) {
      if (hiddenSet.has(groupRowId(g.id))) continue;
      const p = groupPreview(g.id);
      items.push({ key: groupRowId(g.id), contact: null, group: g, preview: p.text, time: p.time });
    }
    items.sort((a, b) => {
      const pa = pinSet.has(a.key) ? 0 : 1;
      const pb = pinSet.has(b.key) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (b.time || 0) - (a.time || 0);
    });
    return items;
    // chatPeer 入依赖：从聊天返回（或进入聊天）时重算预览，红包/转账/新消息即时反映到列表；msgTick：好友来信时重算；groups：群数据变更时重算
  }, [contacts, friends, me, chatPeer, pinSet, hidden, msgTick, wxGroups]);

  /** 液态主题分类标签栏（第四十三轮建立·第四十五轮精简，参考图）：全部/好友/群聊/服务号 过滤会话列表（默认主题不渲染该栏） */
  const [cat, setCat] = useState<'all' | 'friends' | 'work' | 'family' | 'groups' | 'officials'>('all');
  /** 分类过滤后的会话（仅液态主题使用；all = 不过滤） */
  const visibleSessions = useMemo(() => {
    if (!liquid || cat === 'all') return sessions;
    if (cat === 'groups') return sessions.filter((s) => s.group);
    if (cat === 'officials') return sessions.filter((s) => !s.group && s.contact && s.contact.id === me.id);
    // 好友 / 工作 / 家人：非群会话
    return sessions.filter((s) => {
      if (s.group || !s.contact) return false;
      if (s.contact.id === me.id) return false; // 自己的会话归「服务号」
      if (cat === 'friends') return true;
      if (cat === 'work') return Boolean(s.contact.occupation || s.contact.company);
      if (cat === 'family') return /家人|父母|父亲|母亲|爸爸|妈妈|哥哥|姐姐|弟弟|妹妹|亲戚|儿子|女儿/.test(s.contact.relation ?? '');
      return false;
    });
  }, [sessions, liquid, cat, me.id]);

  /** 液态列表分组（第四十四轮，用户指定）：置顶会话一张白色面板、非置顶会话一张白色面板（组内细分割线，卡间间隙）。
   *  注意：必须挂在所有早退 return 之前（hooks 顺序不可随 page 变化） */
  const liquidGroups = useMemo(() => {
    const pinned: typeof sessions = [];
    const rest: typeof sessions = [];
    for (const r of visibleSessions) {
      if (pinSet.has(r.key)) pinned.push(r);
      else rest.push(r);
    }
    const out: Array<typeof sessions> = [];
    for (const g of [pinned, rest]) if (g.length) out.push(g);
    return out;
  }, [visibleSessions, pinSet]);

  /** 幽灵未读清理：只保留当前可见会话的未读（不显示该聊天/已删联系人的残留计数没有行可清，
   *  会让底部 tab 与主屏图标角标卡死；prune 无变化时不写入，可安全随 sessions 重算触发） */
  useEffect(() => {
    wxUnreads.prune(sessions.map((s) => s.key));
  }, [sessions]);

  /** 长按会话 → 弹出 QQ 同款竖向卡片菜单（480ms 触发，移动超 12px 视为滚动取消） */
  const clearPress = () => {
    if (pressRef.current.timer) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  };
  const onSessionPointerDown = (e: React.PointerEvent, c: ContactRecord) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      const rect = rootRef.current?.getBoundingClientRect();
      const px = rect ? e.clientX - rect.left : e.clientX;
      const py = rect ? e.clientY - rect.top : e.clientY;
      // 竖向卡片（4 项，约 176×190）：水平居中于触点，上下钳制不溢出页面
      const rootW = rootRef.current?.clientWidth ?? 390;
      const rootH = rootRef.current?.clientHeight ?? 700;
      // 液态 = 横向 2×2 玻璃网格（320×118）；默认 = 竖向卡片（176×190）
      const MENU_W = liquid ? 320 : 176;
      const MENU_H = liquid ? 118 : 190;
      const x = Math.min(Math.max(px - MENU_W / 2, 10), Math.max(rootW - MENU_W - 10, 10));
      const y = Math.min(py, Math.max(rootH - MENU_H - 10, 10));
      setCtx({ contact: c, x, y });
      // 长按后拦截紧随的 click（不进入会话）
      suppressClickRef.current = true;
    }, 480);
  };
  const onSessionPointerMove = (e: React.PointerEvent) => {
    const t = pressRef.current;
    if (!t.timer) return;
    if (Math.abs(e.clientX - t.x) > 12 || Math.abs(e.clientY - t.y) > 12) clearPress();
  };

  // 关闭长按菜单并解除 click 拦截（避免菜单操作后下一次点击被吞掉）
  const closeCtx = () => {
    setCtx(null);
    suppressClickRef.current = false;
  };

  // 菜单操作（置顶/未读/不显示/删除）：置顶/未读写入与订阅通知由总线负责（落盘 + 实时同步各角标）
  const togglePin = (id: string) => {
    wxChatFlagsStore.togglePinned(id);
  };
  const toggleUnread = (id: string) => wxUnreads.toggle(id);
  const markRead = (id: string) => wxUnreads.clear(id);
  const hideSession = (id: string) => {
    if (!hidden.includes(id)) {
      const next = [...hidden, id];
      saveStrList(LS_CHAT_HIDDEN, next);
      setHidden(next);
    }
    showToast('已不显示该聊天');
  };
  const deleteSession = (id: string) => {
    saveMsgs(id, []); // 清空聊天记录；有新消息时该会话自动重新出现
    // 审计 #18：同步清记忆轮次计数/锚点（mem-msgcount:/mem-anchor:/mem-round: 该联系人全部键，不动碎片），
    // 避免旧锚点残留让清空后的新会话「凭空续旧记忆」
    void memResetConvoCounters(id);
    const nextHidden = hidden.includes(id) ? hidden : [...hidden, id];
    saveStrList(LS_CHAT_HIDDEN, nextHidden);
    setHidden(nextHidden);
    wxChatFlagsStore.reset(id); // 置顶/免打扰/聊天背景一并清除
    if (unreads[id]) wxUnreads.clear(id);
    showToast('已删除该聊天');
  };

  /** 聊天页返回键角标：除当前会话外的未读总数（和 A 聊天时 B 来信 → 返回键旁显示 B 的未读数） */
  const chatOtherUnread = useMemo(() => {
    if (!chatPeer) return 0;
    let sum = 0;
    for (const [id, n] of Object.entries(unreads)) {
      if (id !== chatPeer.id && n > 0) sum += n;
    }
    return sum;
  }, [unreads, chatPeer]);

  /** 底部「微信」tab 角标：全部会话未读总数 */
  const totalUnread = useMemo(() => {
    let sum = 0;
    for (const n of Object.values(unreads)) {
      if (n > 0) sum += n;
    }
    return sum;
  }, [unreads]);

  /** 通讯录字母分组 */
  const groups = useMemo(() => {
    const map = new Map<string, ContactRecord[]>();
    for (const c of friends) {
      const key = initialOf(c.name);
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return [...map.entries()]
      .map(([letter, list]) => ({
        letter,
        list: list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN-u-co-pinyin')),
      }))
      .sort((a, b) => {
        if (a.letter === '#') return 1;
        if (b.letter === '#') return -1;
        return a.letter.localeCompare(b.letter);
      });
  }, [friends]);

  /** 朋友圈更新：改由动态引擎写入，这里只从存储重读刷新视图（引擎每次落盘也广播 moments-changed） */
  const reloadMoments = useCallback(() => setMoments(loadMoments()), []);

  // ---------------- 互动消息（与我的互动消息：谁赞了我/评论了我/回复了我） ----------------
  const [wxNotices, setWxNotices] = useState<MomentNotice[]>(() => listMomentNotices('wx'));
  const refreshWxNotices = useCallback(() => setWxNotices(listMomentNotices('wx')), []);
  /** 互动消息头像实时读取（actorAvatar 快照 → 联系人在就显示当前头像）；被删好友的互动同口径隐藏 */
  const wxNoticesLive = useMemo(
    () =>
      wxNotices
        .filter((n) => !isAuthorHidden({ peerId: n.actorPeerId, name: n.actorName }))
        .map((n) => ({
          ...n,
          actorAvatar: liveWxAvatar(n.actorAvatar, { peerId: n.actorPeerId, name: n.actorName }),
        })),
    [wxNotices, liveWxAvatar, isAuthorHidden]
  );
  /** 气泡角标：未读条数 + 最新一条消息人的头像（「1条新消息」气泡展示用） */
  const wxNoticeBadge = useMemo(
    () => ({
      count: wxNoticesLive.filter((n) => !n.read).length,
      avatar: wxNoticesLive.find((n) => !n.read)?.actorAvatar ?? null,
    }),
    [wxNoticesLive]
  );
  /** 打开互动消息页：全部标记已读（气泡随之消失）+ 刷新列表 */
  const openWxNotices = useCallback(() => {
    markAllMomentNoticesRead('wx');
    refreshWxNotices();
    setPage('momentNotices');
  }, [refreshWxNotices]);
  /** 从互动消息页回复一条评论/回复（走引擎：AI 会自动再回复，新回复会进收件箱） */
  const replyToWxNotice = useCallback(
    (n: MomentNotice, text: string) => {
      if (!n.postId) {
        showToast('原动态已删除，无法回复');
        return;
      }
      const added = addUserMomentComment('wx', n.postId, {
        userName: me.name,
        content: text,
        replyTo: n.commentId ? { commentId: n.commentId, name: n.actorName } : undefined,
      });
      if (!added) {
        showToast('原动态已删除，无法回复');
        return;
      }
      refreshWxNotices();
      reloadMoments();
      showToast('已回复');
    },
    [me.name, refreshWxNotices, reloadMoments, showToast]
  );

  // 引擎（调度器/AI）在别处写入动态后同步本地视图（点赞/评论/新动态实时出现）
  useEffect(
    () =>
      subscribeMomentsChanged((platform) => {
        if (platform && platform !== 'wx') return;
        reloadMoments();
        refreshWxNotices();
      }),
    [reloadMoments, refreshWxNotices]
  );

  const publishMoment = useCallback(
    (text: string, images: string[], location?: string) => {
      // 统一走动态引擎：入库（含位置）+ 写看到它的角色记忆（聊天时懒入库）+ 排 AI 互动队列（8~18s 后好友点赞/评论）
      const post = addUserMomentPost('wx', { userName: me.name, avatar: me.avatar, content: text, images, location });
      enqueuePostInteractions('wx', post.id);
      reloadMoments();
      setMomentsScope('mine');
      setPage('moments');
      showToast('已发表到朋友圈');
    },
    [me.avatar, me.name, reloadMoments, showToast]
  );

  const toggleLike = useCallback(
    (id: string) => {
      toggleUserMomentLike('wx', id, me.name);
      reloadMoments();
    },
    [me.name, reloadMoments]
  );

  /** 发表评论（reply = 回复目标的评论 id + 名字；回复 AI 评论会自动排一条 AI 的再回复，多轮） */
  const addComment = useCallback(
    (id: string, text: string, reply: { commentId: string; name: string } | null) => {
      addUserMomentComment('wx', id, {
        userName: me.name,
        content: text,
        replyTo: reply ? { commentId: reply.commentId, name: reply.name } : undefined,
      });
      reloadMoments();
    },
    [me.name, reloadMoments]
  );

  /** 进入好友朋友圈：首次自动补三条示例动态（示例动态不入记忆），界面与自己朋友圈同款 */
  const openFriendMoments = useCallback(
    (c: ContactRecord) => {
      const known = listMomentPosts('wx', me.name, contacts);
      if (!known.some((p) => isPostByPeer(p, c))) {
        const now = Date.now();
        for (const t of FRIEND_POST_TEMPLATES) {
          addCharMomentPost('wx', {
            peer: c,
            userName: me.name,
            content: t.text,
            writeMemory: false,
            createdAt: now - t.agoMs,
          });
        }
      }
      reloadMoments();
      setFriendMoments(c);
      setPage('friendMoments');
    },
    [contacts, me.name, reloadMoments]
  );

  const deleteMoment = useCallback(
    (id: string) => {
      deleteMomentPost('wx', id, me.name);
      reloadMoments();
      showToast('已删除动态');
    },
    [me.name, reloadMoments, showToast]
  );

  /** 删除评论（自己的评论；其下的回复一并删，AI 未结算的回复一并撤掉） */
  const deleteComment = useCallback(
    (postId: string, commentId: string) => {
      deleteMomentComment('wx', postId, commentId, me.name);
      reloadMoments();
    },
    [me.name, reloadMoments]
  );

  /** 编辑动态正文（自己的动态） */
  const editMomentPost = useCallback(
    (id: string, text: string) => {
      if (!updateMomentPostContent('wx', id, me.name, text)) showToast('动态内容不能为空');
      reloadMoments();
    },
    [me.name, reloadMoments, showToast]
  );

  /** 让 AI 好友现在发一条动态（内容按人设 + 最近聊天 + 记忆生成；发布即写该角色记忆） */
  const askMomentPost = useCallback(
    async (c: ContactRecord) => {
      setAskBusyId(c.id);
      try {
        await aiPostMoment({ apiConfig, platform: 'wx', peer: c, userName: me.name });
        reloadMoments();
        showToast(`已让「${displayNameOf(c)}」发了一条动态`);
        setAskOpen(false);
      } catch (e) {
        showToast(e instanceof Error && e.message ? e.message : '生成失败，请稍后再试');
      } finally {
        setAskBusyId(null);
      }
    },
    [apiConfig, me.name, reloadMoments, showToast]
  );

  // ---------------- 删除联系人 / 好友申请 / 申请添加朋友（微信 × QQ 共用 friend-state 状态机） ----------------
  /** 待确认删除的联系人（弹 FriendDeleteConfirmDialog；after = 确认后关闭的页面栈） */
  const [delTarget, setDelTarget] = useState<{ contact: ContactRecord; after: () => void } | null>(null);
  /** 好友申请详情页当前申请（page='friendReqDetail'；null = 资料预览模式） */
  const [reqDetail, setReqDetail] = useState<WxFriendReq | null>(null);
  /** 详情页返回目标：newfriends（新的朋友进入）/ addfriend（搜索或发送后进入） */
  const [reqDetailFrom, setReqDetailFrom] = useState<'newfriends' | 'addfriend'>('newfriends');
  /** 资料预览模式目标（搜索结果点人进入；无申请数据） */
  const [searchProfile, setSearchProfile] = useState<ContactRecord | null>(null);
  /** 申请添加朋友页目标（page='applyFriend'） */
  const [applyTarget, setApplyTarget] = useState<ContactRecord | null>(null);

  // ---------------- 多账号 v2（Task 40-2a）：微信账号切换不刷新——本组件负责 UI 复位与数据重读 ----------------
  // 中断在途流/清理投递队列/排队补跑换仓由根组件 WeChatApp 处理；这里把界面复位回主列表并按新账号
  // 作用域重读全部列表数据（会话预览经 msgTick 重算；隐藏会话/群/朋友圈/互动消息/新的朋友重读）。
  // 切换/登录成功后自动跳回微信主界面（用户要求：切完就能用，不留在切号页）+ toast 提示身份。
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; id?: string }>).detail;
      if (!d || d.app !== 'wx') return;
      setPage('main');
      // toast 报告切到了哪个身份（档案展示名优先，大号回退机主）
      const acc = getActiveAccountFor('wx');
      const prof = contacts.find((c) => c.altOf === acc.id || (acc.ownerContactId ? c.id === acc.ownerContactId : false));
      showToast(`已切换到 ${prof ? displayNameOf(prof) : acc.name || '机主'}`);
      setTab('chats');
      setChatPeer(null);
      setGroupPeer(null);
      setGroupPage(null);
      setGroupInfoOpen(false);
      setDetail(null);
      setFriendMoments(null);
      setPendingCall(null);
      setMenuOpen(false);
      setCtx(null);
      setAskOpen(false);
      setAskBusyId(null);
      setCfgPeer(null);
      setEditingPost(null);
      setDelTarget(null);
      setReqDetail(null);
      setReqDetailFrom('newfriends');
      setSearchProfile(null);
      setApplyTarget(null);
      setMomentsScope('all');
      reloadMoments();
      refreshWxNotices();
      setReqs(loadReqs());
      setHidden(loadStrList(LS_CHAT_HIDDEN));
      refreshGroups();
      setMsgTick((t) => t + 1);
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, fn);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, fn);
  }, [reloadMoments, refreshWxNotices, refreshGroups, contacts, showToast]);

  const openDeleteConfirm = useCallback((c: ContactRecord, after: () => void) => {
    setDelTarget({ contact: c, after });
  }, []);

  /** Task 37 确认删除分支角色：真删（聊天/记忆/朋友圈副本经 deleteContact 级联清空），原角色不受影响 */
  const confirmDeleteBranch = async () => {
    const target = branchDelTarget;
    if (!target) return;
    const label = displayNameOf(target);
    setBranchDelTarget(null);
    try {
      const ok = await deleteCharacterBranch(target.id);
      if (!ok) {
        showToast('删除失败：该联系人不是分支角色');
        return;
      }
      setDetail(null);
      setChatPeer(null);
      setHidden(loadStrList(LS_CHAT_HIDDEN));
      setPage('main');
      await reloadContacts();
      showToast(`已删除分支「${label}」`);
    } catch {
      showToast('删除失败，请重试');
    }
  };

  /** 确认删除联系人：删除好友关系（记录/记忆/朋友圈/通话保留不可见，AI 稍后可能申请加回） */
  const confirmRemoveFriend = useCallback(async () => {
    if (!delTarget) return;
    const { contact, after } = delTarget;
    setDelTarget(null);
    after();
    await removeFriendByUser('wx', contact.id);
    await reloadContacts();
    setReqs(loadReqs());
    showToast(`已删除「${displayNameOf(contact)}」`);
  }, [delTarget, reloadContacts, showToast]);

  /** 申请添加朋友「发送」：
   *  - 大号：加好友（被删好友重新加回时同路径恢复历史数据可见）+ 写「新的朋友」（status=accepted）
   *    + AI 在线程里回一句欢迎（一次性）——「发送即通过」，保持既有体验；
   *  - 小号：AI 决策模式（2025）——不置好友标记（联系人界面不出现该联系人）、条目 status=pending，
   *    由 AI 按人设+大号关系+记忆+验证消息决定同意/拒绝/先回复；用户可在验证消息线程里继续回复，
   *    每条回复再次触发 AI 决策（按人设随时可以同意）。返回新建条目供导航。 */
  const handleApplySent = useCallback(
    async (target: ContactRecord, payload: { greeting: string; extras: FriendReqExtras }): Promise<WxFriendReq | null> => {
      const altFlow = !!me.altOf && (target.persona ?? '').trim().length > 0; // 无人设角色无法决策：保持直接通过
      try {
        if (payload.extras.remark) await updateContact(target.id, { remarks: { wx: payload.extras.remark } });
        if (altFlow) {
          // 小号：不置好友标记；清删除状态（重新加回场景，防止 catch-up 再发一条 AI 申请打架）
          clearFriendDelState('wx', target.id);
        } else {
          await restoreFriendship('wx', target.id); // 未删过 = friendWx=true；删过 = 清删除状态并恢复好友
        }
      } catch {
        showToast('添加失败，请重试');
        return null;
      }
      const entry: WxFriendReq = {
        id: uid(),
        contactId: target.id,
        name: displayNameOf(target),
        avatar: target.avatar,
        message: payload.greeting,
        time: Date.now(),
        status: altFlow ? 'pending' : 'accepted',
        source: SOURCE_SEARCH_WX,
        fromChar: false,
        extras: payload.extras,
        thread: [{ who: 'me', text: payload.greeting, time: Date.now() }],
      };
      addFriendReq('wx', entry);
      // 加好友过程落聊天记录：我的验证消息（fr=apply）永久保留，重启不丢；
      // 小号模式下不加「已成功添加」提示（AI 同意后由 processAltFriendReq 补写）
      try {
        const now = Date.now();
        const msgs: WxMsg[] = [
          ...loadMsgs(target.id),
          { id: uid(), role: 'me' as const, content: payload.greeting, time: now, kind: 'text' as const, fr: 'apply' as const },
        ];
        if (!altFlow) {
          msgs.push({
            id: uid(),
            role: 'peer' as const,
            content: '',
            time: now + 1,
            kind: 'sys' as const,
            sys: { text: '我们已成功添加为好友，现在可以开始聊天啦～' },
            fr: 'added' as const,
          });
        }
        saveMsgs(target.id, msgs);
      } catch {
        // 聊天记录写入失败不影响添加流程
      }
      setReqs(loadReqs());
      await reloadContacts();
      showToast(altFlow ? '验证消息已发送，等待对方处理' : '已发送添加申请');
      if (altFlow) {
        // AI 决策（fire-and-forget）：同意/拒绝/先回复；落盘后经 FRIEND_REQS_EVENT / FRIEND_STATE_APPLIED_EVENT 刷新
        void processAltFriendReq('wx', entry.id, target.id).catch(() => {});
      } else {
        // AI 欢迎回复（一次性；fire-and-forget，生成完成经 FRIEND_REQS_EVENT 刷新）
        void charWelcomeReplyToApply('wx', entry.id, target.id, payload.greeting).catch(() => {});
      }
      return loadReqs().find((x) => x.id === entry.id) ?? entry;
    },
    [reloadContacts, showToast, me.altOf]
  );

  /** 同意好友申请（前往验证 / AI 加回申请）：恢复好友关系 + 状态流转 + 刷新 */
  const acceptFriendReqAction = useCallback(
    async (r: WxFriendReq) => {
      const cid = r.contactId ?? r.id;
      await restoreFriendship('wx', cid);
      setFriendReqStatus('wx', r.id, 'accepted');
      // 加好友成功提示落聊天记录（AI 加回申请场景：居中灰字「你已添加了…」，此前 AI 的验证消息保留）
      try {
        saveMsgs(cid, [
          ...loadMsgs(cid),
          {
            id: uid(),
            role: 'peer' as const,
            content: '',
            time: Date.now(),
            kind: 'sys' as const,
            sys: { text: `你已添加了${r.name}，现在可以开始聊天了。` },
            fr: 'added' as const,
          },
        ]);
      } catch {
        // 忽略
      }
      const fresh = loadReqs().find((x) => x.id === r.id) ?? null;
      setReqs(loadReqs());
      if (reqDetail) setReqDetail(fresh);
      await reloadContacts();
      showToast(`已添加「${r.name}」`);
    },
    [reloadContacts, showToast, reqDetail]
  );

  /** 拒绝好友申请：AI 彻底停止申请（重新加回好友后重置） */
  const rejectFriendReqAction = useCallback(
    (r: WxFriendReq) => {
      rejectFriendReq('wx', r.id);
      const fresh = loadReqs().find((x) => x.id === r.id) ?? null;
      setReqs(loadReqs());
      if (reqDetail) setReqDetail(fresh);
      showToast(`已拒绝「${r.name}」的申请`);
    },
    [showToast, reqDetail]
  );

  /** 申请详情「加入黑名单」：写双向拉黑 byUser（拦截对方消息，走既有拉黑链路；资料预览模式传联系人） */
  const blockFriendReqAction = useCallback(
    (r: WxFriendReq | ContactRecord) => {
      const isReq = (x: WxFriendReq | ContactRecord): x is WxFriendReq => 'status' in x || 'time' in x;
      const cid = isReq(r) ? r.contactId ?? r.id : r.id;
      const name = isReq(r) ? r.name : displayNameOf(r);
      setUserBlock('wx', cid, true);
      showToast(`已将「${name}」加入黑名单`);
    },
    [showToast]
  );

  /** 打开好友详情页（fromChat 参数仅保留调用点兼容；页面退回逻辑已统一） */
  const openFriendDetail = useCallback((c: ContactRecord) => {
    setDetail(c);
    setPage('friendDetail');
  }, []);

  if (page === 'friendDetail' && detail) {
    // Task 37 角色分支：详情页展示分支身份 + 提供删除入口（仅分支角色可见）
    const branchMeta = getBranchMeta(detail.id);
    const branchParentName = branchMeta ? contacts.find((c) => c.id === branchMeta.parentId)?.name ?? '' : '';
    return (
      <>
        <FriendDetailPage
          friend={detail}
          branchInfo={branchMeta && branchParentName ? { parentName: branchParentName, createdAt: branchMeta.createdAt } : null}
          onDeleteBranch={branchMeta ? () => setBranchDelTarget(detail) : undefined}
          onBack={() => {
            // 从聊天设置进入：chatPeer 仍保留，回到聊天页；否则回主列表
            setDetail(null);
            setPage('main');
          }}
          onDeleteContact={
            detail.kind === 'user'
              ? undefined
              : () =>
                  openDeleteConfirm(detail, () => {
                    // 删除后聊天页/详情都关闭，回主列表
                    setDetail(null);
                    setChatPeer(null);
                    setHidden(loadStrList(LS_CHAT_HIDDEN));
                    setPage('main');
                  })
          }
        onOpenChat={(c) => {
          // 详情页发消息：退回 page 并打开聊天（chatPeer 渲染聊天页）。
          // 从聊天进入的详情页：chatPeer 已是此人，退回 page 即回聊天；从通讯录进入的：直接进聊天。
          setPage('main');
          setChatPeer(c);
        }}
        onCall={(media) => {
          // Task 28-b 详情页「音视频通话」：关详情页 → 打开该联系人聊天页 → pendingCall 下发，
          // ChatPage 挂载后消费拨号（全局通话层盖在聊天页上，视觉为「详情页关闭 → 弹出通话」）
          setPendingCall({ contactId: detail.id, media });
          setPage('main');
          setChatPeer(detail);
        }}
        onOpenMoments={(c) => {
          // 自己的详情页：「朋友圈」进自己的朋友圈（只看我发的动态）；好友才自动补示例动态
          if (c.id === me.id) {
            setMomentsScope('mine');
            setPage('moments');
          } else openFriendMoments(c);
        }}
        onToast={showToast}
        />
        {/* 删除确认弹窗在详情页之上（分支提前 return，根部的弹窗不渲染） */}
        {delTarget && (
          <FriendDeleteConfirmDialog
            variant="wx"
            peerName={displayNameOf(delTarget.contact)}
            onCancel={() => setDelTarget(null)}
            onConfirm={() => void confirmRemoveFriend()}
          />
        )}
        {/* Task 37 分支删除二次确认（真删：聊天/记忆/朋友圈一并清空，原角色不受影响） */}
        {branchDelTarget && (
          <BranchDeleteConfirmDialog
            branchName={displayNameOf(branchDelTarget)}
            onCancel={() => setBranchDelTarget(null)}
            onConfirm={() => void confirmDeleteBranch()}
          />
        )}
      </>
    );
  }
  // 朋友圈三页（自己的朋友圈 / 发布页 / 好友朋友圈）必须渲染在 chat 之前：
  // 从聊天 → 联系人详情 → 朋友圈进入时 chatPeer 仍保留（返回时还要回聊天），
  // 若 chat 判断在前会错误地直接渲染聊天页，退出聊天后才看到朋友圈（导航栈错乱）。
  if (page === 'moments') {
    return (
      <>
        <MomentsPage
          me={me}
          posts={momentsScope === 'mine' ? momentsLive.filter((p) => p.authorName === me.name) : momentsLive}
          onBack={() => (detail ? setPage('friendDetail') : setPage('main'))}
          onCompose={() => setPage('compose')}
          onToggleLike={toggleLike}
          onComment={addComment}
          onDelete={deleteMoment}
          onDeleteComment={deleteComment}
          onEditRequest={(p) => setEditingPost({ id: p.id, text: p.text })}
          onToast={showToast}
          noticeBadge={wxNoticeBadge}
          onOpenNotices={openWxNotices}
        />
        {/* 让好友发一条（一.2）+ 每角色自动发动态设置（一.3）+ 编辑动态（六.4） */}
        {askOpen && (
          <AskPostSheet
            title="让好友发一条"
            friends={momentFriendsOf(contacts, 'wx')}
            busyId={askBusyId}
            onClose={() => setAskOpen(false)}
            onAsk={(c) => void askMomentPost(c)}
            onOpenCfg={(c) => setCfgPeer(c)}
            renderAvatar={(c, size) => <WxAvatar src={c.avatar} alt={displayNameOf(c)} size={size} />}
          />
        )}
        {cfgPeer && (
          <MomentAutoCfgSheet
            contact={cfgPeer}
            platform="wx"
            platformLabel="朋友圈"
            onClose={() => setCfgPeer(null)}
            onToast={showToast}
          />
        )}
        {editingPost && (
          <EditPostDialog
            key={editingPost.id}
            initial={editingPost.text}
            busy={false}
            onCancel={() => setEditingPost(null)}
            onSave={(text) => {
              editMomentPost(editingPost.id, text);
              setEditingPost(null);
            }}
          />
        )}
      </>
    );
  }
  if (page === 'compose') {
    return (
      <ComposeMomentsPage
        onCancel={() => setPage('moments')}
        onPublish={publishMoment}
        onToast={showToast}
      />
    );
  }
  if (page === 'momentNotices') {
    return (
      <MomentInteractionsPage
        platform="wx"
        title="与我的互动消息"
        notices={wxNoticesLive}
        onBack={() => setPage('moments')}
        onReply={replyToWxNotice}
        renderAvatar={(src, name, size) => <WxAvatar src={src} alt={name} size={size} />}
      />
    );
  }
  if (page === 'friendMoments' && friendMoments) {
    return (
      <>
        <MomentsPage
          me={me}
          owner={{ name: friendMoments.name, avatar: friendMoments.avatar }}
          peerId={friendMoments.id}
          posts={momentsLive.filter((p) => p.authorName === friendMoments.name)}
          onBack={() => (detail ? setPage('friendDetail') : setPage('main'))}
          onCompose={() => setPage('compose')}
          onToggleLike={toggleLike}
          onComment={addComment}
          onDelete={deleteMoment}
          onToast={showToast}
          noticeBadge={{ count: 0, avatar: null }}
          onOpenNotices={openWxNotices}
        />
        {editingPost && (
          <EditPostDialog
            key={editingPost.id}
            initial={editingPost.text}
            busy={false}
            onCancel={() => setEditingPost(null)}
            onSave={(text) => {
              editMomentPost(editingPost.id, text);
              setEditingPost(null);
            }}
          />
        )}
      </>
    );
  }
  if (groupPage === 'create') {
    return (
      <WxGroupCreatePage
        contacts={contacts}
        onBack={() => setGroupPage(null)}
        onToast={showToast}
        onCreated={(g) => {
          refreshGroups();
          setGroupPage(null);
          setGroupPeer(g);
        }}
      />
    );
  }
  if (groupPage === 'list') {
    return (
      <WxGroupListPage
        contacts={contacts}
        onBack={() => setGroupPage(null)}
        onOpen={(g) => {
          refreshGroups();
          setGroupPage(null);
          setGroupPeer(g);
        }}
        onCreate={() => setGroupPage('create')}
      />
    );
  }
  if (groupPeer && groupInfoOpen) {
    return (
      <WxGroupInfoPage
        key={`info-${groupPeer.id}`}
        group={groupPeer}
        contacts={contacts}
        onBack={() => setGroupInfoOpen(false)}
        onUpdate={(patch) => {
          updateGroupRecord(groupPeer.id, patch);
          refreshGroups();
          // 始终以存储现场为准（群被 AI 移出群聊删除时 getGroup 返回 null → 关闭群页/回列表）
          setGroupPeer(getGroup(groupPeer.id));
        }}
        onQuit={() => {
          quitGroupRecord(groupPeer.id);
          refreshGroups();
          setGroupPeer(null);
          setGroupInfoOpen(false);
          showToast('已退出群聊');
        }}
        onDissolve={() => {
          dissolveGroupRecord(groupPeer.id);
          refreshGroups();
          setGroupPeer(null);
          setGroupInfoOpen(false);
          showToast('群聊已解散');
        }}
        onToast={showToast}
      />
    );
  }
  if (groupPeer) {
    return (
      <WxGroupChatPage
        key={groupPeer.id}
        group={groupPeer}
        me={me}
        contacts={contacts}
        ownerLabelOf={(p) => ownerName(p)}
        onBack={() => {
          refreshGroups();
          setGroupPeer(null);
        }}
        onUpdate={(patch) => {
          updateGroupRecord(groupPeer.id, patch);
          refreshGroups();
          // 始终以存储现场为准（群被 AI 移出群聊删除时 getGroup 返回 null → 关闭群页/回列表）
          setGroupPeer(getGroup(groupPeer.id));
        }}
        onOpenInfo={() => setGroupInfoOpen(true)}
        onQuit={() => {
          quitGroupRecord(groupPeer.id);
          refreshGroups();
          setGroupPeer(null);
          showToast('已退出群聊');
        }}
        onDissolve={() => {
          dissolveGroupRecord(groupPeer.id);
          refreshGroups();
          setGroupPeer(null);
          showToast('群聊已解散');
        }}
        onToast={showToast}
      />
    );
  }
  if (chatPeer) {
    return (
      <>
        <ChatPage
          key={chatPeer.id}
          me={me}
          peer={contacts.find((c) => c.id === chatPeer.id) ?? chatPeer}
          contacts={contacts}
          ownerName={ownerName(chatPeer)}
          otherUnread={chatOtherUnread}
          onBack={backToList}
          onOpenFriendDetail={(c) => openFriendDetail(c)}
          onOpenGroup={(gid) => {
            const g = getGroup(gid);
            if (!g) return;
            refreshGroups();
            setHidden(loadStrList(LS_CHAT_HIDDEN));
            setChatPeer(null);
            setGroupPeer(g);
          }}
          onSaveRemark={async (v) => {
            try {
              // 第四十八轮：备注按 App 隔离——微信里的备注只写 wx 槽位，QQ/信息不受影响
              await updateContact(chatPeer.id, { remarks: { wx: v || null } });
              await reloadContacts();
              showToast(v ? '备注已保存' : '备注已清除');
            } catch {
              showToast('备注保存失败');
            }
          }}
          onSaveVoiceId={async (vid) => {
            try {
              // 与备注同一条持久化路径：写入联系人库 voiceId → 重拉联系人（ChatPage 的 peer 由 contacts 反查，随之一并刷新）
              await updateContact(chatPeer.id, { voiceId: vid || null });
              await reloadContacts();
              showToast(vid ? '已更新 TA 的声音' : '已恢复默认声音');
            } catch {
              showToast('声音保存失败');
            }
          }}
          // 47-b 联系人刷新回调：ChatPage 内 AI 换头像/选图设头像后调此回调让顶栏/会话列表头像即时刷新
          onContactsChanged={reloadContacts}
          onDeleteContact={
            chatPeer.kind === 'user'
              ? undefined
              : () =>
                  openDeleteConfirm(chatPeer, () => {
                    // 删除后聊天页关闭回列表（会话随好友关系消失）；历史记录保留不可见
                    setChatPeer(null);
                    setHidden(loadStrList(LS_CHAT_HIDDEN));
                  })
          }
          onToast={showToast}
          // Task 28-b 详情页通话桥：详情页发起的语音/视频通话经此下发到聊天页拨号
          pendingCall={pendingCall}
          onConsumePendingCall={() => setPendingCall(null)}
          onSwitchChat={(c) => {
            // Task 37 角色分支：创建成功直接切进分支聊天（contacts 稍后经 contact-updated 事件刷新，peer 兜底传入）
            setChatPeer(c);
            showToast(`已创建分支「${displayNameOf(c)}」，与原角色记忆独立`);
          }}
        />
        {/* 删除确认弹窗在聊天页之上（分支提前 return，根部的弹窗不渲染） */}
        {delTarget && (
          <FriendDeleteConfirmDialog
            variant="wx"
            peerName={displayNameOf(delTarget.contact)}
            onCancel={() => setDelTarget(null)}
            onConfirm={() => void confirmRemoveFriend()}
          />
        )}
      </>
    );
  }
  if (page === 'newFriends') {
    return (
      <NewFriendsPage
        reqs={reqsLive}
        onBack={() => setPage('main')}
        onGoAdd={() => setPage('addFriend')}
        onOpenReq={(r) => {
          setReqDetailFrom('newfriends');
          setReqDetail(r);
          setSearchProfile(null);
          setPage('friendReqDetail');
        }}
      />
    );
  }
  if (page === 'friendReqDetail' && (reqDetail || searchProfile)) {
    const req = reqDetail;
    const reqContact = req
      ? contacts.find((c) => c.id === (req.contactId ?? req.id)) ?? null
      : searchProfile;
    return (
      <FriendReqDetailPage
        req={req}
        contact={reqContact}
        liveAvatar={liveWxAvatar}
        onBack={() => {
          setReqDetail(null);
          setSearchProfile(null);
          setPage(req ? (reqDetailFrom === 'addfriend' ? 'addFriend' : 'newFriends') : 'addFriend');
        }}
        onAccept={(r) => void acceptFriendReqAction(r)}
        onReject={rejectFriendReqAction}
        onBlock={blockFriendReqAction}
        onVerify={(c) => {
          setSearchProfile(null);
          setApplyTarget(c);
          setPage('applyFriend');
        }}
        onToast={showToast}
      />
    );
  }
  if (page === 'addFriend') {
    return (
      <AddFriendPage
        contacts={contacts}
        me={me}
        onBack={() => setPage('main')}
        onOpenReqDetail={(c) => {
          setSearchProfile(c);
          setReqDetail(null);
          setPage('friendReqDetail');
        }}
        onOpenChat={(c) => setChatPeer(c)}
        onToast={showToast}
      />
    );
  }
  if (page === 'applyFriend' && applyTarget) {
    return (
      <ApplyFriendPage
        me={me}
        target={applyTarget}
        onBack={() => {
          setApplyTarget(null);
          setPage('addFriend');
        }}
        onSend={(payload) => {
          const t = applyTarget;
          setApplyTarget(null);
          void (async () => {
            const fresh = await handleApplySent(t, payload);
            if (fresh) {
              // 发送后进申请详情（已添加 + 验证消息线程，AI 欢迎回复稍后到达）
              setReqDetailFrom('addfriend');
              setReqDetail(fresh);
              setSearchProfile(null);
              setPage('friendReqDetail');
            } else {
              setPage('addFriend');
            }
          })();
        }}
        onToast={showToast}
      />
    );
  }
  if (page === 'search') {
    return (
      <WxSearchPage
        me={me}
        friends={friends}
        groups={wxGroups}
        moments={moments}
        onBack={() => setPage('main')}
        onOpenChat={(c) => {
          setPage('main');
          setChatPeer(c);
        }}
        onOpenGroup={(g) => {
          setPage('main');
          setTab('chats');
          setHidden(loadStrList(LS_CHAT_HIDDEN));
          setGroupPeer(g);
        }}
        onOpenMoments={() => {
          setMomentsScope('all');
          setPage('moments');
        }}
        onToast={showToast}
      />
    );
  }
  if (page === 'profile')
    return <ProfilePage me={me} record={meRecord} onBack={() => setPage('main')} onToast={showToast} />;
  if (page === 'settings')
    return <WxSettingsPage onBack={() => setPage('main')} onLogout={onLogout} onOpenAccountSwitch={() => setPage('accountSwitch')} />;
  // 切换账号子页（Task 40-D）：注册表账号卡 + 添加 + 管理；登录/切换成功后自动跳回主界面
  if (page === 'accountSwitch')
    return (
      <WxAccountSwitchPage
        me={me}
        onBack={() => setPage('settings')}
        onLoginOther={(u) => {
          onLoginAccount(u);
          setPage('main');
        }}
      />
    );
  if (page === 'services') return <WxServices friends={friends} myRealName={myRealName} onExit={() => setPage('main')} />;
  if (page === 'stickers') return <WxStickersPage onBack={() => setPage('main')} onToast={showToast} />;
  if (page === 'look') return <WxLookPage onBack={() => setPage('main')} onToast={showToast} />;
  // 主题界面（「发现」页 › 主题，原小程序位进入）：顶部毛玻璃胶囊两个选择——主题 / 气泡
  if (page === 'dress')
    return (
      <ThemeStylePage
        app="wx"
        onBack={() => setPage('main')}
        onToast={showToast}
        wxMe={{ name: me.name, avatar: me.avatar }}
      />
    );
  if (page === 'favorites') return <WxFavoritesPage onBack={() => setPage('main')} onToast={showToast} />;
  if (page === 'album') {
    // 我的主页「相册」入口：当前用户自己的相册（可增删改）
    return <AlbumPage contactId={me.id} title="我的相册" onClose={() => setPage('main')} allowEdit onToast={showToast} />;
  }
  if (page === 'momentsSettings') {
    // 48-6：朋友圈设置页（替换原「小店与卡包」入口）；onOpenPostNow 复用 moments 页 AskPostSheet
    return (
      <MomentsSettingsPage
        app="wx"
        onBack={() => setPage('main')}
        onToast={showToast}
        onOpenPostNow={() => {
          setAskOpen(true);
          // 让好友发的动态要在信息流里看见：打开全量动态页
          setMomentsScope('all');
          setPage('moments');
        }}
      />
    );
  }

  const TITLES: Record<Tab, string> = { chats: '微信', contacts: '通讯录', discover: '发现', me: '我' };

  /** 会话行渲染（chats tab：群会话分支 + 好友会话分支；divider = 行底细分割线——液态组内非末行 / 默认主题恒有） */
  const renderSessionRow = (
    row: { key: string; contact: ContactRecord | null; group: ChatGroup | null; preview: string; time: number },
    divider: boolean,
  ) => {
    const pinned = pinSet.has(row.key);
    const unreadCount = unreads[row.key] ?? 0;
    if (row.group) {
      // 群会话行（无长按菜单；点开进群聊页）
      const g = row.group;
      const gid = groupRowId(g.id);
      return (
        <button
          key={g.id}
          type="button"
          data-testid={`wx-chat-item-group-${g.id}`}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            markRead(gid);
            setGroupPeer(g);
          }}
          className={
            liquid
              ? `wx-session-row flex w-full select-none items-center gap-3 px-4 py-[13px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                  divider ? 'border-b border-black/[0.06] dark:border-white/[0.08]' : ''
                } ${pinned ? 'bg-[#ECECEC] dark:bg-white/[0.06]' : ''}`
              : `wx-session-row flex w-full select-none items-center gap-3 border-b border-black/5 px-4 py-2.5 text-left active:bg-black/5 dark:border-white/10 dark:active:bg-white/5 ${
                  pinned ? 'bg-[#ECECEC] dark:bg-white/[0.06]' : ''
                }`
          }
        >
          <span className="relative shrink-0">
            <GroupAvatar group={g} contacts={contacts} size={44} />
            {unreadCount > 0 && (
              <span
                data-testid={`wx-unread-badge-${gid}`}
                aria-label={`${unreadCount} 条未读`}
                className={
                  flagsMap[gid]?.muted === true
                    ? 'absolute -right-[3px] -top-[3px] block h-[9px] w-[9px] rounded-full bg-[#FA5151] ring-2 ring-white dark:ring-[#1A1A1A]'
                    : 'absolute -right-[7px] -top-[7px] flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#FA5151] px-[5px] text-[11px] font-semibold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] ring-2 ring-white dark:ring-[#1A1A1A]'
                }
              >
                {flagsMap[gid]?.muted === true ? null : unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[16px]">{g.remark?.trim() || g.name}</span>
              <span className="flex shrink-0 items-center gap-1">
                {flagsMap[gid]?.muted === true && (
                  <BellOff className="h-3.5 w-3.5 text-black/30 dark:text-white/30" strokeWidth={2} aria-label="消息免打扰" />
                )}
                <span className="text-[12px] text-black/35 dark:text-white/35">{fmtListTime(row.time)}</span>
              </span>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-black/40 dark:text-white/40">{row.preview || '群聊已创建'}</p>
          </div>
        </button>
      );
    }
    const contact = row.contact;
    if (!contact) return null;
    return (
      <button
        key={contact.id}
        type="button"
        data-testid={`wx-chat-item-${contact.name}`}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          markRead(contact.id);
          setChatPeer(contact);
        }}
        onPointerDown={(e) => onSessionPointerDown(e, contact)}
        onPointerMove={onSessionPointerMove}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onPointerLeave={clearPress}
        className={
          liquid
            ? `wx-session-row flex w-full select-none items-center gap-3 px-4 py-[13px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                divider ? 'border-b border-black/[0.06] dark:border-white/[0.08]' : ''
              } ${pinned ? 'bg-[#ECECEC] dark:bg-white/[0.06]' : ''}`
            : `wx-session-row flex w-full select-none items-center gap-3 border-b border-black/5 px-4 py-2.5 text-left active:bg-black/5 dark:border-white/10 dark:active:bg-white/5 ${
                pinned ? 'bg-[#ECECEC] dark:bg-white/[0.06]' : ''
              }`
        }
      >
        <span className="relative shrink-0">
          <WxAvatar src={contact.avatar} alt={contact.name} size={44} />
          {unreadCount > 0 && (
            <span
              data-testid={`wx-unread-badge-${contact.id}`}
              aria-label={`${unreadCount} 条未读`}
              className={
                flagsMap[contact.id]?.muted === true
                  ? /* 免打扰：不显示数字，只显示小红点（原生微信同款） */
                    'absolute -right-[3px] -top-[3px] block h-[9px] w-[9px] rounded-full bg-[#FA5151] ring-2 ring-white dark:ring-[#1A1A1A]'
                  : 'absolute -right-[7px] -top-[7px] flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#FA5151] px-[5px] text-[11px] font-semibold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] ring-2 ring-white dark:ring-[#1A1A1A]'
              }
            >
              {flagsMap[contact.id]?.muted === true ? null : unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[16px]">
              {contact.name}
              {getBranchMeta(contact.id) && (
                <span className="ml-1.5 inline-block translate-y-[-1px] rounded-[3px] bg-black/[0.06] px-[4px] py-px align-middle text-[10px] font-normal leading-[14px] text-black/40 dark:bg-white/10 dark:text-white/40">
                  分支
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {flagsMap[contact.id]?.muted === true && (
                <BellOff className="h-3.5 w-3.5 text-black/30 dark:text-white/30" strokeWidth={2} aria-label="消息免打扰" />
              )}
              <span className="text-[12px] text-black/35 dark:text-white/35">{fmtListTime(row.time)}</span>
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] text-black/40 dark:text-white/40">
            {row.preview || '开始聊天吧'}
          </p>
        </div>
      </button>
    );
  };

  return (
    <div
      ref={rootRef}
      data-liquid-theme={liquid ? 'true' : 'false'}
      data-rt-theme={retro ? 'true' : 'false'}
      className={`relative flex h-full w-full flex-col ${retro ? 'rt-root' : 'bg-[#EDEDED] dark:bg-[#111111]'} text-black dark:text-white`}
    >
      {/* 顶栏：默认 =（微信：返回+搜索+＋；通讯录：＋；发现/我：无图标；左侧返回键退出微信回主屏）
          液态（第四十四轮，用户指定）：左上头像+名字无椭圆包裹、只在「微信」tab 显示；标题纯文字居中；右＝圆形玻璃＋钮
          wx-nav：主界面顶部导航锚点（自定义 CSS 示例模板可改导航底色） */}
      <div className={`wx-nav shrink-0 pt-[54px] ${retro ? 'rt-bar' : ''}`}>
        {liquid ? (
        <div className="relative flex h-12 items-center gap-2 px-2.5">
          {tab === 'chats' && (
            <button
              type="button"
              aria-label="返回主屏幕"
              data-testid="wx-exit"
              onClick={onExit}
              className="flex min-w-0 max-w-[46%] flex-1 items-center gap-2.5 px-1 py-1.5 active:opacity-60"
            >
              <WxAvatar src={me.avatar} alt={me.name} size={34} />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[14.5px] font-semibold leading-tight">{me.name}</span>
                <span className="mt-[3px] flex items-center gap-1 text-[10.5px] leading-none">
                  <span className="h-[6.5px] w-[6.5px] rounded-full bg-[#07C160]" aria-hidden="true" />
                  <span className="font-medium text-[#07C160]">在线</span>
                </span>
              </span>
            </button>
          )}
          {/* 右侧配重占位：与左侧头像区等分剩余空间，标题真正居中 */}
          <div className="flex flex-1 justify-end">
            {(tab === 'chats' || tab === 'contacts') ? (
              <button
                type="button"
                aria-label={tab === 'chats' ? '更多功能' : '添加朋友'}
                data-testid="wx-plus"
                onClick={() => {
                  if (tab === 'contacts') {
                    setPage('addFriend');
                    return;
                  }
                  setMenuOpen(true);
                }}
                className="lg-chip flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full active:opacity-60"
              >
                {/* 第四十五轮（用户指定）：玻璃圆圈内嵌黑色圆圈（同语音钮样式）；
                    第四十八轮（用户指定）：按钮变小一点 42→36px（内圈 31→26、图标 19→16） */}
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-[1.5px] border-black/85 text-black/90 dark:border-white/70 dark:text-white/90">
                  <Plus className="h-[16px] w-[16px]" strokeWidth={2.1} />
                </span>
              </button>
            ) : null}
          </div>
          {/* 标题绝对居中：纯文字无胶囊（参考图 WeChat 同款） */}
          <div className="absolute left-1/2 top-1/2 flex h-[42px] max-w-[42%] -translate-x-1/2 -translate-y-1/2 items-center justify-center px-4 text-[16.5px] font-semibold">
            {TITLES[tab]}
          </div>
        </div>
        ) : (
        <div className="flex h-11 items-center px-4">
          <div className="flex flex-1 items-center justify-start">
            <button
              type="button"
              aria-label="返回主屏幕"
              data-testid="wx-exit"
              onClick={onExit}
              className={`-ml-1.5 p-1 ${retro ? 'text-[#3A3E4C]' : 'text-black/75 dark:text-white/75'} active:opacity-50`}
            >
              <ChevronLeft className="h-[23px] w-[23px]" strokeWidth={2.2} />
            </button>
          </div>
          <div className={`text-[17px] ${retro ? 'font-bold text-[#3A3E4C]' : 'font-medium'}`}>{TITLES[tab]}</div>
          <div className="flex flex-1 items-center justify-end gap-5">
            {tab === 'chats' && (
              <button
                type="button"
                aria-label="搜索"
                data-testid="wx-search-entry"
                onClick={() => setPage('search')}
                className={`${retro ? 'text-[#3A3E4C]' : 'text-black/75 dark:text-white/75'} active:opacity-50`}
              >
                <Search className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </button>
            )}
            {(tab === 'chats' || tab === 'contacts') && (
              <button
                type="button"
                aria-label={tab === 'chats' ? '更多功能' : '添加朋友'}
                data-testid="wx-plus"
                onClick={() => {
                  if (tab === 'contacts') {
                    setPage('addFriend');
                    return;
                  }
                  setMenuOpen(true);
                }}
                className={`${retro ? 'text-[#3A3E4C]' : 'text-black/75 dark:text-white/75'} active:opacity-50`}
              >
                <Plus className="h-[22px] w-[22px]" strokeWidth={1.9} />
              </button>
            )}
          </div>
        </div>
        )}
      </div>

      {/* 右上角 + 菜单：默认 = 深色下拉；液态 = 参考图乳白玻璃竖列面板（第四十六轮变小：宽 248/行 44/字 14.5/图标 19） */}
      {menuOpen && (
        <>
          <div className="absolute inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          {liquid ? (
            <div
              data-testid="wx-plus-menu"
              className="lg-sheet absolute right-2.5 top-[104px] z-40 w-[min(80%,248px)] overflow-hidden rounded-[20px] py-[4px]"
              role="menu"
            >
              {(
                [
                  ['group', '发起群聊', <Users key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); setGroupPage('create'); }],
                  ['addfriend', '添加朋友', <UserPlus key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); setPage('addFriend'); }],
                  ['scan', '扫一扫', <ScanLine key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); openScan('wechat'); }],
                  ['pay', '收付款', <Banknote key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); showToast('「收付款」暂未开放'); }],
                  ['mini', '小程序', <AppWindow key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); showToast('「小程序」暂未开放'); }],
                  ['readall', '一键已读', <CheckCheck key="i" className="h-[19px] w-[19px]" strokeWidth={2} />, () => { setMenuOpen(false); sessions.forEach((s) => wxUnreads.clear(s.key)); showToast('已一键清除全部未读'); }],
                ] as Array<[string, string, React.ReactNode, () => void]>
              ).map(([key, label, icon, act]) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  data-testid={`wx-menu-${key}`}
                  onClick={act}
                  className="lg-menu-row flex h-[44px] w-full items-center gap-3 px-5 text-left text-[14.5px] font-semibold text-[#1C1C1E] dark:text-white/90"
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          ) : (
          <div className={`absolute right-3 top-[94px] z-40 w-[152px] overflow-hidden rounded-[6px] shadow-[0_4px_16px_rgba(0,0,0,0.25)] ${retro ? 'border border-[#9A9CA6] bg-white text-[#2E2E33]' : 'rounded-[8px] bg-[#4C4C4C] text-white shadow-xl dark:bg-[#383838]'}`}>
            <button
              type="button"
              data-testid="wx-menu-addfriend"
              onClick={() => {
                setMenuOpen(false);
                setPage('addFriend');
              }}
              className={`flex w-full items-center gap-2.5 px-4 py-[11px] text-left text-[15.5px] ${retro ? 'active:bg-black/[0.06]' : 'active:bg-white/10'}`}
            >
              <UserPlus className="h-[18px] w-[18px]" strokeWidth={1.9} />
              添加朋友
            </button>
            <button
              type="button"
              data-testid="wx-menu-group"
              onClick={() => {
                setMenuOpen(false);
                setGroupPage('create');
              }}
              className={`flex w-full items-center gap-2.5 border-t px-4 py-[11px] text-left text-[15.5px] ${retro ? 'border-black/[0.08] active:bg-black/[0.06]' : 'border-white/10 active:bg-white/10'}`}
            >
              <Users className="h-[18px] w-[18px]" strokeWidth={1.9} />
              发起群聊
            </button>
            <button
              type="button"
              data-testid="wx-menu-scan"
              onClick={() => {
                setMenuOpen(false);
                openScan('wechat');
              }}
              className={`flex w-full items-center gap-2.5 border-t px-4 py-[11px] text-left text-[15.5px] ${retro ? 'border-black/[0.08] active:bg-black/[0.06]' : 'border-white/10 active:bg-white/10'}`}
            >
              <ScanLine className="h-[18px] w-[18px]" strokeWidth={1.9} />
              扫一扫
            </button>
            <button
              type="button"
              data-testid="wx-menu-pay"
              onClick={() => {
                setMenuOpen(false);
                showToast('「收付款」暂未开放');
              }}
              className={`flex w-full items-center gap-2.5 border-t px-4 py-[11px] text-left text-[15.5px] ${retro ? 'border-black/[0.08] active:bg-black/[0.06]' : 'border-white/10 active:bg-white/10'}`}
            >
              <Banknote className="h-[18px] w-[18px]" strokeWidth={1.9} />
              收付款
            </button>
          </div>
          )}
        </>
      )}

      {/* 内容区（液态主题：底部多留 88px——悬浮胶囊 TabBar 覆盖在滚动流上，内容从玻璃底下穿过） */}
      <div className={liquid ? 'min-h-0 flex-1 overflow-y-auto pb-[88px]' : 'min-h-0 flex-1 overflow-y-auto'}>
        {tab === 'chats' && (
          <>
            {liquid && (
              /* 液态（参考图）：搜索胶囊 + 小组件区（网易云/日历/自定义 CSS，可开关） + 分类标签栏（分段控件）；搜索点按进搜索页，分类过滤下方会话卡片 */
              <div className="px-2.5 pt-1">
                <button
                  type="button"
                  data-testid="wx-search-capsule"
                  onClick={() => setPage('search')}
                  className="lg-search mb-2.5 flex h-[40px] w-full items-center justify-center gap-1.5 rounded-full text-black/40 active:opacity-60 dark:text-white/40"
                >
                  <Search className="h-[16px] w-[16px]" strokeWidth={2.1} aria-hidden="true" />
                  <span className="text-[14px]">搜索</span>
                </button>
                {/* 小组件区：搜索框下、分类标签上，在 主题页›液态玻璃设置 里开关（网易云已连接音乐 App） */}
                <WxLiquidWidgets me={me} />
                <div
                  className="lg-seg mb-2.5 flex items-center gap-1 overflow-x-auto rounded-[17px] p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  role="tablist"
                  aria-label="会话分类"
                  data-testid="wx-cat-bar"
                >
                  {(
                    [
                      /* 第四十六轮（用户指定）：加回「工作」分类（全部/好友/工作/群聊/服务号）；
                         本轮：五个标签文字可在 主题页›液态玻璃设置 自定义（空 = 默认文字） */
                      ...LIQUID_TABS.map((t) => [t.key, liquidTabLabel(liquidSkinWx, t.key)] as const),
                    ] as Array<['all' | 'friends' | 'work' | 'groups' | 'officials', string]>
                  ).map(([id, label]) => {
                    const active = cat === id;
                    /* 分类标签红点角标（参考图）：全部 = 总未读数；好友 = 非群会话未读数 */
                    const catUnread =
                      id === 'all' ? totalUnread : id === 'friends'
                        ? sessions.reduce((acc, s) => (s.group ? acc : acc + (unreads[s.key] ?? 0)), 0)
                        : 0;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        data-testid={`wx-cat-${id}`}
                        onClick={() => setCat(id)}
                        /* 第四十七轮（用户指定「位置调整」）：五个标签 flex-1 均分铺满容器——
                           消除原先靠左堆叠、右侧大段空白的失衡（VLM 采证确认） */
                        className={`relative flex h-[32px] min-w-0 flex-1 basis-0 items-center justify-center px-1 text-[13.5px] transition-colors ${
                          active
                            ? /* 第四十六轮（用户指定，参考图）：选中 = 绿色文字 + 底部绿色横线（删胶囊背景） */
                              'font-semibold text-[#07C160] dark:text-[#3DDC84]'
                            : 'font-medium text-black/55 active:opacity-60 dark:text-white/55'
                        }`}
                      >
                        {label}
                        {active && (
                          <span
                            className="absolute inset-x-[9px] bottom-[2px] h-[2.5px] rounded-full bg-[#07C160] dark:bg-[#3DDC84]"
                            aria-hidden="true"
                          />
                        )}
                        {!active && catUnread > 0 && (
                          <span
                            className="absolute right-[7px] top-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#FA5151] px-[4px] text-[9.5px] font-semibold leading-none text-white"
                            aria-label={`${catUnread} 条未读`}
                          >
                            {catUnread > 99 ? '99+' : catUnread}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* 古早（第五十九轮，用户指定「白色面板太长，弄到联系人那里」）：去掉 min-h-full——
                白色分组卡高度贴合会话行数（iOS 6 分组表格同款），底部露出淡青灰纸感底；
                默认主题保持 min-h-full 整幅白底不变 */}
            <div className={liquid ? 'px-2.5 pb-2' : retro ? 'mx-2 rounded-[8px] bg-white shadow-[inset_0_0_0_1px_#C3C5CC]' : 'min-h-full bg-white dark:bg-[#1A1A1A]'}>
              {(liquid ? visibleSessions : sessions).length === 0 && (
                <div className="py-16 text-center">
                  <p className="text-[14px] text-black/35 dark:text-white/35">{liquid && cat !== 'all' ? '该分类下暂无会话' : '还没有会话'}</p>
                  <p className="mt-1 text-[12.5px] text-black/30 dark:text-white/30">{liquid && cat !== 'all' ? '换个分类看看吧' : '添加好友后，在这里和 TA 聊天'}</p>
                </div>
              )}
            {liquid ? (
              /* 液态（用户指定）：置顶会话一张白色面板、非置顶会话一张白色面板（组内细分割线，卡间间隙） */
              liquidGroups.map((g, gi) => (
                <div key={gi} className="lg-panel mb-2.5 overflow-hidden">
                  {g.map((row, ri) => renderSessionRow(row, ri < g.length - 1))}
                </div>
              ))
            ) : (
              sessions.map((row) => renderSessionRow(row, true))
            )}
            </div>
          </>
        )}

        {tab === 'contacts' && (
          <div className="relative min-h-full pb-4">
            {/* 功能入口（古早：全幅白列表首段，旧微信通讯录无分组卡片） */}
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'rt-plain' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="新的朋友"
                testId="wx-newfriends-entry"
                onClick={() => setPage('newFriends')}
                icon={
                  <WxTileIcon bg="#F5A623">
                    <UserPlus className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="群聊"
                onClick={() => setGroupPage('list')}
                icon={
                  <WxTileIcon bg="#07C160">
                    <Users className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="标签"
                onClick={() => showToast('「标签」暂未开放')}
                icon={
                  <WxTileIcon bg="#4D9CF8">
                    <Tag className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="公众号"
                onClick={() => showToast('「公众号」暂未开放')}
                icon={
                  <WxTileIcon bg="#4D9CF8">
                    <Newspaper className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
              <WxMenuRow
                label="服务号"
                onClick={() => showToast('「服务号」暂未开放')}
                icon={
                  <WxTileIcon bg="#4D9CF8">
                    <Wallet className="h-[21px] w-[21px]" strokeWidth={2} />
                  </WxTileIcon>
                }
              />
            </div>

            {/* 我（本人）—— 首次登录通讯录只有这一位；点击进入与好友同款的详情页 */}
            <div className={liquid ? 'mx-2.5 mt-2.5 lg-panel' : retro ? 'mt-2 rt-plain' : 'mt-2 bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label={me.name}
                testId="wx-contact-me"
                onClick={() => {
                  openFriendDetail(contacts.find((c) => c.id === me.id) ?? meAsContact(me));
                }}
                icon={<WxAvatar src={me.avatar} alt={me.name} size={38} />}
              />
            </div>

            {/* 好友（添加过才会出现，和信息 App 一致） */}
            {friends.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13.5px] leading-relaxed text-black/35 dark:text-white/35">
                还没有好友
                <br />
                点右上角 ＋ ›「添加朋友」认识新朋友
              </p>
            ) : (
              <div className="relative">
                {groups.map((g) => (
                  <div key={g.letter} id={`wx-letter-${g.letter}`}>
                    <p className="wx-letter-bar sticky top-0 bg-[#EDEDED] px-4 py-1 text-[13px] text-black/50 dark:bg-[#111111] dark:text-white/50">
                      {g.letter}
                    </p>
                    {/* 古早：字母分组也是全幅白列表段（与上方连续，仅字母条隔开） */}
                    <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'rt-plain' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
                      {g.list.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          data-testid={`wx-contact-${c.name}`}
                          onClick={() => openFriendDetail(c)}
                          className="flex w-full items-center gap-3 border-b border-black/5 px-4 py-2.5 text-left active:bg-black/5 dark:border-white/10 dark:active:bg-white/5"
                        >
                          <WxAvatar src={c.avatar} alt={c.name} size={40} />
                          <span className="flex-1 truncate text-[16px]">
                            {c.name}
                            {getBranchMeta(c.id) && (
                              <span className="ml-1.5 inline-block translate-y-[-1px] rounded-[3px] bg-black/[0.06] px-[4px] py-px align-middle text-[10px] font-normal leading-[14px] text-black/40 dark:bg-white/10 dark:text-white/40">
                                分支
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* 字母索引条（只在好友列表区域悬浮） */}
                <div className="absolute right-1 top-2 flex flex-col items-center gap-[1px] text-[10px] text-black/45 dark:text-white/45">
                  {'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map((ch) => (
                    <span
                      key={ch}
                      className={`px-1 ${groups.some((g) => g.letter === ch) ? '' : 'opacity-30'}`}
                    >
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'discover' && (
          <div className={liquid ? 'space-y-2.5 pb-6' : 'space-y-2 pb-6'}>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="朋友圈"
                testId="wx-moments-entry"
                badge={wxNoticeBadge.count}
                onClick={() => {
                  // 发现页入口：全量朋友圈信息流（自己+好友的动态）
                  setMomentsScope('all');
                  setPage('moments');
                }}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.moments}><RtWMoments /></RetroIc> : <WxIcMoments small />}
              />
            </div>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="视频号"
                onClick={() => showToast('「视频号」暂未开放')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.channels}><RtWChannels /></RetroIc> : <WxIcChannels />}
              />
            </div>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="扫一扫"
                onClick={() => openScan('wechat')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.scan}><RtWScan /></RetroIc> : <WxIcScan />}
              />
              <WxMenuRow
                label="听一听"
                onClick={() => showToast('「听一听」暂未开放')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.listen}><RtWListen /></RetroIc> : <WxIcListen />}
              />
            </div>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="看一看"
                onClick={() => setPage('look')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.stories}><RtWStories /></RetroIc> : <WxIcStories />}
              />
              <WxMenuRow
                label="搜一搜"
                onClick={() => showToast('「搜一搜」暂未开放')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.search}><RtWSearch /></RetroIc> : <WxIcSearch />}
              />
            </div>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="游戏"
                onClick={() => showToast('「游戏」暂未开放')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.games}><RtWGames /></RetroIc> : <WxIcGames />}
              />
            </div>
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              {/* 主题（发现页入口；界面内毛玻璃胶囊提供主题/气泡两个选择） */}
              <WxMenuRow
                first
                label="主题"
                testId="wx-discover-theme"
                onClick={() => setPage('dress')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.theme}><RtWTheme /></RetroIc> : <WxIcTheme />}
              />
            </div>
          </div>
        )}

        {tab === 'me' && (
          <div className={liquid ? 'space-y-2.5 pb-6' : 'space-y-2 pb-6'}>
            {/* 名片：默认 = 头像+名字+微信号左对齐（微信原生白底样式，点击进个人信息页）；
                液态 = 参考图居中名片（大头像居中 + 名字下方 + 「+ 状态 / N 个朋友」胶囊标签） */}
            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              {liquid ? (
                <button
                  type="button"
                  data-testid="wx-me-profile"
                  onClick={() => setPage('profile')}
                  className="flex w-full flex-col items-center px-4 pb-5 pt-6 text-center active:opacity-70"
                >
                  <span className="block shrink-0">
                    <WxAvatar src={me.avatar} alt={me.name} size={72} />
                  </span>
                  <span className="mt-3 block max-w-full truncate text-[21px] font-semibold leading-tight">{me.name}</span>
                  <span
                    data-testid="wx-me-wxid"
                    className="mt-1 block max-w-full truncate text-[12.5px] text-black/40 dark:text-white/40"
                  >
                    微信号：{me.wechatId || me.phone || '未设置'}
                  </span>
                  <span className="mt-3.5 flex items-center gap-2">
                    <span className="lg-search flex h-[30px] items-center gap-1 rounded-full px-3.5 text-[12.5px] font-medium text-black/60 dark:text-white/60">
                      <Plus className="h-[13px] w-[13px]" strokeWidth={2.2} aria-hidden="true" />
                      状态
                    </span>
                    <span className="lg-search flex h-[30px] items-center rounded-full px-3.5 text-[12.5px] font-medium text-black/60 dark:text-white/60">
                      {friends.length} 个朋友
                    </span>
                  </span>
                </button>
              ) : (
              <button
                type="button"
                data-testid="wx-me-profile"
                onClick={() => setPage('profile')}
                className="flex w-full items-center gap-4 px-4 py-5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <span className="block shrink-0">
                  <WxAvatar src={me.avatar} alt={me.name} size={64} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[21px] font-semibold leading-tight">{me.name}</span>
                  <span
                    data-testid="wx-me-wxid"
                    className="mt-1.5 block truncate text-[13.5px] text-black/45 dark:text-white/45"
                  >
                    微信号：{me.wechatId || me.phone || '未设置'}
                  </span>
                </span>
                <QrCode className="h-5 w-5 shrink-0 text-black/50 dark:text-white/50" strokeWidth={1.8} />
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
              </button>
              )}
            </div>

            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="服务"
                testId="wx-services-entry"
                onClick={() => setPage('services')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.wallet}><RtWWallet /></RetroIc> : <WxIcServices />}
              />
            </div>

            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="收藏"
                testId="wx-me-favorites"
                onClick={() => setPage('favorites')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.favorites}><RtWFavorites /></RetroIc> : <WxIcFavorites />}
              />
              <WxMenuRow
                label="朋友圈"
                testId="wx-me-moments"
                onClick={() => {
                  // 「我」页入口：我的朋友圈（只显示我发的动态）
                  setMomentsScope('mine');
                  setPage('moments');
                }}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.moments}><RtWMoments /></RetroIc> : <WxIcMoments small />}
              />
              <WxMenuRow
                label="相册"
                testId="wx-me-album"
                onClick={() => setPage('album')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.works}><RtWWorks /></RetroIc> : <WxIcWorks />}
              />
              <WxMenuRow
                label="朋友圈设置"
                testId="wx-me-moments-settings"
                onClick={() => setPage('momentsSettings')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.settings}><RtWSettings /></RetroIc> : <WxIcSettings />}
              />
              <WxMenuRow
                label="表情"
                testId="wx-me-stickers"
                onClick={() => setPage('stickers')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.sticker}><RtWSticker /></RetroIc> : <WxIcSticker />}
              />
            </div>

            <div className={liquid ? 'mx-2.5 lg-panel' : retro ? 'mx-2 rt-panel' : 'wx-panel bg-white dark:bg-[#1A1A1A]'}>
              <WxMenuRow
                first
                label="设置"
                testId="wx-me-settings"
                onClick={() => setPage('settings')}
                icon={retro ? <RetroIc tone={RETRO_ICON_TONES.settings}><RtWSettings /></RetroIc> : <WxIcSettings />}
              />
            </div>
          </div>
        )}
      </div>

      {/* 底部 TabBar（上移预留底部横杠安全区）；第三十四轮：上下变小 h-52→46、图标 26→23
          液态玻璃主题（参考图）：悬浮胶囊 Dock——纯图标（无文字标签），选中图标包裹微信绿液态玻璃圆泡
          wx-tabbar：底部标签栏锚点（自定义 CSS 示例模板可改底色/顶线） */}
      <div
        className={
          liquid
            ? 'wx-tabbar lg-tabbar absolute inset-x-3 bottom-[12px] z-30'
            : retro
            ? /* 古早（第五十四轮）：银灰拟物 TabBar */ 'wx-tabbar rt-tabbar shrink-0 pb-[16px]'
            : 'wx-tabbar shrink-0 border-t border-black/10 bg-[#F7F7F7] pb-[16px] dark:border-white/10 dark:bg-[#1A1A1A]'
        }
      >
        <div className={liquid ? 'flex h-[54px] items-stretch px-1' : retro ? 'flex h-[48px] items-stretch' : 'flex h-[46px] items-stretch'}>
          {(
            [
              ['chats', '微信', retro ? <RtChatIcon key="i" className="h-[23px] w-[23px]" /> : <MessageCircle key="i" className="h-[22px] w-[22px]" strokeWidth={1.8} />, true],
              ['contacts', '通讯录', retro ? <RtContactsIcon key="i" className="h-[23px] w-[23px]" /> : <Users key="i" className="h-[22px] w-[22px]" strokeWidth={1.8} />, false],
              ['discover', '发现', retro ? <RtDiscoverIcon key="i" className="h-[23px] w-[23px]" /> : <WxTabCompassIcon key="i" className="h-[22px] w-[22px]" strokeWidth={1.8} />, false],
              ['me', '我', retro ? <RtMeIcon key="i" className="h-[23px] w-[23px]" /> : <User key="i" className="h-[22px] w-[22px]" strokeWidth={1.8} />, false],
            ] as Array<[Tab, string, React.ReactNode, boolean]>
          ).map(([id, label, icon, fillActive]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`wx-tab-${id}`}
                onClick={() => setTab(id)}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 ${
                  active ? (retro ? 'rt-tab-on' : 'text-[#07C160]') : retro ? 'text-[#6A6E7C]' : 'text-black/55 dark:text-white/55'
                }`}
                aria-label={label}
              >
                {liquid ? (
                  /* 液态（第四十五轮，参考图）：纯图标模式；选中 = 浅色半透明胶囊底 + 微信绿填充图标（全部 tab 填充态） */
                  <span className="relative flex h-full w-full items-center justify-center">
                    <span
                      className={`flex h-[38px] w-[68px] items-center justify-center rounded-full transition-colors duration-200 ${
                        active
                          ? 'bg-black/[0.07] shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.55)] dark:bg-white/[0.14] dark:shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.16)]'
                          : ''
                      }`}
                    >
                      <span
                        className={`${
                          active
                            ? 'text-[#07C160] [&>svg]:fill-current dark:text-[#3DDC84]'
                            : 'text-black/60 dark:text-white/60'
                        }`}
                      >
                        {icon}
                      </span>
                    </span>
                    {id === 'chats' && totalUnread > 0 && (
                      <span
                        data-testid="wx-tab-badge-chats"
                        aria-label={`${totalUnread} 条未读`}
                        className="absolute right-[26%] -top-[1px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#FA5151] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ring-white/85 dark:ring-white/25"
                      >
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </span>
                    )}
                    {id === 'discover' && wxNoticeBadge.count > 0 && (
                      <span
                        data-testid="wx-tab-badge-discover"
                        aria-label={`朋友圈 ${wxNoticeBadge.count} 条新消息`}
                        className="absolute right-[26%] -top-[1px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#FA5151] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ring-white/85 dark:ring-white/25"
                      >
                        {wxNoticeBadge.count > 99 ? '99+' : wxNoticeBadge.count}
                      </span>
                    )}
                  </span>
                ) : (
                <span className={`relative ${active && fillActive && !retro ? '[&>svg]:fill-current' : ''}`}>
                  {icon}
                  {id === 'chats' && totalUnread > 0 && (
                    <span
                      data-testid="wx-tab-badge-chats"
                      aria-label={`${totalUnread} 条未读`}
                      className={`absolute -right-[8px] -top-[5px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#FA5151] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ${
                        liquid ? 'ring-white/80 dark:ring-white/20' : retro ? 'ring-[#C9CBD2]' : 'ring-[#F7F7F7] dark:ring-[#1A1A1A]'
                      }`}
                    >
                      {totalUnread > 99 ? '99+' : totalUnread}
                    </span>
                  )}
                  {id === 'discover' && wxNoticeBadge.count > 0 && (
                    <span
                      data-testid="wx-tab-badge-discover"
                      aria-label={`朋友圈 ${wxNoticeBadge.count} 条新消息`}
                      className={`absolute -right-[8px] -top-[5px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#FA5151] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ${
                        liquid ? 'ring-white/80 dark:ring-white/20' : retro ? 'ring-[#C9CBD2]' : 'ring-[#F7F7F7] dark:ring-[#1A1A1A]'
                      }`}
                    >
                      {wxNoticeBadge.count > 99 ? '99+' : wxNoticeBadge.count}
                    </span>
                  )}
                </span>
                )}
                {!liquid && <span className={`text-[10px] ${retro ? 'font-semibold' : ''}`}>{label}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 长按会话菜单（标为未读/置顶/不显示/删除；默认 = 浅色白底卡片，液态 = 横向 2×2 玻璃网格，点空白处关闭） */}
      {ctx && (
        <div
          className="absolute inset-0 z-40"
          data-testid="wx-session-ctx-overlay"
          onClick={closeCtx}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            role="menu"
            aria-label="会话操作"
            data-testid="wx-session-ctx"
            className={
              liquid
                ? /* 液态（用户指定）：横向 2×2 玻璃网格浮层 */ 'lg-sheet absolute z-50 grid w-[min(84%,320px)] grid-cols-2 overflow-hidden rounded-[24px] p-[5px] text-[#1C1C1E] dark:text-white/90'
                : 'absolute z-50 min-w-[176px] overflow-hidden rounded-[12px] border border-black/[0.08] bg-white/95 text-black shadow-[0_12px_36px_rgba(0,0,0,0.18)] backdrop-blur-md dark:border-white/[0.08] dark:bg-[#4C4C4C]/95 dark:text-white dark:shadow-[0_12px_36px_rgba(0,0,0,0.35)]'
            }
            style={{ left: ctx.x, top: ctx.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-unread"
              onClick={() => {
                toggleUnread(ctx.contact.id);
                closeCtx();
              }}
              className={
                liquid
                  ? 'lg-menu-row flex h-[54px] w-full items-center gap-2.5 px-3.5 text-left text-[14.5px] font-semibold'
                  : 'flex h-[46px] w-full items-center gap-2.5 border-b border-black/[0.06] px-4 text-left text-[15px] active:bg-black/[0.05] dark:border-white/10 dark:active:bg-white/10'
              }
            >
              <MailOpen className={liquid ? 'h-[21px] w-[21px] shrink-0' : 'h-4 w-4 shrink-0'} strokeWidth={2} aria-hidden="true" />
              {unreads[ctx.contact.id] ? '标为已读' : '标为未读'}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-pin"
              onClick={() => {
                togglePin(ctx.contact.id);
                closeCtx();
              }}
              className={
                liquid
                  ? 'lg-menu-row flex h-[54px] w-full items-center gap-2.5 px-3.5 text-left text-[14.5px] font-semibold'
                  : 'flex h-[46px] w-full items-center gap-2.5 border-b border-black/[0.06] px-4 text-left text-[15px] active:bg-black/[0.05] dark:border-white/10 dark:active:bg-white/10'
              }
            >
              {pinSet.has(ctx.contact.id) ? (
                <PinOff className={liquid ? 'h-[21px] w-[21px] shrink-0' : 'h-4 w-4 shrink-0'} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Pin className={liquid ? 'h-[21px] w-[21px] shrink-0' : 'h-4 w-4 shrink-0'} strokeWidth={2} aria-hidden="true" />
              )}
              {pinSet.has(ctx.contact.id) ? '取消置顶' : '置顶该聊天'}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-hide"
              onClick={() => {
                hideSession(ctx.contact.id);
                closeCtx();
              }}
              className={
                liquid
                  ? 'lg-menu-row flex h-[54px] w-full items-center gap-2.5 px-3.5 text-left text-[14.5px] font-semibold'
                  : 'flex h-[46px] w-full items-center gap-2.5 border-b border-black/[0.06] px-4 text-left text-[15px] active:bg-black/[0.05] dark:border-white/10 dark:active:bg-white/10'
              }
            >
              <EyeOff className={liquid ? 'h-[21px] w-[21px] shrink-0' : 'h-4 w-4 shrink-0'} strokeWidth={2} aria-hidden="true" />
              不显示该聊天
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="wx-ctx-delete"
              onClick={() => {
                deleteSession(ctx.contact.id);
                closeCtx();
              }}
              className={
                liquid
                  ? 'lg-menu-row flex h-[54px] w-full items-center gap-2.5 px-3.5 text-left text-[14.5px] font-semibold text-[#E5484D]'
                  : 'flex h-[46px] w-full items-center gap-2.5 px-4 text-left text-[15px] text-[#FA5151] active:bg-black/[0.05] dark:text-[#FF9A97] dark:active:bg-white/10'
              }
            >
              <Trash2 className={liquid ? 'h-[21px] w-[21px] shrink-0' : 'h-4 w-4 shrink-0'} strokeWidth={2} aria-hidden="true" />
              删除该聊天
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-[8px] bg-black/75 px-4 py-2.5 text-[14px] text-white">
          {toast}
        </div>
      )}

      {/* 删除联系人二次确认（聊天设置 / 好友详情页共用；明确告知删什么/留什么） */}
      {delTarget && (
        <FriendDeleteConfirmDialog
          variant="wx"
          peerName={displayNameOf(delTarget.contact)}
          onCancel={() => setDelTarget(null)}
          onConfirm={() => void confirmRemoveFriend()}
        />
      )}
    </div>
  );
}
