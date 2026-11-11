'use client';

/** 主界面 MainScreen（三 tab 路由）+ 换号会话态清理 —— v1.9.27 任务10 从 qq.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChevronLeft, Star, User } from 'lucide-react';
import { useSettings, useUI } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
import { takeNotifyNavigation, ISLAND_NAV_EVENT } from '@/lib/ios/island-notify';
import { purgeDeliveryQueueByPrefix } from '@/lib/ios/ai-delivery';
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
// Task 40 草稿箱：输入框文本按会话隔离持久化（刷新/切会话回来不丢，发送成功清空；不进 AI 上下文）
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
import { abortStreamsByPrefix } from '@/lib/chat-stream-store';
// 第十六轮：AI 动态状态（情绪+作息）注入
import { addUserMomentComment, addUserMomentPost, enqueuePostInteractions, listMomentNotices, // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts, markAllMomentNoticesRead, // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage, subscribeMomentsChanged, type MomentNotice } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { AskPostSheet, MomentInteractionsPage } from '../moments-shared';
import { MomentsSettingsPage } from '../moments-settings';
import { ThemeStylePage } from '../bubble-style-settings';
import { isLiquidTheme, isRetroTheme } from '@/lib/ios/bubble-style';
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
import { kvDel, kvDelRaw, kvKeysByPrefix } from '@/lib/ios/idb-kv';
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
import { MAIN_ACCOUNT_ID, accLs, getActiveAccountIdFor, parseScopedKey } from '@/lib/ios/accounts';
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
import { updateContact } from '@/lib/ios/contacts-store';
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）
import { genId } from '@/lib/ios/db';
import { contactByRef, displayNameOf, liveAvatarOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { addFriendReq, isFriendDeleted, loadFriendReqs, rejectFriendReq, removeFriendByUser, restoreFriendship, setFriendReqStatus, SOURCE_SEARCH_QQ, subscribeFriendReqs, charWelcomeReplyToApply, processAltFriendReq, clearFriendDelState, FRIEND_STATE_APPLIED_EVENT, type FriendReqEntry, type FriendReqExtras } from '@/lib/ios/friend-state';
import { setUserBlock } from '@/lib/ios/block-state';
import { useUnreadMap, qqUnreads as qqUnreadStore } from '@/lib/unread-store';
import { qqChatFlags as qqChatFlagsStore } from '@/lib/chat-flags';
import { FriendDeleteConfirmDialog } from '../chat-settings';
import { QqGroupChatPage, QqGroupCreatePage, QqGroupInfoPage } from '../qq-group';
import AlbumPage from '../album';
import VisionLogPage from '../vision-log';
import { dissolveGroup as dissolveGroupRecord, quitGroup as quitGroupRecord, getGroup, listGroups as listChatGroups, updateGroup as updateGroupRecord, type ChatGroup } from '@/lib/ios/groups';

import { ChatPage } from './chat-page';
import { LS_QQ_CHECKIN, LS_WALLET, LS_WALLET_BILLS, LS_WALLET_CARDS, LS_ZONE_COMMENTS, LS_ZONE_LIKES, LS_ZONE_POSTS, QQUser, RtTabIconOf, TAB_ACTIVE, bumpQqSessionEpoch, consumedQqAiEvents, expireStaleSingleCards, loadMsgs, qqQueuedTurns, queuedTurnsKey, saveMsgs } from './core';
import { AddFriendPage, ApplyFriendPage, ContactsPage, DiscoverPage, FriendBondPage, FriendProfilePage, FriendReqDetailPage, LS_CHAT_HIDDEN, MeDrawer, MessagesPage, NewFriendsPage, ProfilePage, QqFavoritesPage, QqSearchPage, SecurityPage, SettingsPage, qqUnreads } from './pages';
import { QqStickersPage } from './stickers';
import { LS_VAULT_EARN, QQ_LS_PAY_PWD_LOCK } from './wallet';
import { WalletPage } from './wallet-pages';
import { QqAvatar, QqToast } from './widgets';
import { WritePostPage, ZonePage } from './zone';

// ---------------- 主界面（三 tab + 路由） ----------------

export type MainRoute =
  | { page: 'tabs'; tab: '消息' | '联系人' | '动态' }
  | { page: 'profile' }
  | { page: 'search' }
  | { page: 'wallet' }
  | { page: 'chat'; contactId: string }
  | { page: 'bond'; contactId: string }
  | { page: 'friend-profile'; contactId: string }
  | { page: 'addfriend' }
  | { page: 'newfriends' }
  | { page: 'apply-friend'; contactId: string }
  | { page: 'friend-req'; reqId: string }
  | { page: 'friend-req-profile'; contactId: string }
  | { page: 'zone'; /** mine = 只看自己发的动态（个人资料页 QQ空间进入） */ scope?: 'mine'; /** 从哪进入（决定返回键去向） */ from?: 'profile' }
  | { page: 'zone-peer'; contactId: string }
  | { page: 'zone-compose'; /** 与 zone 同源（写说说返回时保留「我的空间」语境） */ scope?: 'mine'; from?: 'profile' }
  | { page: 'zone-notices' }
  | { page: 'momentsSettings' }
  | { page: 'dress' }
  | { page: 'settings' }
  | { page: 'security' }
  | { page: 'stickers' }
  | { page: 'favorites' }
  | { page: 'group-create' }
  | { page: 'group-chat'; groupId: string }
  | { page: 'group-info'; groupId: string }
  | { page: 'album'; albumContactId: string; albumTitle: string }
  | { page: 'vision-log'; logContactId: string; logTitle: string };

export function MainScreen({
  me,
  contacts,
  onLogout,
  onPatchUser,
  refreshContacts,
  onLoginAccount,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  onLogout: () => void;
  onPatchUser: (patch: Partial<QQUser>) => void;
  refreshContacts: () => Promise<ContactRecord[]>;
  /** 账号与安全页「登录小号」自由登录成功 → 根组件 handleLogin（Task 41） */
  onLoginAccount: (u: QQUser) => void;
}) {
  const [route, setRoute] = useState<MainRoute>({ page: 'tabs', tab: '消息' });
  /** Task 28-b 资料页通话桥：好友资料页「音视频通话」ActionSheet 选语音/视频后暂存待拨通话——
   *  宿主关资料页并路由到对应聊天页时下发，ChatPage 挂载后消费拨号（openVoiceCall 全链路） */
  const [pendingCall, setPendingCall] = useState<{ contactId: string; media: 'voice' | 'video' } | null>(null);
  /** 「让好友发一条」开关：lift 到 MainScreen，供「空间动态设置 → 立即发帖」复用 ZonePage 的 AskPostSheet */
  const [askOpen, setAskOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);
  // 消息页左上头像：退出 QQ 回手机主屏幕（不再打开个人中心抽屉）
  const closeApp = useUI((s) => s.closeApp);
  // 未读总线订阅：底部「消息」tab 角标 + 聊天页返回键角标实时同步
  const unreads = useUnreadMap(qqUnreads);
  // 液态玻璃主题（个性装扮 › 气泡样式 › 界面主题）：tabs 三页玻璃卡 + 底部悬浮胶囊 TabBar +
  // 聊天页铬件（ChatPage 内自算）；默认主题时所有分支回退原类，像素级保持现状
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const liquid = isLiquidTheme(bubbleStyle, 'qq');
  // 古早主题（retro，第五十四轮）：tabs 三页白硬边分组卡 + 银灰拟物 TabBar/导航（ChatPage 铬件自算）
  const retro = isRetroTheme(bubbleStyle, 'qq');

  // 单聊卡片过期清算（QQ App 打开挂载即扫一遍）：AI 发的红包/转账超 24h 未领取/未收款 →
  // 过期退回（卡片置终态 + 「XX的红包/转账已过期退回」提示行；各聊天页挂载时还会再触发，模块层防重入）
  useEffect(() => {
    void expireStaleSingleCards();
  }, []);

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  // ---------------- 好友通知 / 删除联系人 / 申请添加朋友（与微信共用 friend-state 状态机） ----------------
  /** 好友通知列表（AI 加回申请 + 手动添加记录；friend-state 落盘广播订阅刷新） */
  const [qqReqs, setQqReqs] = useState<FriendReqEntry[]>(() => loadFriendReqs('qq'));
  useEffect(() => subscribeFriendReqs(() => setQqReqs(loadFriendReqs('qq'))), []);
  /** 待确认删除的联系人（弹 FriendDeleteConfirmDialog；after = 确认后关闭的页面栈） */
  const [delTarget, setDelTarget] = useState<{ contact: ContactRecord; after: () => void } | null>(null);

  const openDeleteConfirm = useCallback(
    (c: ContactRecord, after: () => void) => {
      setDelTarget({ contact: c, after });
    },
    []
  );

  /** 确认删除联系人：删除好友关系（记录/记忆/空间/通话保留不可见，AI 稍后可能申请加回） */
  const confirmRemoveFriend = useCallback(async () => {
    if (!delTarget) return;
    const { contact, after } = delTarget;
    setDelTarget(null);
    after();
    await removeFriendByUser('qq', contact.id);
    await refreshContacts();
    setQqReqs(loadFriendReqs('qq'));
    showToast(`已删除「${displayNameOf(contact)}」`);
  }, [delTarget, refreshContacts, showToast]);

  /** 申请添加朋友「发送」：
   *  - 大号：加好友（被删好友重新加回时同路径恢复历史数据可见）+ 写「好友通知」（status=accepted）
   *    + AI 在线程里回一句欢迎（一次性）——「发送即通过」，保持既有体验；
   *  - 小号：AI 决策模式（2025）——不置好友标记（联系人界面不出现该联系人）、条目 status=pending，
   *    由 AI 按人设+大号关系+记忆+验证消息决定同意/拒绝/先回复；用户可在验证消息线程里继续回复，
   *    每条回复再次触发 AI 决策（按人设随时可以同意）。返回新建条目供导航。 */
  const handleApplySent = useCallback(
    async (target: ContactRecord, payload: { greeting: string; extras: FriendReqExtras }): Promise<FriendReqEntry | null> => {
      const altFlow = !!me.altOf && (target.persona ?? '').trim().length > 0; // 无人设角色无法决策：保持直接通过
      try {
        if (payload.extras.remark) await updateContact(target.id, { remarks: { qq: payload.extras.remark } });
        if (altFlow) {
          // 小号：不置好友标记；清删除状态（重新加回场景，防止 catch-up 再发一条 AI 申请打架）
          clearFriendDelState('qq', target.id);
        } else {
          await restoreFriendship('qq', target.id); // 未删过 = friendQq=true；删过 = 清删除状态并恢复好友
        }
      } catch {
        showToast('添加失败，请重试');
        return null;
      }
      const entry: FriendReqEntry = {
        id: genId(),
        contactId: target.id,
        name: displayNameOf(target),
        avatar: target.avatar,
        message: payload.greeting,
        time: Date.now(),
        status: altFlow ? 'pending' : 'accepted',
        source: SOURCE_SEARCH_QQ,
        fromChar: false,
        extras: payload.extras,
        thread: [{ who: 'me', text: payload.greeting, time: Date.now() }],
      };
      addFriendReq('qq', entry);
      // 加好友过程落聊天记录：我的验证消息（fr=apply）永久保留，重启不丢；
      // 小号模式下不加「已成功添加」提示（AI 同意后由 processAltFriendReq 补写）
      try {
        const now = Date.now();
        const msgs = [
          ...loadMsgs(target.id),
          { id: genId(), role: 'me' as const, content: payload.greeting, time: now, kind: 'text' as const, fr: 'apply' as const },
        ];
        if (!altFlow) {
          msgs.push({
            id: genId(),
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
      setQqReqs(loadFriendReqs('qq'));
      await refreshContacts();
      showToast(altFlow ? '验证消息已发送，等待对方处理' : '已发送添加申请');
      if (altFlow) {
        // AI 决策（fire-and-forget）：同意/拒绝/先回复；落盘后经 FRIEND_REQS_EVENT / FRIEND_STATE_APPLIED_EVENT 刷新
        void processAltFriendReq('qq', entry.id, target.id).catch(() => {});
      } else {
        // AI 欢迎回复（一次性；fire-and-forget，生成完成经 FRIEND_REQS_EVENT 刷新）
        void charWelcomeReplyToApply('qq', entry.id, target.id, payload.greeting).catch(() => {});
      }
      return loadFriendReqs('qq').find((x) => x.id === entry.id) ?? entry;
    },
    [refreshContacts, showToast, me.altOf]
  );

  /** 同意好友申请（AI 加回申请）：恢复好友关系 + 状态流转 + 刷新 */
  const acceptFriendReqAction = useCallback(
    async (r: FriendReqEntry) => {
      const cid = r.contactId ?? r.id;
      await restoreFriendship('qq', cid);
      setFriendReqStatus('qq', r.id, 'accepted');
      // 加好友成功提示落聊天记录（AI 加回申请场景：居中灰字「你已添加了…」，此前 AI 的验证消息保留）
      try {
        saveMsgs(cid, [
          ...loadMsgs(cid),
          {
            id: genId(),
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
      setQqReqs(loadFriendReqs('qq'));
      await refreshContacts();
      showToast(`已添加「${r.name}」`);
    },
    [refreshContacts, showToast]
  );

  /** 拒绝好友申请：AI 彻底停止申请（重新加回好友后重置） */
  const rejectFriendReqAction = useCallback(
    (r: FriendReqEntry) => {
      rejectFriendReq('qq', r.id);
      setQqReqs(loadFriendReqs('qq'));
      showToast(`已拒绝「${r.name}」的申请`);
    },
    [showToast]
  );

  /** 好友申请详情「设为黑名单」：写双向拉黑 byUser（拦截对方消息，走既有拉黑链路；资料预览模式传联系人） */
  const blockFriendReqAction = useCallback(
    (r: FriendReqEntry | ContactRecord) => {
      const isReq = (x: FriendReqEntry | ContactRecord): x is FriendReqEntry => 'status' in x || 'time' in x;
      const cid = isReq(r) ? r.contactId ?? r.id : r.id;
      const name = isReq(r) ? r.name : displayNameOf(r);
      setUserBlock('qq', cid, true);
      showToast(`已将「${name}」设为黑名单`);
    },
    [showToast]
  );

  const ownerNameOf = useCallback(
    (c: ContactRecord): string | null => {
      if (c.kind !== 'npc' || !c.ownerId) return null;
      return contacts.find((x) => x.id === c.ownerId)?.name ?? null;
    },
    [contacts]
  );

  const openTabs = useCallback((tab: '消息' | '联系人' | '动态') => setRoute({ page: 'tabs', tab }), []);
  const openChatOf = useCallback((c: ContactRecord) => setRoute({ page: 'chat', contactId: c.id }), []);
  const openGroupOf = useCallback((g: ChatGroup) => setRoute({ page: 'group-chat', groupId: g.id }), []);

  // 灵动岛通知点击跳转：打开通知对应的单聊/群聊（QQ 已打开时由事件驱动，未打开时挂载后自动消费 pending）
  useEffect(() => {
    const consume = () => {
      const t = takeNotifyNavigation('qq');
      if (!t) return;
      if (t.groupId) {
        const g = getGroup(t.groupId);
        if (g) setRoute({ page: 'group-chat', groupId: g.id });
      } else if (t.contactId) {
        setRoute({ page: 'chat', contactId: t.contactId });
      }
    };
    consume();
    window.addEventListener(ISLAND_NAV_EVENT, consume);
    return () => window.removeEventListener(ISLAND_NAV_EVENT, consume);
  }, []);
  /** 群数据版本：updateGroupRecord 落盘后 bump，让当前打开的群页拿到最新群对象 */
  const [groupVersion, setGroupVersion] = useState(0);
  const patchGroup = useCallback(
    (groupId: string, patch: Partial<Pick<ChatGroup, 'name' | 'avatar' | 'announcement' | 'memoryInterop' | 'memberIds'>>) => {
      updateGroupRecord(groupId, patch);
      setGroupVersion((v) => v + 1);
    },
    []
  );
  /** 当前打开的群（从存储现场读取；groupVersion 变化后重算） */
  const groupPeer = useMemo(
    () => (route.page === 'group-chat' || route.page === 'group-info' ? getGroup(route.groupId) : null),
    [route, groupVersion]
  );
  // 群路由但群已不在（被 AI 移出群聊 / 群已解散）：渲染期按消息 tab 兜底，避免空页面
  const staleGroupRoute = !groupPeer && (route.page === 'group-chat' || route.page === 'group-info');
  /** 当前打开的「TA的QQ空间」联系人（zone-peer 路由；联系人被删时回 tab 兜底） */
  const zonePeer = route.page === 'zone-peer' ? contacts.find((c) => c.id === route.contactId) ?? null : null;
  const staleZonePeer = route.page === 'zone-peer' && !zonePeer;
  /** zone 路由的 scope/from（供 zone ↔ zone-compose 往返保留「我的空间」语境） */
  const zoneScope = route.page === 'zone' ? route.scope : route.page === 'zone-compose' ? route.scope : undefined;
  const zoneFrom = route.page === 'zone' ? route.from : route.page === 'zone-compose' ? route.from : undefined;
  const activeTab: '消息' | '联系人' | '动态' = route.page === 'tabs' ? route.tab : '消息';
  // 写说说发表：统一走动态引擎（入库含位置 + 记忆 + 排 AI 互动队列），回空间动态流（ZonePage 订阅 moments-changed 自动刷新）
  const handlePublishZonePost = useCallback(
    (text: string, images: string[], location?: string) => {
      const post = addUserMomentPost('qq', { userName: me.name, avatar: me.avatar, content: text, images, location });
      enqueuePostInteractions('qq', post.id);
    },
    [me.avatar, me.name]
  );

  // ---------------- 互动消息（空间消息：赞和推/评论和@/转发/官方） ----------------
  const [qqNotices, setQqNotices] = useState<MomentNotice[]>(() => listMomentNotices('qq'));
  const refreshQqNotices = useCallback(() => setQqNotices(listMomentNotices('qq')), []);
  /** 互动消息头像实时读取（actorAvatar 快照 → 联系人在就显示当前头像；换头像立即同步）；
   *  被删好友（qq 端 friend-del 状态）的互动同口径隐藏（数据保留，加回后恢复） */
  const qqNoticesLive = useMemo(
    () =>
      qqNotices
        .filter((n) => {
          const hit = contactByRef({ peerId: n.actorPeerId, name: n.actorName }, contacts);
          return !(hit && hit.kind !== 'user' && isFriendDeleted('qq', hit.id));
        })
        .map((n) => ({
          ...n,
          actorAvatar: liveAvatarOf(n.actorAvatar, { peerId: n.actorPeerId, name: n.actorName }, contacts, 'qq'),
        })),
    [qqNotices, contacts]
  );
  /** 气泡角标：未读条数 + 最新一条消息人的头像（「1条新消息」气泡展示用） */
  const qqNoticeBadge = useMemo(
    () => ({
      count: qqNoticesLive.filter((n) => !n.read).length,
      avatar: qqNoticesLive.find((n) => !n.read)?.actorAvatar ?? null,
    }),
    [qqNoticesLive]
  );
  // 引擎（调度器/AI）在别处写入互动消息后同步本地视图：AI 回复/点赞落盘会广播 moments-changed，
  // 这里刷新 qqNotices → 未读数实时更新 →「N条新消息」气泡实时出现（与微信朋友圈订阅对称；
  // 修复：旧版只在本组件挂载/打开消息页时读一次，用户停留在 QQ 里 AI 互动了气泡也不出现）
  useEffect(
    () =>
      subscribeMomentsChanged((platform) => {
        if (platform && platform !== 'qq') return;
        refreshQqNotices();
      }),
    [refreshQqNotices]
  );
  /** 打开空间消息页：全部标记已读（气泡随之消失）+ 刷新列表 */
  const openQqNotices = useCallback(() => {
    markAllMomentNoticesRead('qq');
    refreshQqNotices();
    setRoute({ page: 'zone-notices' });
  }, [refreshQqNotices]);
  /** 从空间消息页回复一条评论/回复（走引擎：AI 会自动再回复，新回复会进收件箱） */
  const replyToQqNotice = useCallback(
    (n: MomentNotice, text: string) => {
      if (!n.postId) {
        showToast('原动态已删除，无法回复');
        return;
      }
      const added = addUserMomentComment('qq', n.postId, {
        userName: me.name,
        content: text,
        replyTo: n.commentId ? { commentId: n.commentId, name: n.actorName } : undefined,
      });
      if (!added) {
        showToast('原动态已删除，无法回复');
        return;
      }
      refreshQqNotices();
      showToast('已回复');
    },
    [me.name, refreshQqNotices, showToast]
  );

  const chatPeer =
    route.page === 'chat' || route.page === 'bond' || route.page === 'friend-profile'
      ? (contacts.find((c) => c.id === route.contactId) ?? null)
      : null;
  const meContact = contacts.find((c) => c.id === me.id) ?? null;

  /** 当前打开的聊天对象 id（仅在聊天页时有值） */
  const currentChatId = route.page === 'chat' ? route.contactId : null;
  /** 聊天页返回键角标：除当前会话外的未读总数（和 A 聊天时 B 来信 → 返回键旁显示 B 的未读数） */
  const chatOtherUnread = useMemo(() => {
    if (!currentChatId) return 0;
    let sum = 0;
    for (const [id, n] of Object.entries(unreads)) {
      if (id !== currentChatId && n > 0) sum += n;
    }
    return sum;
  }, [unreads, currentChatId]);
  /** 底部「消息」tab 角标：全部会话未读总数 */
  const totalUnread = useMemo(() => {
    let sum = 0;
    for (const n of Object.values(unreads)) {
      if (n > 0) sum += n;
    }
    return sum;
  }, [unreads]);

  const TAB_DEFS: { id: '消息' | '联系人' | '动态'; label: string; icon: React.ReactNode }[] = [
    { id: '消息', label: '消息', icon: <Bell className="h-[21px] w-[21px]" strokeWidth={1.9} aria-hidden="true" /> },
    { id: '联系人', label: '联系人', icon: <User className="h-[21px] w-[21px]" strokeWidth={1.9} aria-hidden="true" /> },
    { id: '动态', label: '动态', icon: <Star className="h-[21px] w-[21px]" strokeWidth={1.9} aria-hidden="true" /> },
  ];

  return (
    /* qq-root：QQ 主界面根锚点（自定义 CSS 示例模板可改页面底色） */
    <div
      className={`qq-root relative flex h-full w-full flex-col ${retro ? 'rt-root' : 'bg-[#FAFAFC] dark:bg-[#16171A]'} text-[#1F2329] dark:text-white`}
      data-liquid-theme={liquid ? 'true' : 'false'}
      data-rt-theme={retro ? 'true' : 'false'}
    >
      {/* 古早主题状态栏银灰条（第五十五轮，用户指定「状态栏后面的背景也变化」）：
          三 tab 主界面顶部 54px 空档铺拟物导航条；子页由各自的页面底接管（scoped CSS），
          聊天页顶栏自带 rt-dark 覆盖本条 */}
      {retro && (route.page === 'tabs' || route.page === 'chat' || route.page === 'group-chat') && (
        <div aria-hidden="true" className="rt-bar pointer-events-none absolute inset-x-0 top-0 z-[5] h-[54px]" />
      )}
      {route.page === 'chat' && chatPeer ? (
        <ChatPage
          key={chatPeer.id}
          me={me}
          peer={chatPeer}
          contacts={contacts}
          ownerName={ownerNameOf(chatPeer)}
          otherUnread={chatOtherUnread}
          onBack={() => openTabs('消息')}
          onOpenBond={() => setRoute({ page: 'bond', contactId: chatPeer.id })}
          onOpenFriendProfile={() => setRoute({ page: 'friend-profile', contactId: chatPeer.id })}
          onOpenGroup={(gid) => {
            const g = getGroup(gid);
            if (!g) return;
            setRoute({ page: 'group-chat', groupId: g.id });
          }}
          onSaveRemark={async (v) => {
            try {
              // 第四十八轮：备注按 App 隔离——QQ 里的备注只写 qq 槽位，微信/信息不受影响
              await updateContact(chatPeer.id, { remarks: { qq: v || null } });
              await refreshContacts();
              showToast(v ? '备注已保存' : '备注已清除');
            } catch {
              showToast('备注保存失败');
            }
          }}
          onSaveVoiceId={async (vid) => {
            try {
              await updateContact(chatPeer.id, { voiceId: vid || null });
              await refreshContacts();
              showToast(vid ? '已更新 TA 的声音' : '已恢复默认声音');
            } catch {
              showToast('声音保存失败');
            }
          }}
          refreshContacts={refreshContacts}
          onToast={showToast}
          onDeleteContact={
            chatPeer.kind === 'user'
              ? undefined
              : () =>
                  openDeleteConfirm(chatPeer, () => {
                    // 删除后聊天页关闭回列表（会话随好友关系消失）；历史记录保留不可见
                    openTabs('消息');
                  })
          }
          // Task 28-b 资料页通话桥：资料页发起的语音/视频通话经此下发到聊天页拨号
          pendingCall={pendingCall}
          onConsumePendingCall={() => setPendingCall(null)}
        />
      ) : route.page === 'bond' && chatPeer ? (
        <FriendBondPage
          me={me}
          peer={chatPeer}
          onBack={() => openChatOf(chatPeer)}
          onOpenProfile={() => setRoute({ page: 'profile' })}
          onToast={showToast}
        />
      ) : route.page === 'friend-profile' && chatPeer ? (
        <FriendProfilePage
          me={me}
          peer={chatPeer}
          onBack={() => openTabs('联系人')}
          onOpenChat={() => openChatOf(chatPeer)}
          onOpenBond={() => setRoute({ page: 'bond', contactId: chatPeer.id })}
          onOpenZone={() => setRoute({ page: 'zone-peer', contactId: chatPeer.id })}
          onCall={(media) => {
            // Task 28-b 资料页「音视频通话」：关资料页 → 路由到该好友聊天页 → pendingCall 下发，
            // ChatPage 挂载后消费拨号（全局通话层盖在聊天页上，视觉为「资料页关闭 → 弹出通话」）
            setPendingCall({ contactId: chatPeer.id, media });
            openChatOf(chatPeer);
          }}
          onToast={showToast}
        />
      ) : route.page === 'search' ? (
        <QqSearchPage
          me={me}
          contacts={contacts}
          groups={listChatGroups('qq')}
          onClose={() => openTabs('消息')}
          onOpenChat={openChatOf}
          onOpenGroup={openGroupOf}
          onAddFriend={() => setRoute({ page: 'addfriend' })}
          onOpenStickers={() => setRoute({ page: 'stickers' })}
          onToast={showToast}
        />
      ) : route.page === 'profile' ? (
        <ProfilePage
          me={me}
          onBack={() => openTabs('消息')}
          onOpenZone={() => setRoute({ page: 'zone', scope: 'mine', from: 'profile' })}
          onOpenSettings={() => setRoute({ page: 'settings' })}
          onOpenChat={meContact ? () => openChatOf(meContact) : () => showToast('找不到当前账号的联系人资料')}
          onPatchUser={onPatchUser}
          onToast={showToast}
        />
      ) : route.page === 'addfriend' ? (
        <AddFriendPage
          me={me}
          contacts={contacts}
          onBack={() => openTabs('联系人')}
          onOpenApply={(c) => setRoute({ page: 'apply-friend', contactId: c.id })}
          onOpenReqDetail={(c) => setRoute({ page: 'friend-req-profile', contactId: c.id })}
          onOpenChat={openChatOf}
          onToast={showToast}
        />
      ) : route.page === 'friend-req-profile' ? (
        (() => {
          const target = contacts.find((c) => c.id === route.contactId) ?? null;
          if (!target) {
            return (
              <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
                <div className="relative flex h-12 shrink-0 items-center px-3">
                  <button type="button" aria-label="返回" onClick={() => openTabs('联系人')} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
                    <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
                  </button>
                </div>
                <p className="mt-16 text-center text-[13px] text-black/30 dark:text-white/30">该联系人不存在</p>
              </div>
            );
          }
          return (
            <FriendReqDetailPage
              req={null}
              contact={target}
              onBack={() => setRoute({ page: 'addfriend' })}
              onAccept={(r) => void acceptFriendReqAction(r)}
              onReject={rejectFriendReqAction}
              onBlock={blockFriendReqAction}
              onVerify={(c) => setRoute({ page: 'apply-friend', contactId: c.id })}
              onToast={showToast}
            />
          );
        })()
      ) : route.page === 'apply-friend' ? (
        (() => {
          const target = contacts.find((c) => c.id === route.contactId) ?? null;
          if (!target) {
            return (
              <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
                <div className="relative flex h-12 shrink-0 items-center px-3">
                  <button type="button" aria-label="返回" onClick={() => openTabs('联系人')} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
                    <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
                  </button>
                </div>
                <p className="mt-16 text-center text-[13px] text-black/30 dark:text-white/30">该联系人不存在</p>
              </div>
            );
          }
          return (
            <ApplyFriendPage
              me={me}
              target={target}
              onBack={() => setRoute({ page: 'addfriend' })}
              onSend={(payload) => {
                void (async () => {
                  const fresh = await handleApplySent(target, payload);
                  if (fresh) {
                    // 发送后进申请详情（已同意 + 验证消息线程，AI 欢迎回复稍后到达）
                    setRoute({ page: 'friend-req', reqId: fresh.id });
                  } else {
                    setRoute({ page: 'addfriend' });
                  }
                })();
              }}
              onToast={showToast}
            />
          );
        })()
      ) : route.page === 'friend-req' ? (
        (() => {
          const req = qqReqs.find((r) => r.id === route.reqId) ?? null;
          if (!req) {
            return (
              <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
                <div className="relative flex h-12 shrink-0 items-center px-3">
                  <button type="button" aria-label="返回" onClick={() => openTabs('联系人')} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
                    <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
                  </button>
                </div>
                <p className="mt-16 text-center text-[13px] text-black/30 dark:text-white/30">该申请不存在或已被处理</p>
              </div>
            );
          }
          const reqContact = contacts.find((c) => c.id === (req.contactId ?? req.id)) ?? null;
          return (
            <FriendReqDetailPage
              req={req}
              contact={reqContact}
              onBack={() => setRoute({ page: 'newfriends' })}
              onAccept={(r) => void acceptFriendReqAction(r)}
              onReject={rejectFriendReqAction}
              onBlock={blockFriendReqAction}
              onVerify={(c) => setRoute({ page: 'apply-friend', contactId: c.id })}
              onToast={showToast}
            />
          );
        })()
      ) : route.page === 'newfriends' ? (
        <NewFriendsPage
          me={me}
          contacts={contacts}
          reqs={qqReqs}
          onBack={() => openTabs('联系人')}
          onOpenAdd={() => setRoute({ page: 'addfriend' })}
          onOpenChat={openChatOf}
          onOpenApply={(c) => setRoute({ page: 'apply-friend', contactId: c.id })}
          onOpenReq={(r) => setRoute({ page: 'friend-req', reqId: r.id })}
          onAccept={(r) => void acceptFriendReqAction(r)}
          onToast={showToast}
        />
      ) : route.page === 'zone' ? (
        <ZonePage
          me={me}
          contacts={contacts}
          mineOnly={route.scope === 'mine'}
          onBack={route.from === 'profile' ? () => setRoute({ page: 'profile' }) : () => openTabs('动态')}
          onCompose={() => setRoute({ page: 'zone-compose', scope: route.scope, from: route.from })}
          onToast={showToast}
          askOpen={askOpen}
          setAskOpen={setAskOpen}
          noticeBadge={qqNoticeBadge}
          onOpenNotices={openQqNotices}
        />
      ) : route.page === 'zone-peer' && zonePeer ? (
        <ZonePage
          key={`zone-peer-${zonePeer.id}`}
          me={me}
          contacts={contacts}
          owner={zonePeer}
          onBack={() => setRoute({ page: 'friend-profile', contactId: zonePeer.id })}
          onCompose={() => setRoute({ page: 'zone-compose' })}
          onToast={showToast}
          askOpen={false}
          setAskOpen={setAskOpen}
          noticeBadge={qqNoticeBadge}
          onOpenNotices={openQqNotices}
        />
      ) : route.page === 'zone-compose' ? (
        <WritePostPage
          me={me}
          onBack={() => setRoute({ page: 'zone', scope: zoneScope, from: zoneFrom })}
          onPublish={handlePublishZonePost}
          onToast={showToast}
        />
      ) : route.page === 'zone-notices' ? (
        <MomentInteractionsPage
          platform="qq"
          title="空间消息"
          notices={qqNoticesLive}
          onBack={() => openTabs('动态')}
          onReply={replyToQqNotice}
          renderAvatar={(src, name, size) => <QqAvatar src={src} alt={name} size={size} />}
        />
      ) : route.page === 'dress' ? (
        // 主题界面（个性装扮：顶部毛玻璃胶囊两个选择——主题 / 气泡）
        <ThemeStylePage app="qq" title="个性装扮" onBack={() => openTabs('消息')} onToast={showToast} />
      ) : route.page === 'momentsSettings' ? (
        <MomentsSettingsPage
          app="qq"
          onBack={() => openTabs('动态')}
          onToast={showToast}
          onOpenPostNow={() => {
            setAskOpen(true);
            setRoute({ page: 'zone' });
          }}
        />
      ) : route.page === 'wallet' ? (
        <WalletPage me={me} onBack={() => openTabs('消息')} onToast={showToast} />
      ) : route.page === 'stickers' ? (
        <QqStickersPage onBack={() => openTabs('消息')} onToast={showToast} />
      ) : route.page === 'favorites' ? (
        <QqFavoritesPage onBack={() => openTabs('消息')} onToast={showToast} />
      ) : route.page === 'settings' ? (
        <SettingsPage
          me={me}
          onBack={() => openTabs('消息')}
          onOpenSecurity={() => setRoute({ page: 'security' })}
          onOpenDress={() => setRoute({ page: 'dress' })}
          onLogout={onLogout}
          onToast={showToast}
        />
      ) : route.page === 'security' ? (
        <SecurityPage me={me} onBack={() => setRoute({ page: 'settings' })} onToast={showToast} onLoginOther={onLoginAccount} />
      ) : route.page === 'group-create' ? (
        <QqGroupCreatePage
          contacts={contacts}
          onBack={() => openTabs('联系人')}
          onCreated={(g) => setRoute({ page: 'group-chat', groupId: g.id })}
        />
      ) : route.page === 'group-info' && groupPeer ? (
        <QqGroupInfoPage
          key={`ginfo-${groupPeer.id}`}
          group={groupPeer}
          contacts={contacts}
          onBack={() => setRoute({ page: 'group-chat', groupId: groupPeer.id })}
          onUpdate={(patch) => patchGroup(groupPeer.id, patch)}
          onQuit={() => {
            quitGroupRecord(groupPeer.id);
            showToast('已退出群聊');
            openTabs('联系人');
          }}
          onDissolve={() => {
            dissolveGroupRecord(groupPeer.id);
            showToast('群聊已解散');
            openTabs('联系人');
          }}
          onToast={showToast}
        />
      ) : route.page === 'group-chat' && groupPeer ? (
        <QqGroupChatPage
          key={groupPeer.id}
          group={groupPeer}
          me={{ id: me.id, name: me.name, avatar: me.avatar, realName: me.realName, nickname: me.nickname }}
          contacts={contacts}
          ownerLabelOf={ownerNameOf}
          onBack={() => openTabs('消息')}
          onUpdate={(patch) => patchGroup(groupPeer.id, patch)}
          onOpenInfo={() => setRoute({ page: 'group-info', groupId: groupPeer.id })}
          onQuit={() => {
            quitGroupRecord(groupPeer.id);
            showToast('已退出群聊');
            openTabs('消息');
          }}
          onDissolve={() => {
            dissolveGroupRecord(groupPeer.id);
            showToast('群聊已解散');
            openTabs('消息');
          }}
          onToast={showToast}
        />
      ) : route.page === 'album' ? (
        <AlbumPage
          contactId={route.albumContactId}
          title={route.albumTitle}
          onClose={() => openTabs('消息')}
          allowEdit={route.albumContactId === me.id}
          onToast={showToast}
        />
      ) : route.page === 'vision-log' ? (
        <VisionLogPage
          contactId={route.logContactId}
          title={route.logTitle}
          onClose={() => openTabs('消息')}
        />
      ) : route.page === 'tabs' || staleGroupRoute || staleZonePeer ? (
        <>
          <div className="min-h-0 flex-1 overflow-hidden pt-[54px]">
            {activeTab === '消息' && (
              <MessagesPage
                me={me}
                contacts={contacts}
                liquid={liquid}
                retro={retro}
                onOpenChat={openChatOf}
                onOpenGroup={openGroupOf}
                onOpenDrawer={() => setDrawerOpen(true)}
                onAvatar={closeApp}
                onAddFriend={() => setRoute({ page: 'addfriend' })}
                onCreateGroup={() => setRoute({ page: 'group-create' })}
                onOpenSearch={() => setRoute({ page: 'search' })}
                onToast={showToast}
              />
            )}
            {activeTab === '联系人' && (
              <ContactsPage
                me={me}
                contacts={contacts}
                liquid={liquid}
                retro={retro}
                onOpenProfile={(c) => setRoute({ page: 'friend-profile', contactId: c.id })}
                onOpenMeProfile={() => setRoute({ page: 'profile' })}
                onAvatar={() => setDrawerOpen(true)}
                onAddFriend={() => setRoute({ page: 'addfriend' })}
                onOpenNewFriends={() => setRoute({ page: 'newfriends' })}
                onOpenGroup={openGroupOf}
                onToast={showToast}
              />
            )}
            {activeTab === '动态' && (
              <DiscoverPage
                me={me}
                liquid={liquid}
                retro={retro}
                onAvatar={() => setDrawerOpen(true)}
                onZone={() => setRoute({ page: 'zone' })}
                onOpenMomentsSettings={() => setRoute({ page: 'momentsSettings' })}
                zoneBadge={qqNoticeBadge.count}
                onToast={showToast}
              />
            )}
          </div>

          {/* 底部 tab：默认主题 = 白底细线同现状（pb 预留底部横杠安全区，同微信 TabBar；用户第九轮：上下收紧变小一档）；
              液态玻璃主题 = 悬浮胶囊（脱流 absolute，内容从玻璃胶囊底下穿过，滚动容器 pb-[88px] 让位）
              qq-tabbar：底部标签栏锚点（自定义 CSS 示例模板可改底色/顶线） */}
          <div
            className={
              liquid
                ? 'qq-tabbar lg-tabbar absolute inset-x-3 bottom-[12px] z-30'
                : retro
                ? 'qq-tabbar rt-tabbar shrink-0 pb-[12px]'
                : 'qq-tabbar shrink-0 border-t border-black/[0.05] bg-white pb-[12px] dark:border-white/[0.06] dark:bg-[#1B1C1F]'
            }
          >
          <nav className={liquid ? 'flex h-[50px] items-stretch px-1' : retro ? 'flex h-[46px] items-stretch' : 'flex h-[44px] items-stretch'} aria-label="QQ 标签">
            {TAB_DEFS.map((t) => {
              const active = !staleGroupRoute && route.page === 'tabs' && route.tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`qq-tab-${t.id}`}
                  onClick={() => setRoute({ page: 'tabs', tab: t.id })}
                  aria-label={t.label}
                  className={`flex flex-1 flex-col items-center justify-center gap-[3px] ${
                    active ? (retro ? 'rt-tab-on' : TAB_ACTIVE) : retro ? 'text-[#6A6E7C]' : 'text-black/55 dark:text-white/55'
                  }`}
                >
                  <span className={`relative ${active && !retro ? '[&>svg]:fill-current' : ''}`}>
                    {retro ? <RtTabIconOf id={t.id} /> : t.icon}
                    {t.id === '消息' && totalUnread > 0 && (
                      <span
                        data-testid="qq-tab-badge-消息"
                        aria-label={`${totalUnread} 条未读`}
                        className={`absolute -right-[10px] -top-[6px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#F5455C] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ${
                          liquid ? 'ring-white/80 dark:ring-white/20' : retro ? 'ring-[#C9CBD2]' : 'ring-white dark:ring-[#1B1C1F]'
                        }`}
                      >
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </span>
                    )}
                    {t.id === '动态' && qqNoticeBadge.count > 0 && (
                      <span
                        data-testid="qq-tab-badge-动态"
                        aria-label={`空间动态 ${qqNoticeBadge.count} 条新消息`}
                        className={`absolute -right-[10px] -top-[6px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#F5455C] px-[4px] text-[10px] font-semibold leading-none text-white ring-2 ${
                          liquid ? 'ring-white/80 dark:ring-white/20' : retro ? 'ring-[#C9CBD2]' : 'ring-white dark:ring-[#1B1C1F]'
                        }`}
                      >
                        {qqNoticeBadge.count > 99 ? '99+' : qqNoticeBadge.count}
                      </span>
                    )}
                  </span>
                  <span className={`text-[10px] ${retro ? 'font-semibold' : ''}`}>{t.label}</span>
                </button>
              );
            })}
          </nav>
          </div>
        </>
      ) : null}

      {/* 个人中心抽屉（左上头像打开） */}
      {drawerOpen && (
        <MeDrawer
          me={me}
          onClose={() => setDrawerOpen(false)}
          onOpenProfile={() => {
            setDrawerOpen(false);
            setRoute({ page: 'profile' });
          }}
          onOpenWallet={() => setRoute({ page: 'wallet' })}
          onOpenStickers={() => setRoute({ page: 'stickers' })}
          onOpenFavorites={() => setRoute({ page: 'favorites' })}
          onOpenDress={() => {
            setDrawerOpen(false);
            setRoute({ page: 'dress' });
          }}
          onOpenAlbum={() => {
            setDrawerOpen(false);
            setRoute({ page: 'album', albumContactId: me.id, albumTitle: '我的相册' });
          }}
          onOpenSettings={() => {
            setDrawerOpen(false);
            setRoute({ page: 'settings' });
          }}
          onPatchUser={onPatchUser}
          onToast={showToast}
        />
      )}

      {toast && <QqToast text={toast} />}

      {/* 删除联系人二次确认（聊天设置入口；明确告知删什么/留什么） */}
      {delTarget && (
        <FriendDeleteConfirmDialog
          variant="qq"
          peerName={displayNameOf(delTarget.contact)}
          onCancel={() => setDelTarget(null)}
          onConfirm={() => void confirmRemoveFriend()}
        />
      )}
    </div>
  );
}

// ---------------- #11 换账号登录防串号：上一账号的 QQ 会话态数据清理 ----------------

/** QQ 上一登录账号 id（kv 持久化；登出不清——重登不同账号时据此判定换号） */
export const QQ_LAST_LOGIN_ID_KEY = 'qq-last-login-id';

/**
 * #31 会话级设置键（localStorage 单键 JSON map，键 = sessionKey）：按 'qq:' 前缀剔除本 App 条目。
 * 这些键是多端混存的整键 JSON（wx:/qq:/sms: 同存一 map），不能整键删除——只剔除 qq: 条目
 *（含 qq:group: 群会话条目，与群消息同批清理），保留微信/信息等其他端的设置。
 * 键名与各设置模块的真实存储键逐一核对：
 * chat-reply-counts（reply-count.ts）/ chat-sentence-send、chat-sentence-pending（sentence-send.ts）/
 * chat-sticker-on（sticker-toggle.ts）/ chat-time-aware（time-aware.ts）/ chat-translate-cfg（chat-translate.ts）/
 * ai-voice-freq、ai-voice-counters（ai-voice.ts，单聊键 = 会话键、群聊键 = 会话键#成员 id）。
 * 注意不碰聊天消息/收藏等已单独列的键（qq-chat-msgs:、qq-favorites 等）；
 * chat-translate-cache 是 IndexedDB kv 且键为「语言|文本」哈希（不含会话键），不在本清单。
 */
export const QQ_SESSION_SETTING_MAP_KEYS = [
  'chat-reply-counts',
  'chat-sentence-send',
  'chat-sentence-pending',
  'chat-sticker-on',
  'chat-time-aware',
  'chat-translate-cfg',
  'ai-voice-freq',
  'ai-voice-counters',
] as const;

export function pruneQqSessionSettingMaps(): void {
  for (const storeKey of QQ_SESSION_SETTING_MAP_KEYS) {
    try {
      const raw = window.localStorage.getItem(storeKey);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const map = parsed as Record<string, unknown>;
      let changed = false;
      for (const k of Object.keys(map)) {
        if (k.startsWith('qq:')) {
          delete map[k];
          changed = true;
        }
      }
      if (changed) window.localStorage.setItem(storeKey, JSON.stringify(map));
    } catch {
      // 单键解析失败不影响其他键
    }
  }
}

/**
 * 清理全部 QQ 会话态数据（#11 换号登录防串号：同一账号内上次登录的是另一个人时，
 * 进入新身份前清掉上一人的聊天记录/空间动态/钱包余额/未读角标等）。
 * 多账号 v2（Task 40-2b）关键修正：**只清当前 qq 账号作用域的数据**——kvDelByPrefix 现在
 * 跨全部账号（前缀匹配含各账号后缀键），直接用会误删其他账号的 QQ 数据（切回时记录必须原样恢复）。
 * 逐前缀改 kvKeysByPrefix 列原始键（含各账号后缀键）→ 过滤「属于当前账号的键」→ 逐键 kvDelRaw：
 * 大号只删无后缀键（parseScopedKey 为 null），小号只删以 --{id} 结尾的键。
 * 覆盖 IndexedDB kv 与 localStorage 双层 + 内存单例总线（未读表/会话 flags/排队补跑表）：
 * 只清存储不清内存会导致 UI 残留旧身份角标，刷新后才恢复。
 * 保留设备级数据：表情包库、支付密码、登录会话键（qq-session-user-id 由登录流程自管）；
 * 跨平台键（moments-queue / moments-auto-cfg 等 wx+qq 混存）不动，避免误伤微信侧数据。
 */
export function purgeQqSessionData(): void {
  // 会话纪元递增：此后所有已调度未执行的模块层延迟回调（来电定时器/通话尾巴/分段投递闭包）
  // 按纪元失配自行作废（见 qqSessionEpoch 注释）
  bumpQqSessionEpoch();
  // #3 换号时在途流式/投递尾巴一并作废：旧账号会话（qq:<id> 单聊与 qq:group:<id> 群聊同前缀）
  // 的活跃流不再 finalize 落盘、待投递批次清空——否则换号后旧账号回复仍会写进刚清空的
  // qq-chat-msgs:* / qq-group-msgs:*（新账号看到旧账号的对话尾巴）。只影响 qq: 前缀，wx:/sms: 不受影响
  try {
    abortStreamsByPrefix('qq:');
  } catch {
    // 忽略
  }
  try {
    purgeDeliveryQueueByPrefix('qq:');
  } catch {
    // 忽略
  }
  // 当前账号 id 与「原始键是否属于当前账号」判定（多账号 v2：只清当前账号，其他账号键不动）
  const accId = getActiveAccountIdFor('qq');
  const keyBelongsToAccount = (rawKey: string): boolean => {
    const scoped = parseScopedKey(rawKey);
    return accId === MAIN_ACCOUNT_ID ? scoped === null : scoped?.accId === accId;
  };
  // IndexedDB kv：按前缀清（聊天消息 / 群聊消息 / 转发 AI 事件 / 密友值 / 好友点赞数——均含会话 id 后缀；
  // #9 补 qq-group-msgs:：群聊消息与单聊同批清（防串号），群本体（qq-groups 表）按保守处理不清——
  // 只清消息不清群定义，新身份打开群聊历史为空但群仍可从联系人 › 群聊 进入。
  // 多账号 v2：kvKeysByPrefix 列原始键 → 只删当前账号的键（kvDelByPrefix 会跨全部账号误删，弃用）
  for (const prefix of ['qq-chat-msgs:', 'qq-group-msgs:', 'qq-ai-events:', 'qq-bond:', 'qq-friend-likes:']) {
    try {
      for (const rawKey of kvKeysByPrefix(prefix)) {
        if (keyBelongsToAccount(rawKey)) kvDelRaw(rawKey);
      }
    } catch {
      // 忽略
    }
  }
  // IndexedDB kv：整键清（空间动态/评论/点赞、打卡、钱包余额/银行卡/账单、小金库收益、空间互动收件箱、
  // #10 消息收藏 qq-favorites——旧身份收藏残留会出现在新身份收藏页）。
  // 多账号 v2：kvDel 裸键自动按当前 qq 账号作用域（大号原键/小号 --{id}），其他账号数据不动 ✓
  for (const key of [LS_ZONE_POSTS, LS_ZONE_COMMENTS, LS_ZONE_LIKES, LS_QQ_CHECKIN, LS_WALLET, LS_WALLET_CARDS, LS_WALLET_BILLS, LS_VAULT_EARN, 'qq-moments-inbox', 'moments-inbox:qq', 'qq-favorites']) {
    try {
      kvDel(key);
    } catch {
      // 忽略
    }
  }
  // localStorage：整键清（未读角标/会话 flags（含旧版置顶迁移键）/隐藏会话/排队补跑/支付密码锁定）
  // 多账号 v2：裸键现算 accLs(key,'qq')（大号=原键；小号=--{id} 后缀键），只清当前账号的键
  try {
    window.localStorage.removeItem(accLs('qq-chat-unreads', 'qq'));
    window.localStorage.removeItem(accLs('qq-chat-flags', 'qq'));
    window.localStorage.removeItem(accLs('qq-chat-pins', 'qq'));
    window.localStorage.removeItem(accLs(LS_CHAT_HIDDEN, 'qq'));
    window.localStorage.removeItem(queuedTurnsKey());
    window.localStorage.removeItem(accLs(QQ_LS_PAY_PWD_LOCK, 'qq'));
  } catch {
    // 忽略
  }
  // localStorage：按前缀清（每会话 AI 来电冷却时间戳 qq-vc-last:<contactId>）
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('qq-vc-last:')) stale.push(k);
    }
    for (const k of stale) window.localStorage.removeItem(k);
  } catch {
    // 忽略
  }
  // 内存单例总线同步清空（否则残留旧账号角标/flags 到刷新）
  try {
    qqUnreadStore.prune([]);
  } catch {
    // 忽略
  }
  try {
    for (const fid of Object.keys(qqChatFlagsStore.get())) qqChatFlagsStore.reset(fid);
  } catch {
    // 忽略
  }
  try {
    for (const qid of Object.keys(qqQueuedTurns)) delete qqQueuedTurns[qid];
  } catch {
    // 忽略
  }
  // #31 会话级设置键（localStorage 混存 map）：按 qq: 前缀剔除旧账号的回复条数/分句/表情包/时间感知/翻译/语音频率与计数
  try {
    pruneQqSessionSettingMaps();
  } catch {
    // 忽略
  }
  // #33 转发事件已消费登记（内存单例 Map）一并清空：旧账号的登记会把新账号同文事件误判为已消费而吞掉回应
  try {
    consumedQqAiEvents.clear();
  } catch {
    // 忽略
  }
}
