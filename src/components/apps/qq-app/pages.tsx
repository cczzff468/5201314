'use client';

/** 好友标识/资料/搜索/消息/联系人/动态/个人/抽屉/加好友/新朋友/申请/设置/收藏等页面 —— v1.9.27 任务10 从 qq.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, BookOpen, Check, ChevronLeft, ChevronRight, Compass, CloudSun, FileText, Gamepad2, Image as ImageIcon, Info, KeyRound, LayoutGrid, Link2, LockKeyhole, LogOut, MailOpen, MapPin, Menu, MessageSquarePlus, MonitorSmartphone, Moon, Phone, Pin, PinOff, Plus, FolderOutput, Hash, JapaneseYen, QrCode, Radio, ScanLine, Search, Settings, ShieldCheck, Shirt, SlidersHorizontal, Smartphone, Smile, SmilePlus, Sparkles, Sprout, SquarePen, Star, ThumbsUp, Trash2, User, UserPlus, Users, Video, Wallet, X } from 'lucide-react';
import { useUI } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
import { openScan } from '../mt-scan';
import { peekBgBadgeCounts } from '@/lib/ios/bg-turn';
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
import { COUPLE_STATE_EVENT, readInviteMeta, sendMyInvite } from '@/lib/ios/couple-invite';
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
// Task 40 草稿箱：输入框文本按会话隔离持久化（刷新/切会话回来不丢，发送成功清空；不进 AI 上下文）
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
import { useChatStreamFinalized } from '@/lib/chat-stream-store';
import { memResetConvoCounters } from '@/lib/memory';
// 第十六轮：AI 动态状态（情绪+作息）注入
import { // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts, // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
import { kvGet, kvGetRaw, kvSet } from '@/lib/ios/idb-kv';
import { AccountAddSheet } from '../account-add-sheet';
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
import { ACCOUNT_CHANGED_EVENT, MAIN_ACCOUNT_ID, accountLoginHistory, accLs, clearForceLoginWall, getAccounts, getActiveAccountIdFor, markAccountLoginHistory, switchAccountFor, type PhoneAccount } from '@/lib/ios/accounts';
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
import { getQqProfileBg, listContactsFor, mainOwnerContact, setQqProfileBg, updateContact, getPeerBg, setPeerBg } from '@/lib/ios/contacts-store';
import { fileToAvatarDataUrl } from '@/lib/ios/avatar-upload';
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
import { RetroIc, RETRO_ICON_TONES } from '../retro-icons';
import { noteAvatarChanged } from '@/lib/ios/avatar-ai';
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）
import { avatarFor, displayNameOf, isFriendIn, socialNameOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { SOURCE_SEARCH_QQ, appendReqThread, genCharThreadReply, processAltFriendReq, shouldUseAltDecisionFlow, type FriendReqEntry, type FriendReqExtras, type FriendReqThreadMsg } from '@/lib/ios/friend-state';
import { useWeatherSnapshot, weatherCodeInfo } from '../weather-core';
import { useUnreadMap, qqUnreads as qqUnreadStore } from '@/lib/unread-store';
import { useChatFlags, qqChatFlags as qqChatFlagsStore } from '@/lib/chat-flags';
import { ChatToggle, type ChatSearchItem } from '../chat-settings';
import { loadFavorites, removeFavorite, type MsgFavorite } from '@/lib/msg-favorites';
import { LocalToast, useLocalToast } from '../page-toast';
import { QqGroupAvatar, qqGroupRowId } from '../qq-group';
import { CoupleMark } from '../couple-mark';
import { groupPreview, listGroups as listChatGroups, loadGroupMsgs, type ChatGroup } from '@/lib/ios/groups';

import { LS_FRIEND_LIKE, LS_SESSION, QQMsg, QQUser, QQ_BLUE, TAB_ACTIVE, bondDays, compressImageFile, fmtChatTime, fmtListTime, loadBondStat, loadMsgs, lsMsgsKey, maskPhone, msgPreview, qqQueueDelete, readQqClapText, saveMsgs, writeQqClapText } from './core';
import { LoginScreen } from './login';
import { OnlineBadge, QqAvatar, QqBadgeWall, QqCheckinPills, QqHeader, QqSearch } from './widgets';

// ---------------- 好友标识页（聊天页消息区左滑进入） ----------------

/** 情侣卡等级阶梯（密友值 → Lv；5000 分对应 Lv3，对照真机截图） */
export const COUPLE_LV_STEPS = [0, 1500, 5000, 12000, 25000, 50000, 100000, 200000, 500000];

export function coupleLvOf(points: number): { lv: number; pct: number; need: number } {
  let lv = 1;
  for (let i = 0; i < COUPLE_LV_STEPS.length; i++) {
    if (points >= COUPLE_LV_STEPS[i]) lv = i + 1;
  }
  const lo = COUPLE_LV_STEPS[lv - 1] ?? 0;
  const hi = COUPLE_LV_STEPS[lv] ?? lo * 2 + 10000;
  const pct = Math.max(3, Math.min(100, Math.round(((points - lo) / (hi - lo)) * 100)));
  const need = Math.max(1, hi - points);
  return { lv, pct, need };
}

/** 情侣空间纪念日 → 已绑定天数（含当天，最小 1） */
export function coupleBoundDays(anniv: string | null): number {
  if (!anniv) return 1;
  const t = new Date(`${anniv}T00:00:00`);
  if (Number.isNaN(t.getTime())) return 1;
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((base.getTime() - t.getTime()) / 86400000) + 1;
  return diff >= 1 ? diff : 1;
}

/** 读情侣空间全局状态里与该好友的绑定情况（bound=已绑定 days=已绑定天数 pending=邀请待接受） */
export function readCoupleBondInfo(peerId: string): { bound: boolean; days: number; pending: boolean } {
  try {
    const s = kvGet<Record<string, unknown>>('couple-space:state') ?? {};
    const meta = readInviteMeta();
    const bound = s.accepted === true && meta.partnerContactId === peerId;
    const pending = !bound && !!meta.pendingInvite && meta.pendingInvite.contactId === peerId;
    return { bound, days: bound ? coupleBoundDays(typeof s.anniversary === 'string' ? s.anniversary : null) : 0, pending };
  } catch {
    return { bound: false, days: 0, pending: false };
  }
}

export function FriendBondPage({
  me,
  peer,
  onBack,
  onOpenProfile,
  onToast,
}: {
  me: QQUser;
  peer: ContactRecord;
  onBack: () => void;
  onOpenProfile: () => void;
  onToast: (m: string) => void;
}) {
  // 密友统计：成为好友时间戳用于友谊时间线；天数/密友值仍在后台按 QQ 规则增长（loadBondStat/addBondPoints）
  const [stat] = useState(() => loadBondStat(peer.id));
  const days = bondDays(stat);
  // 我们的DNA弹窗（summary=聊天小结 / common=共同属性 / timeline=友谊时间线，对照 QQ 真机）
  const [dnaModal, setDnaModal] = useState<null | 'summary' | 'common' | 'timeline'>(null);
  // 用户第九轮：情侣空间绑定状态（邀请卡同意后本页上半部分变情侣关系卡；AI 在别处接受时实时刷新）
  const [bondTick, setBondTick] = useState(0);
  const [bindBusy, setBindBusy] = useState(false);
  useEffect(() => {
    const h = () => setBondTick((t) => t + 1);
    window.addEventListener(COUPLE_STATE_EVENT, h);
    return () => window.removeEventListener(COUPLE_STATE_EVENT, h);
  }, []);
  const couple = useMemo(() => readCoupleBondInfo(peer.id), [peer.id, bondTick]);
  const coupleLv = coupleLvOf(stat.points);
  /** 点「去绑定专属关系」→ 给 TA 发情侣空间邀请卡（couple-invite 管线：AI 延时接受 → 回成功卡 → 建立关系） */
  const onBindRelation = async () => {
    if (bindBusy) return;
    setBindBusy(true);
    try {
      const r = await sendMyInvite('qq', peer.id);
      if (!r.ok) {
        onToast(r.error);
        return;
      }
      onToast(`邀请已发送，等${peer.name}回应`);
      setBondTick((t) => t + 1);
      // 回聊天页看邀请卡（TA 稍后回成功卡，再左滑回来上半部分就是情侣卡）
      window.setTimeout(() => onBack(), 700);
    } finally {
      setBindBusy(false);
    }
  };
  /** 「情侣空间 >」入口 → 切到情侣空间 App（与考试卡/情书卡同款导航） */
  const openCoupleSpace = () => {
    const ui = useUI.getState();
    if (ui.locked) return;
    if (ui.activeApp && ui.activeApp !== 'couple') ui.switchToApp('couple');
    else if (!ui.activeApp && ui.phase === 'closed') ui.openApp('couple');
  };
  const sinceDate = new Date(stat.since);
  const nowDate = new Date();
  const fmtMY = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  const sinceLabel = `${sinceDate.getFullYear()}/${sinceDate.getMonth() + 1}/${sinceDate.getDate()}`;
  const totalDays = Math.max(days, 1);
  // 聊天小结：取双方最近在会话里发过的表情（没发过用默认，对照真机文案）
  const lastEmoji = (role: 'me' | 'peer') => {
    const msgs = loadMsgs(peer.id).filter((m) => m.role === role);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i].content.match(/\p{Extended_Pictographic}(\u200D\p{Extended_Pictographic})*/gu);
      if (m && m.length) return m[m.length - 1];
    }
    return role === 'me' ? '🥱' : '🐶';
  };
  const meEmoji = lastEmoji('me');
  const peerEmoji = lastEmoji('peer');

  return (
    <div className="relative flex h-full w-full flex-col bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 + 更多 */}
      <div className="flex h-12 shrink-0 items-center bg-[#F6F7F9] px-3 dark:bg-[#111214]">
        <button
          type="button"
          aria-label="返回聊天"
          data-testid="qq-bond-back"
          onClick={onBack}
          className="-ml-1 rounded-full p-1.5 active:bg-black/5"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <button
          type="button"
          aria-label="更多"
          onClick={() => onToast('更多暂未开放')}
          className="ml-auto rounded-full p-1.5 active:bg-black/5"
        >
          <Menu className="h-[22px] w-[22px] text-black/70 dark:text-white/70" strokeWidth={2.2} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8" data-testid="qq-bond-body">
        {/* 用户第十三轮：邀请卡同意后 → 上半部分换情侣关系卡，对照最新参考图 1:1 重制
            （参考图 1080px 截图实测 ÷2.78 缩放：紫粉渐变 #D28AE0→#FEC6CF、标题 23px+白描边 Lv 徽章、
            玫红胶囊「情侣空间 >」、左对齐双头像 26px 白环、密友值、白轨紫芯进度条 + 右端 mini 爱心徽章） */}
        {couple.bound ? (
          <div
            data-testid="qq-bond-couple-card"
            className="relative mt-1 overflow-hidden rounded-[16px] px-[27px] pb-3 pt-[26px]"
            style={{
              background:
                'linear-gradient(105deg, #D28AE0 0%, #E999D9 38%, #F4AFD4 68%, #FEC9D0 100%)',
            }}
          >
            {/* 右侧情侣徽章（用户第十四轮：跟随聊天界面名字右面的徽章图标，放大版——
                public/qq-couple-badge-lg.png 554×560 高清抠自用户素材图，与聊天气泡旁 CoupleMark 同源同设计；
                尺寸 158×160 蓝底座收在进度条上方 7px，不压条） */}
            <img
              src="/qq-couple-badge-lg.png"
              alt=""
              draggable={false}
              className="pointer-events-none absolute right-[10px] top-[24px] select-none"
              style={{ width: 158, height: 160 }}
            />

            {/* 左列内容（宽度让开右侧图标区） */}
            <div className="relative w-[160px]">
              <div className="flex items-center gap-1.5">
                <p className="text-[23px] font-bold leading-none text-white drop-shadow-[0_1px_3px_rgba(160,40,110,0.25)]">神仙眷侣</p>
                <span
                  data-testid="qq-bond-couple-lv"
                  className="rounded-[5px] border border-white/85 px-[5px] py-[3.5px] text-[11px] font-semibold leading-none text-white"
                >
                  Lv{coupleLv.lv}
                </span>
              </div>
              <p className="mt-[13px] text-[13px] leading-none text-white/85" data-testid="qq-bond-couple-days">
                已绑定 {couple.days} 天
              </p>
              {/* 第十七轮反馈：胶囊（rounded-full）→ 方形圆角 rounded-[7px] */}
              <button
                type="button"
                data-testid="qq-bond-couple-space"
                onClick={openCoupleSpace}
                className="mt-[7px] flex h-[26px] items-center gap-[1px] rounded-[7px] bg-[#F255D7] pl-[11px] pr-[8px] text-[11.5px] font-medium leading-none text-white shadow-[0_3px_9px_rgba(214,45,180,0.38)] transition active:scale-95 active:bg-[#E040C4]"
              >
                情侣空间
                <ChevronRight className="h-[13px] w-[13px]" aria-hidden="true" />
              </button>

              {/* 双头像（左前右后、白环、重叠约 1/3，左对齐——对照参考图） */}
              <div className="mt-[24px] flex items-center">
                <span className="z-10 -mr-[9px] grid h-[26px] w-[26px] place-items-center overflow-hidden rounded-full bg-white/40 shadow-[0_2px_6px_rgba(120,30,90,0.25)] ring-[2.5px] ring-white">
                  <QqAvatar src={me.avatar} alt={me.name} size={26} />
                </span>
                <span className="grid h-[26px] w-[26px] place-items-center overflow-hidden rounded-full bg-white/40 shadow-[0_2px_6px_rgba(120,30,90,0.25)] ring-[2.5px] ring-white">
                  <QqAvatar src={peer.avatar} alt={peer.name} size={26} />
                </span>
              </div>
              <p className="mt-[8px] text-[12px] font-semibold leading-none text-white" data-testid="qq-bond-couple-points">
                密友值 {stat.points} 分
              </p>
            </div>

            {/* 底部升级进度条：白轨 + 紫芯（上下留 1px 白边）+ 右端 mini 爱心徽章（对照参考图） */}
            <div className="relative mt-[13px] flex items-center gap-[13px]">
              <div className="relative h-[8.5px] flex-1 rounded-full bg-white/60">
                <div
                  className="absolute inset-y-[1px] left-[1px] rounded-full"
                  style={{
                    width: `calc(${Math.max(4, Math.min(100, coupleLv.pct))}% - 2px)`,
                    background: 'linear-gradient(90deg, #DC8AE6 0%, #EFA6DC 100%)',
                  }}
                />
              </div>
              <img
                src="/qq-couple-badge-lg.png"
                alt=""
                draggable={false}
                className="h-[24px] w-[24px] shrink-0 select-none drop-shadow-[0_2px_4px_rgba(180,60,140,0.35)]"
              />
            </div>
            <p className="relative mt-[7px] text-[9.5px] leading-none text-white/75">
              再得 {coupleLv.need} 分升级 Lv{coupleLv.lv + 1}
            </p>
          </div>
        ) : (
        // 密友卡（对照真机截图再缩小一档：左上成为好友N天+密友值，中央同心圆波纹+双头像+蓝心跳线，底部去绑定专属关系；四周幸运物图标不要）
        <div
          className="relative mt-1 overflow-hidden rounded-[20px] bg-gradient-to-br from-[#EAE6FB] via-[#F3E1F6] to-[#DCE3FB] px-4 pb-5 pt-5 dark:from-[#38304A] dark:via-[#3B2E43] dark:to-[#26314B]"
          data-testid="qq-bond-card"
        >
          {/* 柔光斑（粉/蓝营造真机渐变氛围）：密友卡专属设计元素，非毛玻璃氛围层，Task 38 误删后还原 */}
          <div aria-hidden="true" className="absolute -right-9 -top-10 h-32 w-32 rounded-full bg-[#F8CDE9]/70 blur-3xl dark:bg-[#8E4E86]/25" />
          <div aria-hidden="true" className="absolute -left-10 top-1/3 h-28 w-28 rounded-full bg-[#F5D5EE]/60 blur-3xl dark:bg-[#7A4E8C]/20" />
          <div aria-hidden="true" className="absolute -bottom-12 right-1/4 h-32 w-32 rounded-full bg-[#CBD8FB]/70 blur-3xl dark:bg-[#3D5392]/25" />

          {/* 左上：成为好友 N天 + 密友值 pill（真实数据） */}
          <div className="relative">
            <p className="text-[16px] font-medium leading-none text-black/85 dark:text-white/90">成为好友</p>
            <p className="mt-1.5 flex items-baseline gap-1" data-testid="qq-bond-days">
              <span className="text-[36px] font-semibold leading-none tracking-tight text-[#23222B] dark:text-white">{days}</span>
              <span className="text-[15px] font-medium text-black/85 dark:text-white/90">天</span>
            </p>
            <p
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-[8px] bg-[#6B6680]/10 px-2.5 py-[3px] text-[13px] text-black/60 dark:bg-white/10 dark:text-white/60"
              data-testid="qq-bond-points"
            >
              密友值
              <span aria-hidden="true" className="h-3 w-px bg-black/15 dark:bg-white/20" />
              <span>{stat.points}分</span>
            </p>
          </div>

          {/* 中央：同心圆波纹 + 双头像 + 蓝色心跳线（整体再缩小一档） */}
          <div className="relative mt-1.5 flex justify-center">
            <div className="relative grid h-[140px] w-[140px] place-items-center">
              <span aria-hidden="true" className="absolute h-[140px] w-[140px] rounded-full bg-white/20 dark:bg-white/[0.07]" />
              <span aria-hidden="true" className="absolute h-[101px] w-[101px] rounded-full bg-white/25 dark:bg-white/[0.09]" />
              <span aria-hidden="true" className="absolute h-[66px] w-[66px] rounded-full bg-white/30 dark:bg-white/[0.11]" />
              <span className="relative flex items-center gap-0.5">
                <span
                  className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-full shadow-[0_4px_11px_rgba(96,74,150,0.22)] ring-2 ring-white/90"
                  data-testid="qq-bond-avatar-me"
                >
                  <QqAvatar src={me.avatar} alt={me.name} size={52} />
                </span>
                <svg viewBox="0 0 48 28" className="h-[23px] w-[40px] shrink-0" aria-hidden="true">
                  <defs>
                    <linearGradient id="qq-pulse-g" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#7FB0FF" />
                      <stop offset="1" stopColor="#3D6EF6" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M2 16.5h7.5l3.5-8.5 6 17 4-12.5 2.5 4h22.5"
                    fill="none"
                    stroke="url(#qq-pulse-g)"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span
                  className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-full shadow-[0_4px_11px_rgba(96,74,150,0.22)] ring-2 ring-white/90"
                  data-testid="qq-bond-avatar-peer"
                >
                  <QqAvatar src={peer.avatar} alt={peer.name} size={52} />
                </span>
              </span>
            </div>
          </div>

          {/* 底部：去绑定专属关系（蓝色文字链接；用户第九轮：真发情侣空间邀请卡，AI 同意后本卡升级为情侣关系卡） */}
          <div className="relative flex justify-center">
            {couple.pending ? (
              <div
                data-testid="qq-bond-bind-pending"
                className="mt-0.5 flex items-center gap-1.5 text-[15px] font-medium text-black/40 dark:text-white/40"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#3D6EF6]" aria-hidden="true" />
                邀请已发出，等TA接受…
              </div>
            ) : (
              <button
                type="button"
                data-testid="qq-bond-bind"
                onClick={() => void onBindRelation()}
                disabled={bindBusy}
                className="mt-0.5 flex items-center text-[16px] font-medium text-[#3D6EF6] active:opacity-70 disabled:opacity-50 dark:text-[#7FA0FF]"
              >
                {bindBusy ? '正在发送邀请…' : '去绑定专属关系'}
                <ChevronRight className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        )}

        {/* 我们的DNA（对照 QQ 真机截图：聊天小结 / 共同属性 / 友谊时间线 三卡；整体缩小一档） */}
        <p className="px-1 pb-1.5 pt-3 text-[14px] font-medium text-black/75 dark:text-white/75">我们的DNA</p>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            data-testid="qq-bond-dna-chat"
            onClick={() => setDnaModal('summary')}
            className="rounded-[16px] bg-white p-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
          >
            <span className="flex items-center text-[13px] text-black/45 dark:text-white/45">
              聊天小结
              <ChevronRight className="ml-0.5 h-3.5 w-3.5 text-black/30 dark:text-white/30" aria-hidden="true" />
            </span>
            <span className="mt-4 block text-[16px] font-semibold leading-snug">
              友谊
              <br />
              持续升温
            </span>
          </button>
          <button
            type="button"
            data-testid="qq-bond-dna-common"
            onClick={() => setDnaModal('common')}
            className="rounded-[16px] bg-white p-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
          >
            <span className="flex items-center text-[13px] text-black/45 dark:text-white/45">
              共同属性
              <ChevronRight className="ml-0.5 h-3.5 w-3.5 text-black/30 dark:text-white/30" aria-hidden="true" />
            </span>
            <span className="mt-4 block text-[16px] font-semibold leading-snug">
              0个
              <br />
              共同好友
            </span>
          </button>
          <button
            type="button"
            data-testid="qq-bond-dna-timeline"
            onClick={() => setDnaModal('timeline')}
            className="rounded-[16px] bg-white p-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F] dark:active:bg-white/[0.06]"
          >
            <span className="flex items-center text-[13px] text-black/45 dark:text-white/45">
              友谊时间线
              <ChevronRight className="ml-0.5 h-3.5 w-3.5 text-black/30 dark:text-white/30" aria-hidden="true" />
            </span>
            <span className="mt-4 block text-[16px] font-semibold leading-snug">
              {sinceLabel}
              <br />
              我们成为好友
            </span>
          </button>
        </div>

        {/* 我们的幸运物种 */}
        <p className="px-1 pb-2 pt-4 text-[14px] text-black/40 dark:text-white/40">我们的幸运物种</p>
        <div className="rounded-[20px] bg-white px-4 py-4 dark:bg-[#1B1C1F]">
          <p className="text-[15px] font-medium">幸运字符</p>
          <div className="mt-3 h-px bg-black/[0.05] dark:bg-white/[0.06]" aria-hidden="true" />
          <button
            type="button"
            onClick={() => onToast('幸运字符暂未开放')}
            className="flex w-full items-center gap-3 pt-3 text-left active:opacity-70"
          >
            <span
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#33271C] via-[#17120E] to-[#0B0806] text-[20px] font-bold text-[#E7C873] shadow-[0_4px_14px_rgba(231,200,115,0.28)] ring-1 ring-[#E7C873]/45"
              aria-hidden="true"
            >
              X
              <span className="absolute -right-0.5 -top-0.5 text-[9px] text-[#FFE9B8]">✦</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-medium">幸运字符</span>
              <span className="block text-[13px] text-black/35 dark:text-white/35">抽取专属字符</span>
            </span>
            <span className="text-[15px] text-black/45 dark:text-white/45">开启</span>
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#F5455C]" aria-hidden="true" />
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 我们的DNA弹窗（聊天小结 / 共同属性 / 友谊时间线，对照 QQ 真机：白卡 + 蓝按钮 + 圆形关闭钮） */}
      {dnaModal && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/45 px-6"
          role="dialog"
          aria-label="我们的DNA"
          data-testid="qq-bond-dna-modal"
        >
          <div className="w-full rounded-[24px] bg-white px-6 pb-9 pt-7 dark:bg-[#1E1F23]">
            {dnaModal === 'summary' && (
              <>
                <p className="text-[22px] font-bold">聊天小结</p>
                <p className="mt-7 text-[15px] leading-relaxed">
                  本周，
                  <br />
                  我们的<b>友谊持续升温</b>。
                </p>
                <p className="mt-4 text-[15px] leading-relaxed">
                  我最近使用的表情是 <span className="align-middle text-[26px] leading-none">{meEmoji}</span>
                </p>
                <p className="mt-3 text-[15px] leading-relaxed">
                  好友最近使用的表情是 <span className="align-middle text-[26px] leading-none">{peerEmoji}</span>
                </p>
              </>
            )}
            {dnaModal === 'common' && (
              <>
                <p className="text-[22px] font-bold">共同属性</p>
                <div className="mt-7 flex items-center gap-9">
                  <span className="text-[15px] text-black/35 dark:text-white/35">共同好友</span>
                  <span className="text-[17px] font-bold" data-testid="qq-bond-dna-common-count">
                    0个
                  </span>
                </div>
              </>
            )}
            {dnaModal === 'timeline' && (
              <>
                <p className="text-[22px] font-bold">友谊时间线</p>
                <div className="mt-8 flex items-start gap-4">
                  <div className="w-[52px] shrink-0">
                    <p className="text-[24px] font-bold leading-none">{sinceDate.getDate()}</p>
                    <p className="mt-1.5 text-[14px] text-black/35 dark:text-white/35">{fmtMY(sinceDate)}</p>
                  </div>
                  <p className="pt-0.5 text-[15px] leading-relaxed">
                    通过<b>QQ号查找</b>我们成为了好友。
                  </p>
                </div>
                <div className="mt-7 flex items-start gap-4">
                  <div className="w-[52px] shrink-0">
                    <p className="text-[24px] font-bold leading-none">{nowDate.getDate()}</p>
                    <p className="mt-1.5 text-[14px] text-black/35 dark:text-white/35">{fmtMY(nowDate)}</p>
                  </div>
                  <p className="pt-0.5 text-[15px] leading-relaxed">
                    今天，
                    <br />
                    是我们成为好友的<b>{totalDays}天</b>。
                  </p>
                </div>
              </>
            )}
            <button
              type="button"
              data-testid="qq-bond-dna-cta"
              onClick={() => {
                const which = dnaModal;
                setDnaModal(null);
                if (which === 'common') onOpenProfile();
                else onBack();
              }}
              className="mx-auto mt-10 flex h-12 w-[76%] items-center justify-center rounded-[10px] bg-[#3BA0FF] text-[17px] font-medium text-white shadow-[0_6px_18px_rgba(59,160,255,0.35)] active:brightness-95"
            >
              {dnaModal === 'common' ? '完善资料' : '去聊一聊'}
            </button>
          </div>
          <button
            type="button"
            aria-label="关闭"
            data-testid="qq-bond-dna-close"
            onClick={() => setDnaModal(null)}
            className="mt-8 grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full border-2 border-white/85 text-white active:bg-white/10"
          >
            <X className="h-6 w-6" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}


// ---------------- 好友个人资料页（联系人列表点击进入，对照 QQ 真机） ----------------

export function FriendProfilePage({
  me,
  peer,
  onBack,
  onOpenChat,
  onOpenBond,
  onOpenZone,
  onCall,
  onToast,
}: {
  me: QQUser;
  peer: ContactRecord;
  onBack: () => void;
  onOpenChat: () => void;
  onOpenBond: () => void;
  /** 他的QQ空间：进该好友的空间动态页（只显示 TA 发的动态） */
  onOpenZone: () => void;
  /** Task 28-b 「音视频通话」ActionSheet 选项回调（voice/video）：宿主关资料页并经聊天页拨号（openVoiceCall 全链路） */
  onCall: (media: 'voice' | 'video') => void;
  onToast: (m: string) => void;
}) {
  // 跨 App 跳转：点「编辑资料」→ 打开联系人 App 后直接进入该联系人的编辑页
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingContactEdit = useUI((s) => s.setPendingContactEdit);
  // Task 28-b 「音视频通话」底部 ActionSheet（语音通话/视频通话 + 取消；点遮罩也可取消）
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  // 46-f：好友资料页顶部封面 banner——getPeerBg 读出该联系人专属背景（按 peer.id 隔离）；
  // 无则渐变兜底（QQ 蓝紫色调）；右上角"恢复默认"按钮调 removePeerBg 后刷新本组件 + toast
  const [peerBg, setPeerBgState] = useState<string | null>(null);
  const reloadPeerBg = useCallback(() => {
    void getPeerBg('qq', peer.id).then((bg) => setPeerBgState(bg ?? null));
  }, [peer.id]);
  useEffect(() => {
    reloadPeerBg();
  }, [reloadPeerBg]);
  // 47-c 改动 4：好友资料页封面点击上传——点 banner 弹文件选择 → 压缩 → setPeerBg 持久化 + 刷新本组件 banner state → toast
  // 56：恢复默认按钮已删除（用户要求），handleResetBanner 一并移除
  const bannerFileRef = useRef<HTMLInputElement>(null);
  const [bannerBusy, setBannerBusy] = useState(false);
  const handleUploadBanner = useCallback(() => {
    if (bannerBusy) return;
    bannerFileRef.current?.click();
  }, [bannerBusy]);
  const handleBannerFile = useCallback(
    async (files: FileList | null) => {
      const f = files?.[0];
      if (!f) return;
      setBannerBusy(true);
      try {
        const src = await compressImageFile(f);
        if (!src) {
          onToast('图片读取失败');
          return;
        }
        await setPeerBg('qq', peer.id, src);
        setPeerBgState(src);
        onToast('已设置封面');
      } catch {
        onToast('上传失败');
      } finally {
        setBannerBusy(false);
      }
    },
    [peer.id, onToast]
  );
  // 点赞数：本地持久化，点击 +1（对照 QQ 资料卡点赞）
  const [likes, setLikes] = useState<number>(() => {
    try {
      const n = Number(kvGet<number>(LS_FRIEND_LIKE(peer.id)) ?? 0);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  });
  const giveLike = () => {
    const next = likes + 1;
    setLikes(next);
    try {
      kvSet(LS_FRIEND_LIKE(peer.id), next);
    } catch {
      // 忽略
    }
    onToast(`已点赞 ${peer.name}`);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white dark:bg-[#1B1C1F]">
      {/* 56：背景图 absolute 铺顶（对齐个人资料页真机 QQ 风格，高 320px） */}
      <div
        role="button"
        aria-label="点击更换封面"
        data-testid="qq-fprofile-upload-banner"
        title="点击更换封面"
        onClick={handleUploadBanner}
        className="absolute inset-x-0 top-0 h-[320px] cursor-pointer"
      >
        {peerBg ? (
          <img src={peerBg} alt="封面" className="h-full w-full object-cover" />
        ) : peer.avatar ? (
          <img
            src={peer.avatar}
            alt=""
            aria-hidden="true"
            className="h-full w-full scale-125 object-cover blur-2xl brightness-[0.62]"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{ background: 'linear-gradient(180deg, #93A9CC 0%, #5E6D88 100%)' }}
            aria-hidden="true"
          />
        )}
        {/* 底部渐变过渡到白色（消除背景图与主卡衔接处的边缘空白） */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white dark:from-[#1B1C1F] to-transparent" aria-hidden="true" />
        <input
          ref={bannerFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="qq-fprofile-banner-file"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void handleBannerFile(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {/* 顶部浮钮：返回 / 个人资料标题（叠在背景图上，避开状态栏 pt-[50px]，深色玻璃圆钮；
          右上角设置图标已按需求删除，用同宽占位保持标题居中） */}
      <div className="relative z-10 flex items-center justify-between px-3 pt-[50px] pb-2">
        <button
          type="button"
          aria-label="返回"
          data-testid="qq-fprofile-back"
          onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-full bg-black/30 text-white shadow-sm backdrop-blur-md transition-transform active:scale-90 active:bg-black/50"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <span className="pointer-events-none text-[17px] font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
          个人资料
        </span>
        <span aria-hidden="true" className="h-9 w-9 shrink-0" />
      </div>

      {/* 白色圆角主卡（从背景图中间叠上来：mt-[125px] 露出顶部约 195px 背景，rounded-t-[22px] 圆角顶） */}
      <div className="relative z-10 mt-[125px] flex-1 overflow-y-auto rounded-t-[22px] bg-white px-5 pb-4 pt-6 dark:bg-[#1B1C1F]" data-testid="qq-fprofile-body">
        {/* 头像 + 名字/QQ号 + 点赞（卡片内，对齐个人资料页布局） */}
        <div className="flex items-start gap-4">
          <QqAvatar src={peer.avatar} alt={peer.name} size={84} />
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-[20px] font-bold leading-tight">{peer.name}</span>
            </div>
            <div className="mt-1.5 truncate text-[13px] text-black/45 dark:text-white/45" data-testid="qq-fprofile-qqid">
              QQ:{peer.qqId ?? '未设置'}
            </div>
          </div>
          <button
            type="button"
            aria-label="点赞"
            data-testid="qq-fprofile-like"
            onClick={giveLike}
            className="flex shrink-0 flex-col items-center gap-0.5 pt-1 text-black/65 active:opacity-60 dark:text-white/65"
          >
            <ThumbsUp className="h-5 w-5" strokeWidth={1.9} />
            <span className="text-[12px]" data-testid="qq-fprofile-like-count">
              {likes}
            </span>
          </button>
        </div>

        {/* 徽章行（QQ 等级图标；SVIP8/勋章/LV8/LV3 已删除；与卡片其他行同一 20px 内边距，不再二次缩进） */}
        <QqBadgeWall testid="qq-fprofile-badges" mtClass="mt-5" onOpen={() => onToast('勋章墙暂未开放')} />

        {/* 你们的互动标识 → 好友互动标识页（分隔条 -mx-5 贴满屏宽，与个人资料页一致） */}
        <div className="-mx-5 mt-5 h-2 bg-black/[0.045] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          data-testid="qq-fprofile-bond"
          onClick={onOpenBond}
          className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
        >
          <span className="shrink-0 text-[15px]">你们的互动标识</span>
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[13px] text-black/40 dark:text-white/40">
            <span className="truncate">点亮你们的第一个标识</span>
            <span aria-hidden="true">🌸</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        {/* 他的QQ空间（分隔条 -mx-5 贴满屏宽） */}
        <div className="-mx-5 h-2 bg-black/[0.045] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          data-testid="qq-fprofile-zone"
          onClick={onOpenZone}
          className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
        >
          <Star className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" strokeWidth={1.9} aria-hidden="true" />
          <span className="flex-1 text-[15px]">他的QQ空间</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
      </div>

      {/* 底部三按钮：音视频通话 / 编辑资料（跳联系人 App 编辑页）/ 发消息
          底色与主卡一致（深色 #1B1C1F），消除主卡与按钮区衔接处的色差边缘 */}
      <div className="flex shrink-0 flex-col gap-2.5 bg-white px-4 pb-[40px] pt-3 dark:bg-[#1B1C1F]">
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="qq-fdetail-call"
            onClick={() => setCallSheetOpen(true)}
            className="h-11 flex-1 rounded-[12px] bg-black/[0.05] text-[15px] active:opacity-70 dark:bg-white/[0.08]"
          >
            音视频通话
          </button>
          <button
            type="button"
            data-testid="qq-fprofile-edit"
            onClick={() => {
              setPendingContactEdit(peer.id);
              switchToApp('contacts');
            }}
            className="h-11 flex-1 rounded-[12px] bg-black/[0.05] text-[15px] active:opacity-70 dark:bg-white/[0.08]"
          >
            编辑资料
          </button>
          <button
            type="button"
            data-testid="qq-fprofile-message"
            onClick={onOpenChat}
            className="h-11 flex-1 rounded-[12px] text-[15px] font-medium text-white active:brightness-95"
            style={{ backgroundColor: QQ_BLUE }}
          >
            发消息
          </button>
        </div>
      </div>

      {/* Task 28-b 音视频通话 ActionSheet：底部滑出卡片（容器样式与 PayMethodSheet 同款：黑色半透明遮罩
          + 底部圆角卡片滑入，选项行白底黑字、QQ 蓝图标；点遮罩/取消关闭。先关卡片再回调拨号，避免弹层叠在全局通话层上） */}
      {callSheetOpen && (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45"
          role="dialog"
          aria-label="音视频通话"
          data-testid="qq-fdetail-call-sheet"
          onClick={() => setCallSheetOpen(false)}
        >
          <style>{'@keyframes qqFdCallIn{from{transform:translateY(65%);opacity:.35}to{transform:translateY(0);opacity:1}}'}</style>
          <div
            className="rounded-t-[18px] bg-white px-4 pb-8 pt-3 dark:bg-[#232529]"
            style={{ animation: 'qqFdCallIn 0.24s ease-out' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" aria-hidden="true" />
            <div className="mt-1 overflow-hidden rounded-[12px]">
              <button
                type="button"
                data-testid="qq-fdetail-call-voice"
                onClick={() => {
                  setCallSheetOpen(false);
                  onCall('voice');
                }}
                className="flex h-14 w-full items-center gap-3 bg-black/[0.03] px-4 text-left text-[17px] active:bg-black/[0.06] dark:bg-white/[0.06] dark:active:bg-white/[0.1]"
              >
                <Phone className="h-[19px] w-[19px] shrink-0" style={{ color: QQ_BLUE }} strokeWidth={1.9} aria-hidden="true" />
                语音通话
              </button>
              <div className="h-2" aria-hidden="true" />
              <button
                type="button"
                data-testid="qq-fdetail-call-video"
                onClick={() => {
                  setCallSheetOpen(false);
                  onCall('video');
                }}
                className="flex h-14 w-full items-center gap-3 bg-black/[0.03] px-4 text-left text-[17px] active:bg-black/[0.06] dark:bg-white/[0.06] dark:active:bg-white/[0.1]"
              >
                <Video className="h-[19px] w-[19px] shrink-0" style={{ color: QQ_BLUE }} strokeWidth={1.9} aria-hidden="true" />
                视频通话
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCallSheetOpen(false)}
              className="mt-3 h-14 w-full rounded-full bg-black/[0.05] text-[17px] text-[#1F2329] active:opacity-70 dark:bg-white/10 dark:text-white"
            >
              取消
            </button>
          </div>
        </div>
      )}
      <span className="sr-only">{me.name}查看{peer.name}的个人资料</span>
    </div>
  );
}

// ---------------- 搜索页（对照 QQ 真机：搜索框 + 取消 + 搜索指定内容 + 本地结果） ----------------

/** 各类消息规整成可搜索文本（图片/撤回不入搜索，与聊天页 ChatSearchItem 同口径） */
export function qqMsgSearchText(m: QQMsg): string {
  if (m.kind === 'sticker' && m.stk) return m.stk.meaning ? `[表情] ${m.stk.meaning}` : '[表情]';
  if (m.kind === 'redpacket' && m.packet) return `[QQ红包] ${m.packet.note}`;
  if (m.kind === 'transfer' && m.packet) return `[转账] ${m.packet.note}`;
  if (m.kind === 'family' && m.fam) return `[亲属卡] 每月额度 ${m.fam.monthlyLimit} 元`;
  if (m.kind === 'location' && m.loc) return `[位置] ${m.loc.name}${m.loc.addr ? ` ${m.loc.addr}` : ''}`;
  if (m.kind === 'notice' && m.notice) return `${m.notice.pre}${m.notice.accent}`;
  if (m.kind === 'voice') return m.voice?.transcript || m.voice?.localText ? `[语音] ${m.voice?.transcript || m.voice?.localText}` : '[语音]';
  return m.content;
}

/** 关键词命中高亮（QQ 蓝色，对照真 QQ 搜索结果） */
export function QqHighlight({ text, kw }: { text: string; kw: string }) {
  const k = kw.trim().toLowerCase();
  const idx = k ? text.toLowerCase().indexOf(k) : -1;
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-[#0099FF]" data-testid="qq-search-hit-mark">
        {text.slice(idx, idx + k.length)}
      </span>
      {text.slice(idx + k.length)}
    </>
  );
}

export function QqSearchPage({
  me,
  contacts,
  groups,
  onClose,
  onOpenChat,
  onOpenGroup,
  onAddFriend,
  onOpenStickers,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  groups: ChatGroup[];
  /** 取消 / 返回键：回消息 tab */
  onClose: () => void;
  onOpenChat: (c: ContactRecord) => void;
  onOpenGroup: (g: ChatGroup) => void;
  /** 快捷入口「找人/群」→ 加好友/群页 */
  onAddFriend: () => void;
  /** 快捷入口「表情」→ 表情商城 */
  onOpenStickers: () => void;
  onToast: (m: string) => void;
}) {
  const [kw, setKw] = useState('');
  const key = kw.trim().toLowerCase();

  /** QQ 好友（与消息页会话同口径；自己也在内） */
  const friends = useMemo(
    () => contacts.filter((c) => (isFriendIn(c, 'qq') && c.kind !== 'user') || c.id === me.id),
    [contacts, me.id]
  );

  /** 命中联系人：名字/备注/QQ号匹配 */
  const hitContacts = useMemo<ContactRecord[]>(() => {
    if (!key) return [];
    return friends
      .filter(
        (c) =>
          displayNameOf(c).toLowerCase().includes(key) ||
          c.name.toLowerCase().includes(key) ||
          (c.qqId ?? '').includes(key)
      )
      .slice(0, 8);
  }, [friends, key]);

  /** 命中群聊：群备注/群名匹配 */
  const hitGroups = useMemo<ChatGroup[]>(() => {
    if (!key) return [];
    return groups.filter((g) => (g.remark || g.name).toLowerCase().includes(key)).slice(0, 5);
  }, [groups, key]);

  /** 命中聊天记录：全量会话（好友 + 群）按摘要文本匹配，最新在前取 6 条 */
  const hitMsgs = useMemo<Array<{ key: string; title: string; avatar: string | null; isGroup: boolean; group: ChatGroup | null; contact: ContactRecord | null; senderLabel: string; text: string; time: number }>>(() => {
    if (!key) return [];
    const hits: Array<{ key: string; title: string; avatar: string | null; isGroup: boolean; group: ChatGroup | null; contact: ContactRecord | null; senderLabel: string; text: string; time: number }> = [];
    for (const c of friends) {
      if (c.id === me.id) continue; // 自己的会话没有聊天记录分区入口（从联系人进）
      for (const m of loadMsgs(c.id)) {
        if (m.kind === 'image' || m.recalled) continue;
        const text = qqMsgSearchText(m);
        if (!text || !text.toLowerCase().includes(key)) continue;
        hits.push({
          key: c.id,
          title: displayNameOf(c) || c.name,
          avatar: c.avatar,
          isGroup: false,
          group: null,
          contact: c,
          senderLabel: m.role === 'me' ? '我' : '',
          text,
          time: m.time,
        });
      }
    }
    for (const g of groups) {
      for (const m of loadGroupMsgs(g.id)) {
        if (m.kind === 'image' || m.kind === 'notice') continue;
        const text = (m.content ?? '').trim();
        if (!text || !text.toLowerCase().includes(key)) continue;
        hits.push({
          key: qqGroupRowId(g.id),
          title: g.remark || g.name,
          avatar: g.avatar,
          isGroup: true,
          group: g,
          contact: null,
          senderLabel: m.role === 'me' ? '我' : m.senderName,
          text,
          time: m.time,
        });
      }
    }
    hits.sort((a, b) => b.time - a.time);
    return hits.slice(0, 6);
    // key 变化才重算（loadMsgs 同步读缓存，不进依赖）
     
  }, [key, friends, groups, me.id]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const hasResults = hitContacts.length + hitGroups.length + hitMsgs.length > 0;

  return (
    <div className="absolute inset-0 z-40 flex h-full w-full flex-col bg-white text-[#1F2329] dark:bg-[#16171A] dark:text-white">
      {/* 顶栏：搜索框 + 取消（对照截图 2） */}
      <div className="shrink-0 pt-[54px]">
        <div className="flex h-12 items-center gap-3 px-3 pb-1">
          <div className="flex h-[36px] min-w-0 flex-1 items-center gap-2 rounded-[8px] bg-[#EEF1F6] px-3 dark:bg-white/[0.08]">
            <Search className="h-[17px] w-[17px] shrink-0 text-black/30 dark:text-white/30" strokeWidth={2.2} aria-hidden="true" />
            <input
              autoFocus
              type="text"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="搜索"
              data-testid="qq-search-input"
              aria-label="搜索"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
            {kw && (
              <button type="button" aria-label="清空" data-testid="qq-search-clear" onClick={() => setKw('')} className="shrink-0 active:opacity-60">
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-black/25 text-[10px] leading-none text-white dark:bg-white/30">
                  ×
                </span>
              </button>
            )}
          </div>
          <button
            type="button"
            data-testid="qq-search-cancel"
            onClick={onClose}
            className="shrink-0 text-[16px] text-[#0099FF] active:opacity-60"
          >
            取消
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {!key ? (
          /* 搜索指定内容（对照截图 2：标题 + 找人/群、表情、小程序三个快捷入口） */
          <div data-testid="qq-search-shortcuts">
            <p className="border-b border-black/[0.06] px-4 pb-3 pt-5 text-[15px] text-black/45 dark:border-white/[0.07] dark:text-white/45">
              搜索指定内容
            </p>
            <div className="flex items-start px-2 pt-5">
              {(
                [
                  { label: '找人/群', icon: <UserPlus className="h-[26px] w-[26px]" strokeWidth={1.6} />, testid: 'qq-search-sc-find', action: onAddFriend },
                  { label: '表情', icon: <Smile className="h-[26px] w-[26px]" strokeWidth={1.6} />, testid: 'qq-search-sc-sticker', action: onOpenStickers },
                  { label: '小程序', icon: <Compass className="h-[26px] w-[26px]" strokeWidth={1.6} />, testid: 'qq-search-sc-miniapp', action: () => onToast('小程序暂未开放') },
                ] as const
              ).map((it) => (
                <button
                  key={it.label}
                  type="button"
                  data-testid={it.testid}
                  onClick={it.action}
                  className="flex flex-1 flex-col items-center gap-2 rounded-[12px] py-2 text-black/60 active:bg-black/[0.04] dark:text-white/60 dark:active:bg-white/[0.06]"
                >
                  {it.icon}
                  <span className="text-[13px]">{it.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {!hasResults && (
              <p className="mt-16 text-center text-[14px] text-black/35 dark:text-white/35" data-testid="qq-search-empty">
                暂无搜索结果
              </p>
            )}

            {/* 联系人 */}
            {hitContacts.length > 0 && (
              <section data-testid="qq-search-contacts">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">联系人</p>
                {hitContacts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-testid={`qq-search-contact-${c.id}`}
                    onClick={() => onOpenChat(c)}
                    className="flex h-[56px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <QqAvatar src={c.avatar} alt={displayNameOf(c) || c.name} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15.5px]">
                        <QqHighlight text={displayNameOf(c) || c.name} kw={kw} />
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-black/35 dark:text-white/35">QQ:{c.qqId || '未设置'}</span>
                    </span>
                    {c.id !== me.id && (
                      <span
                        className="shrink-0 rounded-full px-3.5 py-[5px] text-[12px] text-white"
                        style={{ backgroundColor: QQ_BLUE }}
                        aria-hidden="true"
                      >
                        发消息
                      </span>
                    )}
                  </button>
                ))}
              </section>
            )}

            {/* 群聊 */}
            {hitGroups.length > 0 && (
              <section data-testid="qq-search-groups">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">群聊</p>
                {hitGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    data-testid={`qq-search-group-${g.id}`}
                    onClick={() => onOpenGroup(g)}
                    className="flex h-[56px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <QqGroupAvatar group={g} contacts={contacts} size={40} />
                    <span className="min-w-0 flex-1 truncate text-[15.5px]">
                      <QqHighlight text={g.remark || g.name} kw={kw} />
                    </span>
                    <span className="shrink-0 text-[12px] text-black/30 dark:text-white/30">{g.memberIds.length + 1}人</span>
                  </button>
                ))}
              </section>
            )}

            {/* 聊天记录 */}
            {hitMsgs.length > 0 && (
              <section data-testid="qq-search-msgs">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">聊天记录</p>
                {hitMsgs.map((h, i) => (
                  <button
                    key={`${h.key}-${h.time}-${i}`}
                    type="button"
                    data-testid="qq-search-msg-item"
                    onClick={() => {
                      if (h.isGroup && h.group) onOpenGroup(h.group);
                      else if (h.contact) onOpenChat(h.contact);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    {h.isGroup && h.group ? (
                      <span className="shrink-0">
                        <QqGroupAvatar group={h.group} contacts={contacts} size={40} />
                      </span>
                    ) : (
                      <QqAvatar src={h.avatar} alt={h.title} size={40} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-black/45 dark:text-white/45">
                          {h.senderLabel ? `${h.title} · ${h.senderLabel}` : h.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-black/25 dark:text-white/25">{fmtTime(h.time)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[14.5px] leading-snug">{h.text}</span>
                    </span>
                  </button>
                ))}
              </section>
            )}
          </>
        )}
      </div>
      <span className="sr-only">{me.name}的QQ搜索</span>
    </div>
  );
}

// ---------------- 消息页 ----------------

/** 会话长按操作持久化（置顶迁移至 @/lib/chat-flags 的 qqChatFlags 表；已删除会话后有新消息自动重新出现）。
 *  多账号 v2（Task 40-2b）：读写现算 accLs(key,'qq') 按账号隔离（大号=原键，各账号隐藏会话互不串） */
export const LS_CHAT_HIDDEN = 'qq-chat-hidden';

/** 未读计数总线（单例在 @/lib/unread-store）：会话列表角标 / 聊天页返回键角标 / 底部 tab 角标 / 主屏图标角标共享 */
export const qqUnreads = qqUnreadStore;

export function loadStrList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

export function saveStrList(key: string, list: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // 忽略
  }
}

export function MessagesPage({
  me,
  contacts,
  liquid = false,
  retro = false,
  onOpenChat,
  onOpenGroup,
  onOpenDrawer,
  onAvatar,
  onAddFriend,
  onCreateGroup,
  onOpenSearch,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  /** 液态玻璃主题（MainScreen 下发）：搜索胶囊玻璃化 + 会话列表玻璃卡 + 滚动底部为悬浮 TabBar 让位 */
  liquid?: boolean;
  /** 古早主题（MainScreen 下发）：头部银灰导航条 + 搜索框白底内凹 + 会话列表白色硬边分组卡 */
  retro?: boolean;
  onOpenChat: (c: ContactRecord) => void;
  /** 打开某个 QQ 群聊（群会话行） */
  onOpenGroup: (g: ChatGroup) => void;
  onOpenDrawer: () => void;
  onAvatar: () => void;
  onAddFriend: () => void;
  /** 发起群聊（建群页）——入口在消息页右上角加号菜单 */
  onCreateGroup: () => void;
  /** 点击搜索框：进全屏搜索页（对照真 QQ，搜索在独立页里做） */
  onOpenSearch: () => void;
  onToast: (m: string) => void;
}) {
  // 右上角加号菜单（对照真 QQ：创建群聊/创建频道/加好友/群/扫一扫/传文件/收付款）
  const [plusMenu, setPlusMenu] = useState(false);
  // 右滑手势：页面任意位置（输入控件除外）水平右滑 → 个人中心抽屉
  const swipe = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  // 会话管理：置顶 / 免打扰（chat-flags 总线）/ 未读 / 已删除（长按菜单操作，localStorage 持久化）
  const flagsMap = useChatFlags(qqChatFlagsStore);
  const unreads = useUnreadMap(qqUnreads);
  const [hidden, setHidden] = useState<string[]>(() => loadStrList(accLs(LS_CHAT_HIDDEN, 'qq')));
  // 好友来信 / 未读变化 tick：会话预览派生自 localStorage，需要 tick 触发 useMemo 重算
  const [msgTick, setMsgTick] = useState(0);
  useEffect(() => qqUnreads.subscribe(() => setMsgTick((t) => t + 1)), []);
  // 全局流式回复落盘 tick：聊天页外收到的 AI 回复写入存储后刷新会话预览/排序
  useChatStreamFinalized('qq:', () => setMsgTick((t) => t + 1));
  // 长按菜单（微信同款横向单行条：置顶/标为未读/删除 + 指向箭头；浅色白底黑字/深色深底白字；位置在长按触发时计算好，render 不读 ref）
  const [ctx, setCtx] = useState<null | { row: SessionRow; x: number; y: number; arrow: 'down' | 'up'; arrowX: number }>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ timer: number | null; x: number; y: number }>({ timer: null, x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const onSwipeStart = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea')) return;
    swipe.current = { x: e.clientX, y: e.clientY, fired: false };
  };
  const onSwipeMove = (e: React.PointerEvent) => {
    const t = swipe.current;
    if (!t || t.fired) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (dx > 50 && Math.abs(dy) < 80) {
      t.fired = true;
      onOpenDrawer();
      return;
    }
    if (dx < -30 || Math.abs(dy) > 90) t.fired = true; // 反向/纵向则放弃，避免误触发
  };
  // 会话 = 已加好友的 char/npc + 自己（自我会话也显示；已删除会话隐藏，收到新消息自动恢复；置顶优先）
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const pinSet = useMemo(
    () => new Set(Object.keys(flagsMap).filter((id) => flagsMap[id]?.pinned === true)),
    [flagsMap]
  );
  /** 会话行：私聊（contact）或群聊（group）；群会话按 group:<gid> 键共用置顶/免打扰/未读设施 */
  interface SessionRow {
    key: string;
    name: string;
    contact: ContactRecord | null;
    group: ChatGroup | null;
    text: string;
    time: number;
  }
  // QQ 群聊（与私聊同列表展示但各自独立会话；tab 切换重挂载时现场读取即最新）
  // 退群挽留：AI 把机主拉回群后（quit-flow 广播恢复事件）立刻重读群池，恢复的群即时回到列表
  const [groupsTick, setGroupsTick] = useState(0);
  useEffect(() => {
    const fn = () => setGroupsTick((v) => v + 1);
    window.addEventListener('quit-flow:group-restored', fn);
    return () => window.removeEventListener('quit-flow:group-restored', fn);
  }, []);
  const chatGroups = useMemo(() => {
    void groupsTick;
    return listChatGroups('qq');
  }, [groupsTick]);
  /** 全量会话（未套搜索过滤）：幽灵未读清理必须以全量列表为准，否则搜索时会把列表外会话的未读误删 */
  const baseConversations = useMemo<SessionRow[]>(() => {
    // 性能：原实现对每个联系人调 2 次 loadMsgs（filter 判空 + map 取预览），每次全量克隆
    // + reverse 再克隆；改为 kv 内存缓存直读原始数组：判空只看 length，预览从尾部扫描
    // 最后一条实质消息（预览只用 kind/recalled/notice/call/fwd/content 等原始记录就有的字段）
    const rawCountOf = (id: string): number => {
      const r = kvGetRaw<QQMsg[]>(lsMsgsKey(id));
      return Array.isArray(r) ? r.length : 0;
    };
    const lastRealMsgOf = (id: string): QQMsg | undefined => {
      const r = kvGetRaw<QQMsg[]>(lsMsgsKey(id));
      if (!Array.isArray(r)) return undefined;
      for (let i = r.length - 1; i >= 0; i--) {
        const m = r[i];
        if (m && m.kind !== 'notice' && m.kind !== 'sys' && m.kind !== 'blockreq' && m.error !== true) return m;
      }
      return undefined;
    };
    const rows: SessionRow[] = contacts
      .filter(
        (c) => ((isFriendIn(c, 'qq') && c.kind !== 'user') || c.id === me.id) && !(hiddenSet.has(c.id) && rawCountOf(c.id) === 0)
      )
      .map((c) => {
        // 通知行/系统提示行/申请卡片/错误占位（旧版失败落库文案）不作为会话预览，回退到最后一条实质消息
        const last = lastRealMsgOf(c.id);
        return { key: c.id, name: c.name, contact: c, group: null, text: msgPreview(last), time: last?.time ?? 0 };
      });
    // 群会话行（群聊与私聊是两类会话，各自独立显示；隐藏后不再出现，可从联系人 › 群聊 再进）
    for (const g of chatGroups) {
      if (hiddenSet.has(qqGroupRowId(g.id))) continue;
      const p = groupPreview(g.id);
      rows.push({ key: qqGroupRowId(g.id), name: g.remark?.trim() || g.name, contact: null, group: g, text: p.text, time: p.time });
    }
    rows.sort((a, b) => {
      const pa = pinSet.has(a.key) ? 0 : 1;
      const pb = pinSet.has(b.key) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if (a.time !== b.time) return b.time - a.time;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    return rows;
  }, [contacts, me.id, hiddenSet, pinSet, msgTick, chatGroups]);
  const conversations = baseConversations;

  /** 幽灵未读清理：只保留当前会话列表里的未读（已删除会话/已删联系人的残留计数没有行可清，
   *  会让底部 tab 与主屏图标角标卡死；prune 无变化时不写入，可安全随 baseConversations 重算触发） */
  useEffect(() => {
    qqUnreads.prune(baseConversations.map((row) => row.key));
  }, [baseConversations]);

  // 退出网页接力：服务端代跑的回复已待达的会话 → 未读角标（同一批条目只在第一次查询时提示，
  // peek 内部 localStorage 去重；进聊天页正式拉取投递后自动解除）。只认 QQ 私聊会话键
  //（qq:<联系人 id>，bump 用未读表的真实键 = 联系人 id）；群聊没有会话页拉取，qq:group: 键过滤兜底
  useEffect(() => {
    void peekBgBadgeCounts().then((counts) => {
      for (const [key, n] of Object.entries(counts)) {
        if (!key.startsWith('qq:') || key.startsWith('qq:group:')) continue;
        qqUnreads.bump(key.slice(3), n);
      }
    });
  }, []);

  // 长按检测：按住 480ms 弹出会话操作菜单；移动超 12px 视为滚动取消
  const clearPress = () => {
    if (pressRef.current.timer) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  };
  const onSessionPointerDown = (e: React.PointerEvent, row: SessionRow) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearPress();
    pressRef.current = { x: e.clientX, y: e.clientY, timer: null };
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = null;
      // 横向单行条（3 项，约 234×64）：默认在触点上方（箭头朝下指向会话行），上方放不下翻到下方
      const root = rootRef.current;
      const rect = root?.getBoundingClientRect();
      const px = rect ? e.clientX - rect.left : e.clientX;
      const py = rect ? e.clientY - rect.top : e.clientY;
      const rootW = root?.clientWidth ?? 360;
      const rootH = root?.clientHeight ?? 600;
      const MENU_W = 234;
      const MENU_H = 64;
      const x = Math.min(Math.max(px - MENU_W / 2, 6), Math.max(rootW - MENU_W - 6, 6));
      let y = py - MENU_H - 14;
      let arrow: 'down' | 'up' = 'down';
      if (y < 6) {
        y = py + 16;
        arrow = 'up';
      }
      y = Math.min(y, Math.max(rootH - MENU_H - 12, 6));
      const arrowX = Math.min(Math.max(px - x, 24), MENU_W - 24);
      setCtx({ row, x, y, arrow, arrowX });
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

  // 菜单操作（置顶/未读/删除）：置顶/未读写入与订阅通知由总线负责（落盘 + 实时同步各角标）
  const togglePin = (id: string) => {
    qqChatFlagsStore.togglePinned(id);
  };
  const toggleUnread = (id: string) => qqUnreads.toggle(id);
  const markRead = (id: string) => qqUnreads.clear(id);
  const removeSession = (id: string) => {
    saveMsgs(id, []); // 清空聊天记录；有新消息时该会话自动重新出现
    qqQueueDelete(id); // #30 排队补跑一并清除：旧实现留着，流空闲后会对已删除会话凭空补跑一轮 AI 回复
    const nextHidden = hidden.includes(id) ? hidden : [...hidden, id];
    saveStrList(accLs(LS_CHAT_HIDDEN, 'qq'), nextHidden);
    setHidden(nextHidden);
    qqChatFlagsStore.reset(id); // 置顶/免打扰/聊天背景一并清除
    qqUnreads.clear(id);
    // #18 记忆锚点一并重置：消息计数/增量锚点清零，下次开聊记忆提取从干净状态重新计数
    //（记忆碎片本体保留：删除会话 ≠ 删除记忆；异步不阻塞主流程）
    void memResetConvoCounters(id);
  };
  /** 群会话删除：只从消息列表移除该行（群本体与聊天记录保留，可从联系人 › 群聊 再进） */
  const removeGroupSession = (key: string) => {
    const nextHidden = hidden.includes(key) ? hidden : [...hidden, key];
    saveStrList(accLs(LS_CHAT_HIDDEN, 'qq'), nextHidden);
    setHidden(nextHidden);
    qqChatFlagsStore.reset(key);
    qqUnreads.clear(key);
    onToast('已从列表移除，群聊保留在联系人 › 群聊');
  };

  /** 消息页右上角加号下拉菜单项（默认白色卡与液态玻璃竖列两个分支共用；图标 21px，液态分支用 CSS 缩到 18px 保默认主题零变化） */
  const plusMenuItems = [
    { key: 'create-group', label: '创建群聊', icon: <MessageSquarePlus className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onCreateGroup(); } },
    { key: 'create-channel', label: '创建频道', icon: <Hash className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onToast('创建频道暂未开放'); } },
    { key: 'add-friend', label: '加好友/群', icon: <UserPlus className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onAddFriend(); } },
    { key: 'scan', label: '扫一扫', icon: <ScanLine className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); openScan('qq'); } },
    { key: 'send-file', label: '传文件', icon: <FolderOutput className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onToast('传文件暂未开放'); } },
    { key: 'pay', label: '收付款', icon: <JapaneseYen className="h-[21px] w-[21px]" strokeWidth={1.9} />, action: () => { setPlusMenu(false); onToast('收付款暂未开放'); } },
  ] as const;

  return (
    <div
      ref={rootRef}
      className="relative flex h-full flex-col"
      onPointerDown={onSwipeStart}
      onPointerMove={onSwipeMove}
      onPointerCancel={() => {
        swipe.current = null;
      }}
      onPointerUp={() => {
        // 延迟到 click 派发后再清空，让 onClickCapture 能拦截手势后的误点击
        window.setTimeout(() => {
          swipe.current = null;
        }, 0);
      }}
      onClickCapture={(e) => {
        if (swipe.current?.fired) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <QqHeader
        user={me}
        title={me.name}
        subtitle={<OnlineBadge />}
        retro={retro}
        onAvatar={onAvatar}
        action={
          <div className="relative">
            <button
              type="button"
              aria-label="添加"
              aria-expanded={plusMenu}
              data-testid="qq-msgs-add"
              className={
                liquid
                  ? /* 液态（第四十五轮，用户指定）：玻璃圆圈内嵌黑色圆圈（同微信语音钮样式）；
                     第四十八轮（用户指定）：按钮变小一点 38→34px（内圈 28→24、图标 18→15） */
                    'lg-chip flex h-[34px] w-[34px] items-center justify-center rounded-full active:opacity-60'
                  : 'rounded-full p-1.5 active:bg-black/5'
              }
              onClick={() => setPlusMenu((v) => !v)}
            >
              {liquid ? (
                <span className="flex h-[24px] w-[24px] items-center justify-center rounded-full border-[1.5px] border-black/85 text-black/90 dark:border-white/70 dark:text-white/90">
                  <Plus className={`h-[15px] w-[15px] transition-transform duration-200 ${plusMenu ? 'rotate-45' : ''}`} strokeWidth={2.1} />
                </span>
              ) : (
                <Plus className={`h-6 w-6 transition-transform duration-200 ${plusMenu ? 'rotate-45' : ''}`} strokeWidth={2} />
              )}
            </button>
            {/* 加号下拉菜单：默认 = 白色圆角面板 + 指向箭头（对照需求截图）；液态 = 乳白强模糊玻璃竖列（lg-sheet 无箭头）；点击面板外关闭 */}
            {plusMenu && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setPlusMenu(false)} />
                {liquid ? (
                  <div
                    data-testid="qq-msgs-plus-menu"
                    className="lg-sheet absolute right-0 top-[calc(100%+8px)] z-50 w-[208px] overflow-hidden rounded-[18px] py-[4px]"
                    role="menu"
                  >
                    {plusMenuItems.map((it) => (
                      <button
                        key={it.key}
                        type="button"
                        role="menuitem"
                        data-testid={`qq-plus-${it.key}`}
                        onClick={it.action}
                        className="lg-menu-row flex h-[40px] w-full items-center gap-3 px-4 text-left text-[13.5px] font-semibold text-[#1C1C1E] dark:text-white/90 [&_svg]:h-[18px] [&_svg]:w-[18px]"
                      >
                        <span className="shrink-0 text-black/80 dark:text-white/85">{it.icon}</span>
                        {it.label}
                      </button>
                    ))}
                  </div>
                ) : (
                <div
                  data-testid="qq-msgs-plus-menu"
                  className="absolute right-0 top-[calc(100%+6px)] z-50 w-[172px] rounded-[14px] bg-white p-1.5 shadow-[0_6px_28px_rgba(0,0,0,0.16)] dark:bg-[#2A2C31] dark:shadow-[0_6px_28px_rgba(0,0,0,0.5)]"
                >
                  <span aria-hidden="true" className="absolute -top-[5px] right-[13px] block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-white dark:bg-[#2A2C31]" />
                  {plusMenuItems.map((it) => (
                    <button
                      key={it.key}
                      type="button"
                      data-testid={`qq-plus-${it.key}`}
                      onClick={it.action}
                      className="flex w-full items-center gap-3 rounded-[10px] px-3 py-[9px] text-left active:bg-black/5 dark:active:bg-white/10"
                    >
                      <span className="shrink-0 text-black/70 dark:text-white/70">{it.icon}</span>
                      <span className="text-[15px]">{it.label}</span>
                    </button>
                  ))}
                </div>
                )}
              </>
            )}
          </div>
        }
      />
      <div className="px-4 pb-2 pt-1">
        {/* 搜索框（点击进全屏搜索页，对照真 QQ 与需求截图 2） */}
        <button
          type="button"
          data-testid="qq-search-entry"
          aria-label="搜索"
          onClick={onOpenSearch}
          className={
            liquid
              ? 'flex h-[36px] w-full items-center gap-1.5 rounded-full lg-search px-3 text-left'
              : retro
              ? 'flex h-[36px] w-full items-center gap-1.5 rt-search px-3 text-left'
              : 'flex h-[36px] w-full items-center gap-1.5 rounded-full bg-black/[0.05] px-3 text-left active:bg-black/[0.08] dark:bg-white/[0.08] dark:active:bg-white/[0.12]'
          }
        >
          <Search className="h-4 w-4 shrink-0 text-black/35 dark:text-white/35" strokeWidth={2.2} aria-hidden="true" />
          <span className="text-[15px] text-black/30 dark:text-white/30">搜索</span>
        </button>
      </div>
      <div className={liquid ? 'flex-1 overflow-y-auto pb-[88px]' : 'flex-1 overflow-y-auto'} style={{ touchAction: 'pan-y' }}>
        {conversations.length === 0 && (
          <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">
            还没有会话，去「联系人」App 添加好友吧
          </p>
        )}
        {/* 液态玻璃（用户指定）：背景跟真实 App 一致（与默认同底色）——置顶会话/非置顶会话各自包一张白色面板（lg-panel），
            卡间 mt-2.5；默认主题无包裹层零变化（空态提示仍在最前，无会话不渲染空面板） */}
        {(liquid
          ? [conversations.filter((r) => pinSet.has(r.key)), conversations.filter((r) => !pinSet.has(r.key))]
          : [conversations]
        ).map((group, gi) =>
          group.length > 0 || !liquid ? (
            <div key={gi} className={liquid ? `lg-panel mx-2.5 overflow-hidden ${gi > 0 ? 'mt-2.5' : ''}` : retro ? 'mx-2 rt-panel overflow-hidden' : ''}>
              {group.map((row) => {
          const pinned = pinSet.has(row.key);
          const unreadCount = unreads[row.key] ?? 0;
          return (
            <button
              key={row.key}
              type="button"
              data-testid={`qq-session-${row.key}`}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                markRead(row.key);
                if (row.contact) onOpenChat(row.contact);
                else if (row.group) onOpenGroup(row.group);
              }}
              onPointerDown={(e) => onSessionPointerDown(e, row)}
              onPointerMove={onSessionPointerMove}
              onPointerUp={clearPress}
              onPointerCancel={clearPress}
              onPointerLeave={clearPress}
              /* qq-session-row：会话行锚点（自定义 CSS 示例模板可改行底/置顶色） */
              className={`qq-session-row flex w-full select-none items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05] ${
                pinned ? 'bg-[#F0F1F5] dark:bg-white/[0.06]' : ''
              }`}
            >
              <span className="relative shrink-0">
                {row.contact ? (
                  <QqAvatar src={row.contact.avatar} alt={row.contact.name} size={52} />
                ) : (
                  row.group && <QqGroupAvatar group={row.group} contacts={contacts} size={52} />
                )}
                {unreadCount > 0 && (
                  <span
                    data-testid={`qq-unread-badge-${row.key}`}
                    aria-label={`${unreadCount} 条未读`}
                    className={
                      flagsMap[row.key]?.muted === true
                        ? /* 免打扰：不显示数字，只显示小红点 */
                          'absolute -right-[2px] -top-[2px] block h-[10px] w-[10px] rounded-full bg-[#F5455C] ring-2 ring-white dark:ring-[#111214]'
                        : 'absolute -right-2 -top-2 flex h-[21px] min-w-[21px] items-center justify-center rounded-full bg-[#F5455C] px-[6px] text-[12px] font-semibold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.28)] ring-2 ring-white dark:ring-[#111214]'
                    }
                  >
                    {flagsMap[row.key]?.muted === true ? null : unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="truncate text-[16px] font-medium leading-snug">{row.name}</div>
                  {/* 情侣空间标识（第十轮）：会话列表名字后也显示徽章+钥匙，与聊天页同源同显隐 */}
                  <CoupleMark contactId={row.contact?.id ?? null} size={20} testId={`qq-list-couple-mark-${row.key}`} />
                  {flagsMap[row.key]?.muted === true && (
                    <BellOff className="h-3.5 w-3.5 shrink-0 text-black/30 dark:text-white/30" strokeWidth={2} aria-label="消息免打扰" />
                  )}
                </div>
                <div className="truncate text-[13px] text-black/35 dark:text-white/35">{row.text}</div>
              </div>
              <span className="shrink-0 text-[12px] text-black/30 dark:text-white/30">{fmtListTime(row.time)}</span>
            </button>
          );
              })}
            </div>
          ) : null,
        )}
      </div>

      {/* 长按会话菜单（微信同款横向单行条：置顶/标为未读/删除 + 指向箭头；浅色白底黑字，点空白处关闭） */}
      {ctx && (
        <div
          className="absolute inset-0 z-40"
          data-testid="qq-session-ctx-overlay"
          onClick={closeCtx}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="absolute z-50" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              {/* 小箭头：指向长按的会话行（菜单在上方时朝下，在下方时朝上） */}
              <span
                aria-hidden="true"
                className={`absolute z-10 h-[12px] w-[12px] rotate-45 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:bg-[#4C4C4C] ${
                  ctx.arrow === 'down' ? '-bottom-[5px]' : '-top-[5px]'
                }`}
                style={{ left: ctx.arrowX - 6 }}
              />
              <div
                role="menu"
                aria-label="会话操作"
                data-testid="qq-session-ctx"
                className="relative flex w-[234px] divide-x divide-black/[0.08] overflow-hidden rounded-[10px] border border-black/[0.08] bg-white/95 text-black shadow-[0_12px_36px_rgba(0,0,0,0.18)] backdrop-blur-md dark:divide-white/15 dark:border-white/[0.08] dark:bg-[#4C4C4C]/95 dark:text-white dark:shadow-[0_12px_36px_rgba(0,0,0,0.35)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="qq-ctx-pin"
                  onClick={() => {
                    togglePin(ctx.row.key);
                    closeCtx();
                  }}
                  className="flex h-[64px] flex-1 flex-col items-center justify-center gap-[5px] text-[11px] active:bg-black/[0.05] dark:active:bg-white/10"
                >
                  {pinSet.has(ctx.row.key) ? (
                    <PinOff className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  ) : (
                    <Pin className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  )}
                  {pinSet.has(ctx.row.key) ? '取消置顶' : '置顶'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="qq-ctx-unread"
                  onClick={() => {
                    toggleUnread(ctx.row.key);
                    closeCtx();
                  }}
                  className="flex h-[64px] flex-1 flex-col items-center justify-center gap-[5px] text-[11px] active:bg-black/[0.05] dark:active:bg-white/10"
                >
                  <MailOpen className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  {unreads[ctx.row.key] ? '标为已读' : '标为未读'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="qq-ctx-delete"
                  onClick={() => {
                    if (ctx.row.group) removeGroupSession(ctx.row.key);
                    else removeSession(ctx.row.key);
                    closeCtx();
                  }}
                  className="flex h-[64px] flex-1 flex-col items-center justify-center gap-[5px] text-[11px] text-[#F5455C] active:bg-black/[0.05] dark:text-[#FF9A97] dark:active:bg-white/10"
                >
                  <Trash2 className="h-[19px] w-[19px]" strokeWidth={1.9} aria-hidden="true" />
                  {ctx.row.group ? '移除会话' : '删除'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 联系人页 ----------------

export const CT_TABS = ['分组', '好友', '群聊', '频道', '机器人', '设备'] as const;
export type CtTab = (typeof CT_TABS)[number];

export function ContactsPage({
  me,
  contacts,
  liquid = false,
  retro = false,
  onOpenProfile,
  onOpenMeProfile,
  onAvatar,
  onAddFriend,
  onOpenNewFriends,
  onOpenGroup,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  /** 液态玻璃主题（MainScreen 下发）：搜索胶囊/列表分组玻璃化 + 滚动底部为悬浮 TabBar 让位 */
  liquid?: boolean;
  /** 古早主题（MainScreen 下发）：头部银灰导航条 + 搜索框白底内凹 + 列表白色硬边分组卡 */
  retro?: boolean;
  onOpenProfile: (c: ContactRecord) => void;
  onOpenMeProfile: () => void;
  onAvatar: () => void;
  onAddFriend: () => void;
  onOpenNewFriends: () => void;
  /** 打开某个 QQ 群聊 */
  onOpenGroup: (g: ChatGroup) => void;
  onToast: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<CtTab>('分组');
  const [expandSpecial, setExpandSpecial] = useState(false);
  const [expandFriends, setExpandFriends] = useState(true);
  // QQ 群聊（联系人 › 群聊 tab；tab 切换会重挂载本页，现场读取即最新）
  const chatGroups = useMemo(() => listChatGroups('qq'), []);
  const filteredGroups = useMemo(() => {
    const kw2 = q.trim().toLowerCase();
    return kw2 ? chatGroups.filter((g) => g.name.toLowerCase().includes(kw2) || (g.remark ?? '').toLowerCase().includes(kw2)) : chatGroups;
  }, [chatGroups, q]);

  const friends = useMemo(() => contacts.filter((c) => isFriendIn(c, 'qq') && c.kind !== 'user'), [contacts]);
  const special = useMemo(() => friends.filter((c) => c.relation?.includes('特别') || c.relation?.includes('关心')), [friends]);
  const normalFriends = useMemo(() => friends.filter((c) => !special.includes(c)), [friends, special]);

  const kw = q.trim().toLowerCase();
  const filteredFriends = useMemo(
    () => (kw ? friends.filter((c) => c.name.toLowerCase().includes(kw) || (c.qqId ?? '').includes(kw)) : friends),
    [friends, kw]
  );

  return (
    <div className="flex h-full flex-col">
      {/* 顶部：简洁头部（背景封面图与打卡/状态 pills 已按需求删除），头像 + 标题 + 加好友；古早主题 = 银灰拟物导航条 */}
      <div className={`flex shrink-0 items-center gap-3 px-4 pb-1 pt-3 ${retro ? 'rt-bar' : ''}`}>
        <button type="button" aria-label="个人资料" onClick={onAvatar} className="rounded-full active:opacity-80">
          <QqAvatar src={me.avatar} alt={me.name} size={44} />
        </button>
        <div className="min-w-0 flex-1 truncate text-[20px] font-semibold text-black dark:text-white">联系人</div>
        <button
          type="button"
          aria-label="加好友"
          data-testid="qq-contacts-add"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-black/60 active:bg-black/5 dark:text-white/60 dark:active:bg-white/10"
          onClick={onAddFriend}
        >
          <UserPlus className="h-[17px] w-[17px]" strokeWidth={2} />
        </button>
      </div>
      <div className="px-4 pb-2 pt-3">
        <QqSearch value={q} onChange={setQ} liquid={liquid} retro={retro} />
      </div>

      <div className={liquid ? 'flex-1 overflow-y-auto pb-[88px]' : 'flex-1 overflow-y-auto'} data-testid="qq-contacts-list">
        {/* 新朋友 / 群通知（液态玻璃主题：合成一张玻璃卡；古早主题：白色硬边分组卡；默认主题无包裹层零变化） */}
        <div className={liquid ? 'lg-panel mx-2.5 mt-2.5 overflow-hidden' : retro ? 'mx-2 mt-2 rt-panel overflow-hidden' : ''}>
        <button
          type="button"
          data-testid="qq-contacts-newfriends"
          className="flex w-full items-center justify-between border-b border-black/[0.05] px-4 py-3.5 text-left active:bg-black/[0.04] dark:border-white/[0.06] dark:active:bg-white/[0.05]"
          onClick={onOpenNewFriends}
        >
          <span className="text-[16px]">新朋友</span>
          <ChevronRight className="h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="flex w-full items-center justify-between border-b border-black/[0.05] px-4 py-3.5 text-left active:bg-black/[0.04] dark:border-white/[0.06] dark:active:bg-white/[0.05]"
          onClick={() => onToast('群通知暂未开放')}
        >
          <span className="text-[16px]">群通知</span>
          <ChevronRight className="h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
        </div>

        {/* 分组 tab 行（液态玻璃：半透磨砂底，滚动时列表从底下穿过） */}
        <div
          className={
            liquid
              ? 'sticky top-0 z-10 flex gap-5 overflow-x-auto border-b border-black/[0.05] bg-[#F4F4F8]/85 px-4 py-2.5 backdrop-blur-md dark:border-white/[0.06] dark:bg-[#101014]/85'
              : 'sticky top-0 z-10 flex gap-5 overflow-x-auto border-b border-black/[0.05] bg-[#FAFAFC]/95 px-4 py-2.5 backdrop-blur dark:border-white/[0.06] dark:bg-[#16171A]/95'
          }
        >
          {CT_TABS.map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`qq-ct-tab-${t}`}
              onClick={() => setTab(t)}
              className={`relative shrink-0 pb-1.5 text-[15px] ${tab === t ? `font-semibold ${TAB_ACTIVE}` : 'text-black/55 dark:text-white/55'}`}
            >
              {t}
              {tab === t && <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[#1E6FFF] dark:bg-[#4AA3FF]" aria-hidden="true" />}
            </button>
          ))}
        </div>

        {tab === '分组' && (
          <div className={liquid ? 'lg-panel mx-2.5 mt-2.5 overflow-hidden' : retro ? 'mx-2 mt-2 rt-panel overflow-hidden' : ''}>
            {/* 特别关心 */}
            <button
              type="button"
              onClick={() => setExpandSpecial((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left active:bg-black/[0.04]"
              data-testid="qq-group-special"
            >
              <svg
                viewBox="0 0 12 12"
                className={`h-3 w-3 shrink-0 text-black/45 transition-transform dark:text-white/45 ${expandSpecial ? 'rotate-90' : ''}`}
                aria-hidden="true"
              >
                <path d="M3 1.5 9 6 3 10.5z" fill="currentColor" />
              </svg>
              <span className="text-[16px] font-medium">特别关心</span>
              <span className="ml-auto text-[13px] text-black/30 dark:text-white/30">{special.length}/0</span>
            </button>
            {expandSpecial &&
              special.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpenProfile(c)}
                  className="qq-contact-row flex w-full items-center gap-3 py-2 pl-9 pr-4 text-left active:bg-black/[0.04]"
                >
                  <QqAvatar src={c.avatar} alt={c.name} size={42} />
                  <span className="truncate text-[15px]">{c.name}</span>
                </button>
              ))}
            {/* 我的好友 */}
            <button
              type="button"
              onClick={() => setExpandFriends((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left active:bg-black/[0.04]"
              data-testid="qq-group-friends"
            >
              <svg
                viewBox="0 0 12 12"
                className={`h-3 w-3 shrink-0 text-black/45 transition-transform dark:text-white/45 ${expandFriends ? 'rotate-90' : ''}`}
                aria-hidden="true"
              >
                <path d="M3 1.5 9 6 3 10.5z" fill="currentColor" />
              </svg>
              <span className="text-[16px] font-medium">我的好友</span>
              <span className="ml-auto text-[13px] text-black/30 dark:text-white/30">{friends.length}/{friends.length}</span>
            </button>
            {expandFriends && (
              <>
                {/* 我：好友列表首位（点击进自己的资料页） */}
                <button
                  type="button"
                  data-testid="qq-contacts-me"
                  onClick={onOpenMeProfile}
                  className="qq-contact-row flex w-full items-center gap-3 py-2 pl-9 pr-4 text-left active:bg-black/[0.04]"
                >
                  <QqAvatar src={me.avatar} alt={me.name} size={42} />
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px]">{me.name}</span>
                    <span className="shrink-0 rounded-[4px] bg-black/[0.06] px-1 py-px text-[11px] leading-[14px] text-black/45 dark:bg-white/10 dark:text-white/50">我</span>
                  </span>
                </button>
                {normalFriends.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenProfile(c)}
                    className="qq-contact-row flex w-full items-center gap-3 py-2 pl-9 pr-4 text-left active:bg-black/[0.04]"
                  >
                    <QqAvatar src={c.avatar} alt={c.name} size={42} />
                    <span className="truncate text-[15px]">{c.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {tab === '好友' && (
          <div className={liquid ? 'lg-panel mx-2.5 mt-2.5 overflow-hidden' : retro ? 'mx-2 mt-2 rt-panel overflow-hidden' : ''}>
            {/* 我：好友列表首位（搜索时仅名字命中才显示） */}
            {(!kw || me.name.toLowerCase().includes(kw)) && (
              <button
                type="button"
                data-testid="qq-contacts-me-friend"
                onClick={onOpenMeProfile}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04]"
              >
                <QqAvatar src={me.avatar} alt={me.name} size={42} />
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[15px]">{me.name}</span>
                  <span className="shrink-0 rounded-[4px] bg-black/[0.06] px-1 py-px text-[11px] leading-[14px] text-black/45 dark:bg-white/10 dark:text-white/50">我</span>
                </span>
              </button>
            )}
            {filteredFriends.length === 0 && (
              <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂无好友</p>
            )}
            {filteredFriends.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenProfile(c)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04]"
              >
                <QqAvatar src={c.avatar} alt={c.name} size={42} />
                <span className="truncate text-[15px]">{c.name}</span>
              </button>
            ))}
          </div>
        )}

        {tab === '群聊' && (
          <div className={liquid ? 'lg-panel mx-2.5 mt-2.5 overflow-hidden' : retro ? 'mx-2 mt-2 rt-panel overflow-hidden' : ''}>
            {/* 发起群聊入口已迁移至消息页右上角「+」菜单（对照需求：创建群聊移到加号里面） */}
            {filteredGroups.length === 0 ? (
              <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂无群聊，点消息页右上角「+」创建</p>
            ) : (
              filteredGroups.map((g) => {
                const p = groupPreview(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    data-testid={`qq-contacts-group-${g.id}`}
                    onClick={() => onOpenGroup(g)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
                  >
                    <QqGroupAvatar group={g} contacts={contacts} size={42} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{g.remark?.trim() || g.name}</span>
                      {p.text && <span className="block truncate text-[12px] text-black/35 dark:text-white/35">{p.text}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-black/30 dark:text-white/30">{g.memberIds.length + 1}人</span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {(tab === '频道' || tab === '机器人' || tab === '设备') && (
          <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂无{tab}</p>
        )}
      </div>
    </div>
  );
}

// ---------------- 动态页 ----------------

export const DISCOVER_ITEMS: { key: string; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'zone', label: '空间动态', icon: <Star className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#FFC300' },
  { key: 'game', label: '游戏中心', icon: <Gamepad2 className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#1E6FFF' },
  { key: 'moments-settings', label: '空间动态设置', icon: <Settings className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#1E6FFF' },
  { key: 'farm', label: 'QQ经典农场', icon: <Sprout className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#34C759' },
  { key: 'nearby', label: '结伴与附近', icon: <Users className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#7D5FFF' },
  { key: 'novel', label: '小说与动漫', icon: <BookOpen className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#FF9F0A' },
  { key: 'feedback', label: '意见反馈', icon: <MessageSquarePlus className="h-[22px] w-[22px]" strokeWidth={2} />, color: '#1E6FFF' },
];

/** 古早主题动态页图标配色（DISCOVER_ITEMS.key → RetroIc tone；任务指定：zone/game/settings/farm 对应 + 其余 search/zone 兑底） */
export const RETRO_DISCOVER_TONES: Record<string, string> = {
  zone: RETRO_ICON_TONES.zone,
  game: RETRO_ICON_TONES.games,
  'moments-settings': RETRO_ICON_TONES.settings,
  farm: RETRO_ICON_TONES.farm,
  nearby: RETRO_ICON_TONES.search,
  novel: RETRO_ICON_TONES.zone,
  feedback: RETRO_ICON_TONES.search,
};

export function DiscoverPage({
  me,
  liquid = false,
  retro = false,
  onAvatar,
  onZone,
  onOpenMomentsSettings,
  zoneBadge = 0,
  onToast,
}: {
  me: QQUser;
  /** 液态玻璃主题（MainScreen 下发）：搜索胶囊玻璃化 + 每行独立玻璃卡（参考图 2 发现页同款） */
  liquid?: boolean;
  /** 古早主题（MainScreen 下发）：头部银灰导航条 + 搜索框白底内凹 + 彩色图标套拟物底座 */
  retro?: boolean;
  onAvatar: () => void;
  onZone: () => void;
  onOpenMomentsSettings: () => void;
  /** 空间动态未读互动消息数（红色数字角标，同真机「空间动态 1」样式） */
  zoneBadge?: number;
  onToast: (m: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <QqHeader
        user={me}
        title="动态"
        retro={retro}
        onAvatar={onAvatar}
        action={
          <button type="button" aria-label="动态管理" className="rounded-full p-1.5 active:bg-black/5" onClick={() => onToast('动态管理暂未开放')}>
            <LayoutGrid className="h-6 w-6" strokeWidth={2} />
          </button>
        }
      />
      <div className="px-4 pb-2 pt-1">
        <QqSearch value="" onChange={() => undefined} liquid={liquid} retro={retro} />
      </div>
      <div
        className={liquid ? 'flex-1 overflow-y-auto pb-[88px]' : 'flex-1 overflow-y-auto pb-4'}
        data-testid="qq-discover-list"
      >
        {DISCOVER_ITEMS.map((it, idx) => (
          <div key={it.key} className={liquid ? 'lg-panel mx-2.5 mt-2.5 overflow-hidden' : retro ? 'mx-2 mt-2 rt-panel overflow-hidden' : ''}>
            {!liquid && !retro && (idx === 1 || idx === 5 || idx === 6) && (
              <div className="h-2 bg-black/[0.03] dark:bg-white/[0.04]" aria-hidden="true" />
            )}
            <button
              type="button"
              data-testid={`qq-discover-${it.key}`}
              onClick={() => {
                if (it.key === 'zone') onZone();
                else if (it.key === 'moments-settings') onOpenMomentsSettings();
                else onToast(`${it.label}暂未开放`);
              }}
              className="flex w-full items-center gap-4 bg-transparent px-4 py-3.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
            >
              {retro ? (
                /* 古早主题：彩色图标套 RetroIc 拟物底座（复古渐变 tone + 白色线稿，iOS 6 设置页风） */
                <RetroIc tone={RETRO_DISCOVER_TONES[it.key] ?? RETRO_ICON_TONES.search} size={38} radius={10}>
                  <span className="grid place-items-center text-white" aria-hidden="true">{it.icon}</span>
                </RetroIc>
              ) : (
                <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px]" style={{ color: it.color }} aria-hidden="true">
                  {it.icon}
                </span>
              )}
              <span className="flex-1 truncate text-[16px]">{it.label}</span>
              {it.key === 'zone' && zoneBadge > 0 && (
                <span
                  data-testid="qq-discover-zone-badge"
                  aria-label={`空间动态 ${zoneBadge} 条新消息`}
                  className="mr-0.5 flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#F5455C] px-[5px] text-[10.5px] font-semibold leading-none text-white"
                >
                  {zoneBadge > 99 ? '99+' : zoneBadge}
                </span>
              )}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- 个人资料页 ----------------

export function ProfilePage({
  me,
  onBack,
  onOpenZone,
  onOpenSettings,
  onOpenChat,
  onPatchUser,
  onToast,
}: {
  me: QQUser;
  onBack: () => void;
  onOpenZone: () => void;
  onOpenSettings: () => void;
  onOpenChat: () => void;
  onPatchUser: (patch: Partial<QQUser>) => void;
  onToast: (m: string) => void;
}) {
  const [editSign, setEditSign] = useState(false);
  const [signDraft, setSignDraft] = useState(me.persona ?? '');
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const bgFileRef = useRef<HTMLInputElement | null>(null);
  // 头像按 App 隔离：QQ 个人资料页点头像换头像只写机主的 avatars.qq 槽位（合并语义），
  // 不影响微信/信息/电话/联系人全局头像；未设置过则 avatarFor 投影自动回退全局头像
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const onAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    void fileToAvatarDataUrl(f)
      .then((data) => updateContact(me.id, { avatars: { qq: data } }).then((rec) => ({ rec, data })))
      .then(({ rec, data }) => {
        // 第二十九轮「让 AI 知道我换头像了」：头像描述落库（异步识图）+ 给恋人角色写事件记忆
        if (rec) {
          noteAvatarChanged(me.id, 'qq', data, 'me');
          onToast('头像已更新');
        } else onToast('头像保存失败');
      })
      .catch(() => onToast('头像保存失败'));
  };
  // 跨 App 跳转：点「资料完成度/编辑资料」→ 打开联系人 App 后直接进入机主（user）的编辑页
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingContactEdit = useUI((s) => s.setPendingContactEdit);
  const openEditProfile = useCallback(() => {
    setPendingContactEdit(me.id);
    switchToApp('contacts');
  }, [me.id, setPendingContactEdit, switchToApp]);

  // 背景图：IndexedDB 永久保存，进页时恢复
  useEffect(() => {
    let alive = true;
    getQqProfileBg()
      .then((data) => {
        if (alive && data) setBgUrl(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const commitSign = () => {
    setEditSign(false);
    const t = signDraft.trim().slice(0, 60);
    if (t === (me.persona ?? '')) return;
    onPatchUser({ persona: t });
    updateContact(me.id, { persona: t }).catch(() => onToast('个签保存失败'));
  };

  const onBgFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === 'string' ? reader.result : '';
      if (!data) return;
      setBgUrl(data);
      void setQqProfileBg(data).catch(() => onToast('背景保存失败'));
      onToast('背景已更新');
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      {/* 背景图：上传的自定义图（永久保存）> 头像模糊放大 > 蓝灰渐变；高度 320px（轨迹 280→…→290→320，用户要求「上下变大一点」），点击背景任意位置即可更换（无相机按钮） */}
      <div
        role="button"
        aria-label="更换背景"
        data-testid="qq-profile-bg-upload"
        onClick={() => bgFileRef.current?.click()}
        className="absolute inset-x-0 top-0 h-[320px] cursor-pointer"
      >
        {bgUrl ? (
          <img src={bgUrl} alt="个人资料背景" className="h-full w-full object-cover" />
        ) : me.avatar ? (
          <img
            src={me.avatar}
            alt=""
            aria-hidden="true"
            className="h-full w-full scale-125 object-cover blur-2xl brightness-[0.62]"
          />
        ) : (
          <div aria-hidden="true" className="h-full w-full bg-gradient-to-b from-[#93A9CC] to-[#5E6D88]" />
        )}
        <input ref={bgFileRef} type="file" accept="image/*" onChange={onBgFile} className="hidden" tabIndex={-1} aria-hidden="true" />
      </div>

      {/* 顶部浮钮：返回 + 宫格/铃铛/设置 */}
      <div className="relative z-10 flex items-center justify-between px-3">
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="更多"
            onClick={() => onToast('更多暂未开放')}
            className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
          >
            <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="通知"
            onClick={() => onToast('通知暂未开放')}
            className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="设置"
            data-testid="qq-profile-settings"
            onClick={onOpenSettings}
            className="grid h-9 w-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur active:bg-black/40"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* 白色圆角主卡（与背景图叠压：卡顶 215px，露出 215px 背景，叠压 105px） */}
      <div className="relative z-10 mt-[125px] flex-1 overflow-y-auto rounded-t-[22px] bg-white px-5 pb-4 pt-6 dark:bg-[#1B1C1F]">
        {/* 头像 + 昵称/状态 + QQ号 + 点赞（点头像换头像：写 avatars.qq 槽位，仅 QQ 生效） */}
        <div className="flex items-start gap-4">
          <button
            type="button"
            aria-label="更换头像"
            data-testid="qq-profile-avatar"
            onClick={() => avatarFileRef.current?.click()}
            className="shrink-0 rounded-full transition-transform active:scale-95"
          >
            <QqAvatar src={me.avatar} alt={me.name} size={84} />
          </button>
          <input ref={avatarFileRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true" onChange={onAvatarFile} />
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-center gap-2">
              <span className="max-w-[130px] truncate text-[20px] font-bold leading-tight">{me.name}</span>
              <button
                type="button"
                onClick={() => onToast('状态暂未开放')}
                className="flex h-[26px] shrink-0 items-center gap-1 rounded-full border border-black/12 px-2.5 text-[12px] text-black/60 active:opacity-60 dark:border-white/20 dark:text-white/60"
              >
                <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
                状态
              </button>
            </div>
            <div className="mt-1.5 truncate text-[13px] text-black/45 dark:text-white/45" data-testid="qq-profile-qqid">
              QQ:{me.qqId ?? '未设置'}
            </div>
          </div>
          <button
            type="button"
            aria-label="点赞"
            onClick={() => onToast('点赞暂未开放')}
            className="flex shrink-0 flex-col items-center gap-0.5 pt-1 text-black/65 active:opacity-60 dark:text-white/65"
          >
            <ThumbsUp className="h-5 w-5" strokeWidth={1.9} />
            <span className="text-[12px]">60</span>
          </button>
        </div>

        {/* 个签（点击就地编辑，保存到联系人库） */}
        {editSign ? (
          <input
            data-testid="qq-profile-sign-input"
            value={signDraft}
            autoFocus
            onChange={(e) => setSignDraft(e.target.value)}
            onBlur={commitSign}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSign();
              if (e.key === 'Escape') {
                setSignDraft(me.persona ?? '');
                setEditSign(false);
              }
            }}
            maxLength={60}
            placeholder="编辑个签，展示我的独特态度。"
            aria-label="编辑个性签名"
            className="mt-5 h-9 w-full rounded-[8px] bg-black/[0.05] px-3 text-[15px] outline-none dark:bg-white/[0.08]"
          />
        ) : (
          <button
            type="button"
            data-testid="qq-profile-sign"
            onClick={() => {
              setSignDraft(me.persona ?? '');
              setEditSign(true);
            }}
            className="mt-5 flex w-full items-center justify-between gap-3 text-left active:opacity-70"
          >
            <span className="truncate text-[15px]">{me.persona || '编辑个签，展示我的独特态度。'}</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        )}

        {/* 徽章行（QQ 等级图标；SVIP8/勋章/LV8/LV3 已删除） */}
        <QqBadgeWall testid="qq-profile-badges" mtClass="mt-4" onOpen={() => onToast('勋章墙暂未开放')} />

        {/* 添加标签 */}
        <button
          type="button"
          onClick={() => onToast('标签暂未开放')}
          className="mt-5 flex h-8 items-center gap-1.5 rounded-[8px] bg-black/[0.045] px-3 text-[13px] text-black/55 active:opacity-60 dark:bg-white/[0.08] dark:text-white/55"
        >
          添加标签
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        {/* 资料完成度（点击 → 联系人 App 机主编辑页） */}
        <div className="-mx-5 mt-5 h-2 bg-black/[0.04] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          data-testid="qq-profile-completion"
          onClick={openEditProfile}
          className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
        >
          <FileText className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
          <span className="flex-1 truncate text-[15px]">资料完成度60%</span>
          <span className="text-[14px] text-[#1E6FFF] dark:text-[#4AA3FF]">去完善</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        {/* QQ空间 */}
        <div className="-mx-5 h-2 bg-black/[0.04] dark:bg-white/[0.05]" aria-hidden="true" />
        <button
          type="button"
          data-testid="qq-profile-zone"
          onClick={onOpenZone}
          className="flex h-[54px] w-full items-center gap-3 text-left active:opacity-70"
        >
          <Star className="h-5 w-5 shrink-0 text-black/70 dark:text-white/70" aria-hidden="true" />
          <span className="flex-1 truncate text-[15px]">QQ空间</span>
          <span className="text-[14px] text-[#1E6FFF] dark:text-[#4AA3FF]">分享新鲜事</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
      </div>

      {/* 底部三按钮 */}
      <div className="relative z-10 flex shrink-0 gap-3 bg-white px-4 pb-[40px] pt-3 dark:bg-[#1B1C1F]">
        <button
          type="button"
          onClick={() => onToast('个性名片暂未开放')}
          className="h-11 flex-1 rounded-[12px] bg-black/[0.05] text-[15px] active:opacity-70 dark:bg-white/[0.08]"
        >
          个性名片
        </button>
        <button
          type="button"
          data-testid="qq-profile-edit"
          onClick={openEditProfile}
          className="h-11 flex-1 rounded-[12px] bg-black/[0.05] text-[15px] active:opacity-70 dark:bg-white/[0.08]"
        >
          编辑资料
        </button>
        <button
          type="button"
          data-testid="qq-profile-message"
          onClick={onOpenChat}
          className="h-11 flex-1 rounded-[12px] text-[15px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: QQ_BLUE }}
        >
          发消息
        </button>
      </div>
    </div>
  );
}

// ---------------- 个人中心抽屉（消息/联系人/动态页左上头像打开） ----------------

export function MeDrawer({
  me,
  onClose,
  onOpenProfile,
  onOpenWallet,
  onOpenStickers,
  onOpenFavorites,
  onOpenSettings,
  onOpenDress,
  onOpenAlbum,
  onPatchUser,
  onToast,
}: {
  me: QQUser;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenWallet: () => void;
  onOpenStickers: () => void;
  onOpenFavorites: () => void;
  onOpenSettings: () => void;
  /** 个性装扮 → 主题界面（毛玻璃胶囊：主题/气泡两个选择） */
  onOpenDress: () => void;
  onOpenAlbum: () => void;
  onPatchUser: (patch: Partial<QQUser>) => void;
  onToast: (m: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const [editSign, setEditSign] = useState(false);
  const [signDraft, setSignDraft] = useState(me.persona ?? '');
  /** 切换账号弹出卡片（对照截图样式）：胶囊按钮点开，点外面/再点关闭 */
  const [accCardOpen, setAccCardOpen] = useState(false);
  /** 用户第九轮：天气城市按钮跟随天气 App（城市名/温度/实况图标，与天气 App 共享快照） */
  const weather = useWeatherSnapshot();
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const close = () => {
    setShown(false);
    window.setTimeout(onClose, 240);
  };

  // 左滑手势：面板任意位置（输入控件除外）水平左滑 → 关闭抽屉（配合右滑打开）
  const swipe = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  const onSwipeStart = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea')) return;
    swipe.current = { x: e.clientX, y: e.clientY, fired: false };
  };
  const onSwipeMove = (e: React.PointerEvent) => {
    const t = swipe.current;
    if (!t || t.fired) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (dx < -50 && Math.abs(dy) < 80) {
      t.fired = true;
      close();
      return;
    }
    if (dx > 30 || Math.abs(dy) > 90) t.fired = true; // 反向/纵向则放弃，避免误触发
  };

  const commitSign = () => {
    setEditSign(false);
    const t = signDraft.trim().slice(0, 60);
    if (t === (me.persona ?? '')) return;
    onPatchUser({ persona: t });
    updateContact(me.id, { persona: t }).catch(() => onToast('个签保存失败'));
  };

  const listRows: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }[] = [
    { icon: <ImageIcon className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '相册', onClick: () => { close(); window.setTimeout(onOpenAlbum, 240); } },
    { icon: <Star className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '收藏', onClick: () => { close(); window.setTimeout(onOpenFavorites, 240); } },
    { icon: <Smile className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '表情', onClick: () => { close(); window.setTimeout(onOpenStickers, 240); } },
    { icon: <Wallet className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '钱包', onClick: () => { close(); window.setTimeout(onOpenWallet, 240); } },
    { icon: <Shirt className="h-[22px] w-[22px]" strokeWidth={1.9} />, label: '个性装扮', onClick: () => { close(); window.setTimeout(onOpenDress, 240); } },
  ];
  const rowColors = ['#F5B90F', '#3BA0FF', '#3BA0FF', '#3BA0FF', '#F0479C'];

  return (
    <div className="absolute inset-0 z-40 overflow-hidden" role="dialog" aria-label="个人中心">
      {/* 全屏独立页：整页白底 + 从左往右滑入（translate-x 从 -100% 到 0） */}
      <div
        className={`relative flex h-full flex-col overflow-hidden bg-white transition-transform duration-300 ease-out dark:bg-[#17181C] ${
          shown ? 'translate-x-0' : '-translate-x-full'
        }`}
        onPointerDown={onSwipeStart}
        onPointerMove={onSwipeMove}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onPointerUp={() => {
          // 延迟到 click 派发后再清空，让 onClickCapture 能拦截手势后的误点击
          window.setTimeout(() => {
            swipe.current = null;
          }, 0);
        }}
        onClickCapture={(e) => {
          if (swipe.current?.fired) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {/* 切换账号弹出卡片（对照真实 QQ 截图：头像+名字+号码+当前蓝勾；匿名号不在此展示——
            匿名号码只属于电话/信息，2025 需求移除卡片内的匿名账号行） */}
        {accCardOpen && (
          <QqDrawerAccountCard
            onPick={(id) => {
              setAccCardOpen(false);
              switchAccountFor('qq', id);
            }}
            onClose={() => setAccCardOpen(false)}
          />
        )}
        {/* 整页滚动：顶部（打卡/头像/昵称）随内容一起滚动，不再固定 */}
        <div className="relative flex-1 overflow-y-auto">
        {/* 顶部（无背景图）：打卡/状态 pills 缩小行置顶，其下头像/昵称/切换账号；点击行间空白处关闭抽屉 */}
        <div className="relative w-full px-4 pb-1 pt-[62px]" onClick={close}>
          <div className="relative z-10" onClick={(e) => e.stopPropagation()}>
            <QqCheckinPills testidPrefix="qq-drawer" onToast={onToast} />
          </div>
          {/* 头像 + 昵称 + 切换账号 + 关闭（打卡/状态 pills 正下方） */}
          <div className="relative z-10 mt-3 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="查看个人资料" data-testid="qq-drawer-avatar" onClick={onOpenProfile} className="rounded-full active:opacity-80">
              <QqAvatar src={me.avatar} alt={me.name} size={64} />
            </button>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                aria-label="查看个人资料"
                data-testid="qq-drawer-name"
                onClick={onOpenProfile}
                className="block max-w-full truncate text-left text-[20px] font-bold leading-tight active:opacity-70"
              >
                {me.name}
              </button>
              <button
                type="button"
                data-testid="qq-drawer-switch"
                onClick={() => setAccCardOpen(true)}
                className="mt-1.5 flex h-7 items-center rounded-full border border-black/12 px-3 text-[12px] text-black/60 active:opacity-60 dark:border-white/20 dark:text-white/60"
              >
                切换账号
              </button>
            </div>
            <button
              type="button"
              aria-label="关闭个人中心"
              data-testid="qq-drawer-close"
              onClick={close}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10"
            >
              <X className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* 白色主卡（整页白底；无背景图，内容从个签开始紧随顶部） */}
        <div className="relative px-5 pb-2 pt-3">
          {/* 个签（可编辑） */}
          <div className="mt-3 flex items-center gap-2">
            <SquarePen className="h-4 w-4 shrink-0 text-black/45 dark:text-white/45" aria-hidden="true" />
            {editSign ? (
              <input
                data-testid="qq-drawer-sign-input"
                value={signDraft}
                autoFocus
                onChange={(e) => setSignDraft(e.target.value)}
                onBlur={commitSign}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSign();
                  if (e.key === 'Escape') {
                    setSignDraft(me.persona ?? '');
                    setEditSign(false);
                  }
                }}
                maxLength={60}
                placeholder="编辑个签，展示我的独特态度。"
                className="h-8 w-full rounded-[8px] bg-black/[0.04] px-2.5 text-[14px] outline-none dark:bg-white/[0.08]"
              />
            ) : (
              <button
                type="button"
                data-testid="qq-drawer-sign"
                onClick={() => {
                  setSignDraft(me.persona ?? '');
                  setEditSign(true);
                }}
                className="truncate text-left text-[15px] text-black/60 active:opacity-60 dark:text-white/60"
              >
                {me.persona || '编辑个签，展示我的独特态度。'}
              </button>
            )}
          </div>

          {/* 天气 + 添加标签 */}
          <div className="mt-4 flex items-center gap-3">
            <span className="text-[18px]" aria-hidden="true">
              🌤️
            </span>
            <button
              type="button"
              onClick={() => onToast('标签暂未开放')}
              className="flex h-8 items-center gap-1 rounded-full border border-black/12 px-3 text-[13px] text-black/55 active:opacity-60 dark:border-white/20 dark:text-white/55"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              添加标签
            </button>
          </div>

          {/* 通知 | 赞 + 创建QQ秀 */}
          <div className="mt-5 flex items-center text-[14px] text-black/65 dark:text-white/65">
            <button type="button" onClick={() => onToast('通知暂未开放')} className="flex items-center gap-1.5 active:opacity-60">
              <Bell className="h-4 w-4" aria-hidden="true" />
              通知
            </button>
            <span className="mx-3 h-3.5 w-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
            <button type="button" onClick={() => onToast('赞暂未开放')} className="flex items-center gap-1.5 active:opacity-60">
              <ThumbsUp className="h-4 w-4" aria-hidden="true" />60
            </button>
            <button
              type="button"
              onClick={() => onToast('QQ秀暂未开放')}
              className="ml-auto flex h-8 items-center gap-1 rounded-full bg-black/[0.05] px-3 text-[13px] active:opacity-60 dark:bg-white/[0.08]"
            >
              🐧 创建QQ秀
            </button>
          </div>

          {/* 功能列表 */}
          <div className="mt-4">
            {listRows.map((r, i) => (
              <button
                key={r.label}
                type="button"
                onClick={r.onClick}
                className="flex h-[54px] w-full items-center gap-4 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center" style={{ color: rowColors[i] }} aria-hidden="true">
                  {r.icon}
                </span>
                <span className="flex-1 truncate text-[16px]">{r.label}</span>
                {r.hint && <span className="text-[13px] text-black/30 dark:text-white/30">{r.hint}</span>}
                <ChevronRight className="h-5 w-5 shrink-0 text-black/22 dark:text-white/25" aria-hidden="true" />
              </button>
            ))}
          </div>

        </div>
        </div>

        {/* 底部：设置 / 夜间 / 天气城市（固定在抽屉底部；用户第九轮：按钮上下变小+城市跟随天气 App；
            用户第十三轮：三个按钮再往下移（pb 34→20px，贴近抽屉底缘）） */}
        <div className="shrink-0 px-5 pb-[20px] pt-4">
          <div className="flex items-start justify-around border-t border-black/[0.05] pt-3.5 dark:border-white/[0.06]">
            {[
              { icon: <Settings className="h-[19px] w-[19px]" strokeWidth={1.9} />, label: '设置', sub: null, fn: onOpenSettings, testid: 'qq-drawer-settings' },
              { icon: <Moon className="h-[19px] w-[19px]" strokeWidth={1.9} />, label: '夜间', sub: null, fn: () => onToast('夜间模式跟随系统设置'), testid: 'qq-drawer-night' },
              {
                icon: weather ? (
                  (() => {
                    const WxIcon = weatherCodeInfo(weather.current.code).Icon;
                    return <WxIcon className="h-[19px] w-[19px]" strokeWidth={1.9} />;
                  })()
                ) : (
                  <CloudSun className="h-[19px] w-[19px]" strokeWidth={1.9} />
                ),
                label: weather?.name?.trim() || '天气',
                sub: weather ? `${Math.round(weather.current.temperature)}° ${weatherCodeInfo(weather.current.code).label}` : null,
                fn: () => onToast('天气详见「天气」App'),
                testid: 'qq-drawer-weather',
              },
            ].map((b) => (
              <button
                key={b.testid}
                type="button"
                data-testid={b.testid}
                onClick={() => {
                  if (b.label === '设置') {
                    close();
                    window.setTimeout(b.fn, 240);
                  } else {
                    b.fn();
                  }
                }}
                className="flex w-16 flex-col items-center gap-[3px] text-black/60 active:opacity-60 dark:text-white/60"
              >
                {b.icon}
                <span className="text-[11px] leading-none">{b.label}</span>
                <span className="h-[13px] text-[10px] leading-[13px] text-black/40 dark:text-white/40">
                  {b.sub ?? '\u00A0'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- 添加好友页（找人/找群 + 七宫格 + 推荐） / 新朋友页（可能想认识的人） ----------------

export function AddPersonRow({
  c,
  busy,
  onAdd,
  onOpen,
}: {
  c: ContactRecord;
  busy: boolean;
  onAdd: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button type="button" aria-label={`查看${c.name}`} onClick={onOpen} className="rounded-full active:opacity-80">
        <QqAvatar src={c.avatar} alt={c.name} size={56} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[16px] font-medium">{c.name}</span>
        </div>
        {(c.age || c.region) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {c.age && (
              <span className="rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-black/50 dark:bg-white/[0.08] dark:text-white/50">
                {c.gender === '男' ? '♂' : c.gender === '女' ? '♀' : ''}
                {c.age}岁
              </span>
            )}
            {c.region && (
              <span className="rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-black/50 dark:bg-white/[0.08] dark:text-white/50">
                {c.region}
              </span>
            )}
          </div>
        )}
        <div className="mt-0.5 truncate text-[12px] text-black/35 dark:text-white/35">有共同好友</div>
      </div>
      <button
        type="button"
        data-testid={`qq-add-btn-${c.id}`}
        disabled={busy}
        onClick={onAdd}
        className="h-10 shrink-0 rounded-full border border-black/15 px-6 text-[15px] text-black/70 active:bg-black/5 disabled:opacity-50 dark:border-white/25 dark:text-white/70"
      >
        添加
      </button>
    </div>
  );
}

export function AddFriendPage({
  me,
  contacts,
  onBack,
  onOpenApply,
  onOpenReqDetail,
  onOpenChat,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  onBack: () => void;
  /** 推荐位点「添加」→ 申请添加朋友页（验证信息/备注/分组/权限） */
  onOpenApply: (c: ContactRecord) => void;
  /** 搜索结果点人（非好友）→ 好友申请详情页（资料预览）→ 前往验证 → 申请添加朋友页 */
  onOpenReqDetail: (c: ContactRecord) => void;
  onOpenChat: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  const [kw, setKw] = useState('');
  const [tab, setTab] = useState<'找人' | '找群'>('找人');

  // 推荐：未加 QQ 好友的人（char/npc，排除自己；QQ 好友独立，微信/信息里加过的不算）
  const suggestions = useMemo(() => contacts.filter((c) => !isFriendIn(c, 'qq') && c.id !== me.id).slice(0, 8), [contacts, me.id]);
  // 搜索：仅按 QQ 号匹配（输入 QQ 号才出现联系人）
  const results = useMemo(() => {
    const k = kw.trim();
    if (!k) return null;
    return contacts.filter((c) => c.id !== me.id && (c.qqId ?? '').includes(k));
  }, [contacts, kw, me.id]);

  // 七宫格（对照 QQ 真机添加好友页：第一行 4 个 + 第二行 3 个）
  const gridTop: { label: string; icon: React.ReactNode }[] = [
    { label: '手机联系人', icon: <Smartphone className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '扫一扫', icon: <QrCode className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '面对面添加', icon: <Radio className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '条件查找', icon: <Search className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
  ];
  const gridBottom: { label: string; icon: React.ReactNode }[] = [
    { label: '面对面建群', icon: <Plus className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '附近的人', icon: <MapPin className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { label: '结伴交友', icon: <Users className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
  ];
  const gridBtn = (g: { label: string; icon: React.ReactNode }) => (
    <button
      key={g.label}
      type="button"
      onClick={() => (g.label === '扫一扫' ? openScan('qq') : onToast(`${g.label}暂未开放`))}
      className="flex w-full flex-col items-center gap-2 py-2.5 text-black/85 active:opacity-60 dark:text-white/85"
    >
      {g.icon}
      <span className="text-[13px]">{g.label}</span>
    </button>
  );

  const resultRows = (list: ContactRecord[]) =>
    list.map((c) =>
      isFriendIn(c, 'qq') ? (
        <button
          key={c.id}
          type="button"
          onClick={() => onOpenChat(c)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
        >
          <QqAvatar src={c.avatar} alt={c.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-medium">{c.name}</div>
            <div className="mt-0.5 text-[12px] text-black/35 dark:text-white/35">{c.qqId ? `QQ:${c.qqId}` : '已是好友'}</div>
          </div>
          <span
            className="h-9 shrink-0 rounded-full px-5 text-[14px] font-medium leading-9 text-white"
            style={{ backgroundColor: QQ_BLUE }}
          >
            发消息
          </span>
        </button>
      ) : (
        <button
          key={c.id}
          type="button"
          data-testid={`qq-add-result-${c.name}`}
          onClick={() => onOpenReqDetail(c)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
        >
          <QqAvatar src={c.avatar} alt={c.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-medium">{c.name}</div>
            <div className="mt-0.5 text-[12px] text-black/35 dark:text-white/35">{c.qqId ? `QQ:${c.qqId}` : '点击查看资料并发送好友申请'}</div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
      ),
    );

  return (
    <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 + 找人/找群 分段（对照 QQ 真机添加好友页） */}
      <div className="relative flex h-12 shrink-0 items-center px-3">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <div
          className="absolute left-1/2 flex -translate-x-1/2 items-center rounded-full bg-black/[0.05] p-[3px] dark:bg-white/[0.08]"
          role="tablist"
          aria-label="找人找群"
        >
          {(['找人', '找群'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              data-testid={`qq-addfriend-tab-${t}`}
              onClick={() => setTab(t)}
              className={`h-8 rounded-full px-6 text-[15px] ${
                tab === t
                  ? 'bg-white font-medium text-black shadow-[0_1px_4px_rgba(0,0,0,0.1)] dark:bg-[#3A3C42] dark:text-white'
                  : 'text-black/60 dark:text-white/60'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 搜索：仅输入 QQ 号才出现联系人（placeholder 居中对照真机） */}
      <div className="px-4 pb-3 pt-2">
        <div className="relative flex h-[42px] items-center rounded-[12px] bg-[#F2F3F5] px-3.5 dark:bg-white/[0.08]">
          <input
            data-testid="qq-addfriend-search"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="QQ号/QID/手机号/群"
            aria-label="QQ号/QID/手机号/群"
            autoCapitalize="off"
            autoCorrect="off"
            className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-transparent dark:placeholder:text-transparent"
          />
          {!kw && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-[15px] text-black/30 dark:text-white/30">
              <Search className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
              QQ号/QID/手机号/群
            </span>
          )}
          {kw && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setKw('')}
              className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/20 text-white dark:bg-white/25"
            >
              <X className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" data-testid="qq-addfriend-body">
        {tab === '找群' ? (
          kw.trim() ? (
            <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">未找到相关的群</p>
          ) : (
            <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">暂无群推荐</p>
          )
        ) : results ? (
          results.length === 0 ? (
            <p className="mt-14 text-center text-[13px] text-black/30 dark:text-white/30">未找到相关的人</p>
          ) : (
            <>
              <p className="px-4 pb-1 pt-3 text-[13px] text-black/35 dark:text-white/35">找到 {results.length} 人</p>
              {resultRows(results)}
            </>
          )
        ) : (
          <>
            {/* 七宫格：第一行 4 个 + 第二行 3 个（与第一行前三列对齐，对照真机） */}
            <div className="grid grid-cols-4 px-1 pb-1 pt-4">{gridTop.map(gridBtn)}</div>
            <div className="grid grid-cols-4 px-1 pb-4">{gridBottom.map(gridBtn)}</div>

            {/* 可能想认识的人 */}
            <div className="flex items-center justify-between border-b border-black/[0.05] px-4 pb-2 pt-3 dark:border-white/[0.06]">
              <span className="text-[17px] font-semibold">可能想认识的人</span>
              <button
                type="button"
                onClick={() => onToast('查看更多暂未开放')}
                className="flex items-center text-[13px] text-black/40 active:opacity-60 dark:text-white/40"
              >
                查看更多
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {suggestions.length === 0 && (
              <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂时没有推荐，去「联系人」App 添加人物吧</p>
            )}
            {suggestions.map((c) => (
              <AddPersonRow key={c.id} c={c} busy={false} onAdd={() => onOpenApply(c)} onOpen={() => onOpenChat(c)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- 申请添加朋友页（QQ 风格：验证信息/对方备注/分组/权限 → 发送） ----------------

export function ApplyFriendPage({
  me,
  target,
  onBack,
  onSend,
  onToast,
}: {
  me: QQUser;
  /** 要添加的联系人（搜索/推荐结果） */
  target: ContactRecord;
  onBack: () => void;
  /** 发送申请：宿主加好友 + 写「好友通知」+ 恢复被删状态 */
  onSend: (payload: { greeting: string; extras: FriendReqExtras }) => void;
  onToast: (m: string) => void;
}) {
  // 招呼语会进对方 AI 的上下文：恒用真名（用户规则：AI 永不知道机主昵称）
  const [greeting, setGreeting] = useState(`我是${me.realName || me.name}`);
  const [remark, setRemark] = useState('');
  const [hideMine, setHideMine] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：取消 + 添加好友 */}
      <div className="relative flex h-12 shrink-0 items-center px-3">
        <button type="button" aria-label="取消" data-testid="qq-apply-close" onClick={onBack} className="-ml-1 rounded-full p-1.5 text-[16px] active:bg-black/5 dark:text-white/85">
          取消
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">添加好友</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4" data-testid="qq-apply-body">
        {/* 对方信息 */}
        <div className="flex items-center gap-3 py-4">
          <QqAvatar src={target.avatar} alt={target.name} size={64} />
          <span className="min-w-0 truncate text-[19px] font-semibold">{target.name}</span>
        </div>

        <p className="pb-2 text-[13px] text-black/40 dark:text-white/40">填写验证信息</p>
        <div className="rounded-[12px] bg-[#F2F3F5] px-3.5 dark:bg-white/[0.08]">
          <input
            value={greeting}
            onChange={(e) => setGreeting(e.target.value.slice(0, 100))}
            data-testid="qq-apply-greeting"
            className="h-[46px] w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
          />
        </div>

        <p className="pb-2 pt-4 text-[13px] text-black/40 dark:text-white/40">设置对方备注</p>
        <div className="rounded-[12px] bg-[#F2F3F5] px-3.5 dark:bg-white/[0.08]">
          <input
            value={remark}
            onChange={(e) => setRemark(e.target.value.slice(0, 30))}
            placeholder="输入备注"
            data-testid="qq-apply-remark"
            className="h-[46px] w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
          />
        </div>

        <p className="pb-2 pt-4 text-[13px] text-black/40 dark:text-white/40">分组设置</p>
        <button
          type="button"
          onClick={() => onToast('分组暂未开放')}
          className="flex h-[46px] w-full items-center justify-between rounded-[12px] bg-[#F2F3F5] px-3.5 active:opacity-70 dark:bg-white/[0.08]"
        >
          <span className="text-[15px]">我的好友</span>
          <ChevronRight className="h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        <p className="pb-2 pt-4 text-[13px] text-black/40 dark:text-white/40">权限设置</p>
        <div className="flex h-[46px] items-center justify-between rounded-[12px] bg-[#F2F3F5] px-3.5 dark:bg-white/[0.08]">
          <span className="text-[15px]">不让他看我的动态</span>
          <ChatToggle on={hideMine} onChange={setHideMine} accent="#0099FF" testId="qq-apply-hide-mine" label="不让他看我的动态" />
        </div>

        <button
          type="button"
          data-testid="qq-apply-send"
          disabled={busy}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            onSend({
              greeting: greeting.trim() || `我是${me.realName || me.name}`,
              extras: { remark: remark.trim() || null, hideMine },
            });
          }}
          className="mb-8 mt-10 h-12 w-full rounded-full text-[16px] font-medium text-white active:brightness-95 disabled:opacity-60"
          style={{ backgroundColor: QQ_BLUE }}
        >
          发送
        </button>
      </div>
    </div>
  );
}

// ---------------- 新朋友页（联系人页「新朋友」进入；右上「添加」→ 添加好友页） ----------------

export function NewFriendsPage({
  me,
  contacts,
  reqs,
  onBack,
  onOpenAdd,
  onOpenChat,
  onOpenApply,
  onOpenReq,
  onAccept,
  onToast,
}: {
  me: QQUser;
  contacts: ContactRecord[];
  /** 好友通知列表（friend-state 落盘；AI 加回申请/手动添加共用） */
  reqs: FriendReqEntry[];
  onBack: () => void;
  onOpenAdd: () => void;
  onOpenChat: (c: ContactRecord) => void;
  /** 推荐位点「添加」→ 申请添加朋友页 */
  onOpenApply: (c: ContactRecord) => void;
  /** 点通知行 → 好友申请详情页 */
  onOpenReq: (r: FriendReqEntry) => void;
  /** 直接同意（列表内「同意」按钮） */
  onAccept: (r: FriendReqEntry) => void;
  onToast: (m: string) => void;
}) {
  const [showSync, setShowSync] = useState(true);

  // 推荐：未加 QQ 好友的人（char/npc，排除自己；QQ 好友独立，微信/信息里加过的不算）
  const suggestions = useMemo(() => contacts.filter((c) => !isFriendIn(c, 'qq') && c.id !== me.id).slice(0, 8), [contacts, me.id]);

  return (
    <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 + 新朋友 + 添加 */}
      <div className="relative flex h-12 shrink-0 items-center px-3">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">新朋友</span>
        <button
          type="button"
          data-testid="qq-newfriends-add"
          onClick={onOpenAdd}
          className="ml-auto text-[16px] text-black/75 active:opacity-60 dark:text-white/75"
        >
          添加
        </button>
      </div>

      <div className="flex-1 overflow-y-auto" data-testid="qq-newfriends-body">
        {/* 同步通讯录横幅 */}
        {showSync && (
          <div className="flex h-[58px] items-center gap-3 border-b border-black/[0.05] px-4 dark:border-white/[0.06]">
            <span className="flex-1 text-[16px]">开启通讯录，快速找到好友</span>
            <button
              type="button"
              data-testid="qq-newfriends-sync"
              onClick={() => onToast('通讯录同步已启用')}
              className="h-9 shrink-0 rounded-full px-5 text-[15px] font-medium text-white active:brightness-95"
              style={{ backgroundColor: QQ_BLUE }}
            >
              启用
            </button>
            <button
              type="button"
              aria-label="关闭同步通讯录"
              data-testid="qq-newfriends-sync-close"
              onClick={() => setShowSync(false)}
              className="shrink-0 rounded-full p-1.5 text-black/35 active:bg-black/5 dark:text-white/35"
            >
              <X className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="h-2.5 bg-black/[0.035] dark:bg-white/[0.05]" aria-hidden="true" />

        {/* 好友通知（AI 加回申请 / 手动添加记录）：待处理可同意，点行进详情 */}
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <span className="text-[17px] font-semibold">好友通知</span>
          <button type="button" onClick={() => onToast('过滤通知暂未开放')} className="flex items-center text-[13px] text-black/40 active:opacity-60 dark:text-white/40">
            过滤通知
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {reqs.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-black/30 dark:text-white/30" data-testid="qq-newfriends-empty">
            暂无好友通知，去「添加」认识新朋友吧
          </p>
        ) : (
          <div className="pb-2">
            {reqs.map((r) => {
              const status = r.status ?? 'accepted';
              return (
                <button
                  type="button"
                  key={`${r.id}-${r.time}`}
                  data-testid={`qq-req-${r.name}`}
                  onClick={() => onOpenReq(r)}
                  className="flex w-full items-center gap-3 border-b border-black/[0.05] px-4 py-3 text-left active:bg-black/[0.03] dark:border-white/[0.06] dark:active:bg-white/[0.05]"
                >
                  <QqAvatar src={r.avatar} alt={r.name} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-medium">{r.name}</p>
                    <p className="mt-0.5 truncate text-[13.5px] text-black/60 dark:text-white/60">{r.message}</p>
                    <p className="mt-0.5 truncate text-[12.5px] text-black/35 dark:text-white/35">来源：{r.source || '好友验证消息'}</p>
                  </div>
                  {status === 'pending' ? (
                    r.fromChar ? (
                      <span
                        role="button"
                        tabIndex={0}
                        data-testid={`qq-req-accept-${r.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAccept(r);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            onAccept(r);
                          }
                        }}
                        className="shrink-0 rounded-[6px] border border-black/15 px-4 py-1.5 text-[14px] active:bg-black/5 dark:border-white/25"
                      >
                        同意
                      </span>
                    ) : (
                      // 小号发起、等待 AI 决策的申请：无「同意」按钮（决策在对方手里）
                      <span
                        className="shrink-0 text-[13.5px] text-black/35 dark:text-white/35"
                        data-testid={`qq-req-waiting-${r.name}`}
                      >
                        等待验证
                      </span>
                    )
                  ) : (
                    <span className="shrink-0 text-[13.5px] text-black/35 dark:text-white/35" data-testid={`qq-req-status-${r.name}`}>
                      {status === 'rejected' ? '已拒绝' : '已同意'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="h-2.5 bg-black/[0.035] dark:bg-white/[0.05]" aria-hidden="true" />

        {/* 可能想认识的人 */}
        <div className="flex items-center justify-between border-b border-black/[0.05] px-4 pb-2 pt-3 dark:border-white/[0.06]">
          <span className="text-[17px] font-semibold">可能想认识的人</span>
          <button
            type="button"
            onClick={() => onToast('查看更多暂未开放')}
            className="flex items-center text-[13px] text-black/40 active:opacity-60 dark:text-white/40"
          >
            查看更多
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {suggestions.length === 0 && (
          <p className="mt-10 text-center text-[13px] text-black/30 dark:text-white/30">暂时没有推荐，去「联系人」App 添加人物吧</p>
        )}
        {suggestions.map((c) => (
          <AddPersonRow key={c.id} c={c} busy={false} onAdd={() => onOpenApply(c)} onOpen={() => onOpenChat(c)} />
        ))}
      </div>
    </div>
  );
}

// ---------------- 好友申请详情页（QQ 风格：对方留言/来源/同意/设为黑名单） ----------------

export function FriendReqDetailPage({
  req,
  contact,
  onBack,
  onAccept,
  onReject,
  onBlock,
  onVerify,
  onToast,
}: {
  /** 好友申请（null = 搜索结果资料预览：还没有申请，走「前往验证」发申请） */
  req: FriendReqEntry | null;
  /** 申请对应的联系人（被彻底删除时为 null：展示快照，同意按钮置灰） */
  contact: ContactRecord | null;
  onBack: () => void;
  /** 同意申请：宿主恢复好友关系 + 状态流转 + 刷新 */
  onAccept: (r: FriendReqEntry) => void;
  /** 拒绝申请：AI 停止再申请 */
  onReject: (r: FriendReqEntry) => void;
  /** 设为黑名单 */
  onBlock: (r: FriendReqEntry | ContactRecord) => void;
  /** 资料预览模式「前往验证」：进申请添加朋友页 */
  onVerify: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  const status = req?.status ?? 'accepted';
  const pending = req != null && status === 'pending';
  const peerName = req?.name ?? (contact ? displayNameOf(contact) : '对方');

  // 验证消息线程：旧数据（无 thread）由单条 message 起始展开；资料预览模式无卡片区
  const thread: FriendReqThreadMsg[] =
    req?.thread && req.thread.length > 0
      ? req.thread
      : req && req.message.trim()
        ? [{ who: req.fromChar ? 'peer' : 'me', text: req.message, time: req.time }]
        : [];

  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);

  const canReply = req != null && contact != null;
  const sendReply = async () => {
    const text = replyText.trim();
    if (!text || !req || replyBusy) return;
    const msg: FriendReqThreadMsg = { who: 'me', text, time: Date.now() };
    appendReqThread('qq', req.id, msg);
    setReplyText('');
    setReplyOpen(false);
    if (contact && (contact.persona ?? '').trim()) {
      setReplyBusy(true);
      try {
        if (shouldUseAltDecisionFlow('qq', req)) {
          // 小号发起的申请：每条回复都触发 AI 重新决策（同意/拒绝/先回复，按人设随时可以同意）
          await processAltFriendReq('qq', req.id, contact.id);
        } else {
          const reply = await genCharThreadReply('qq', contact, [...thread, msg], 'reply');
          if (reply) appendReqThread('qq', req.id, { who: 'peer', text: reply, time: Date.now() });
        }
      } catch {
        // 生成失败静默：用户消息已在线程里
      } finally {
        setReplyBusy(false);
      }
    }
  };

  return (
    <div className="flex h-full flex-col bg-white pt-[54px] dark:bg-[#111214]">
      {/* 顶栏：返回 + 好友申请 */}
      <div className="relative flex h-12 shrink-0 items-center px-3">
        <button type="button" aria-label="返回" data-testid="qq-reqdetail-back" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">好友申请</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4" data-testid="qq-reqdetail-body">
        {/* 申请人卡片（头像 + 名字/QQ号） */}
        <div className="flex w-full items-center gap-3 py-4">
          <QqAvatar src={req?.avatar ?? contact?.avatar ?? null} alt={peerName} size={64} />
          <span className="min-w-0 flex-1 truncate text-[19px] font-semibold">
            {peerName}
            {contact?.qqId ? `（${contact.qqId}）` : ''}
          </span>
        </div>

        {/* 验证消息线程（我/对方 多轮对话 + 回复） */}
        {thread.length > 0 && (
          <>
            <p className="pb-2 text-[13px] text-black/40 dark:text-white/40">验证消息</p>
            <div className="rounded-[12px] bg-[#F2F3F5] px-3.5 py-3.5 dark:bg-white/[0.08]" data-testid="qq-reqdetail-thread">
              {thread.map((m, i) => (
                <p key={`${m.time}-${i}`} className="break-words text-[15px] leading-[1.8]">
                  {m.who === 'me' ? '我: ' : `${peerName}: `}
                  {m.text}
                </p>
              ))}
              {replyBusy ? (
                <p className="mt-1 text-[14.5px] text-black/35 dark:text-white/35" data-testid="qq-reqdetail-reply-busy">
                  对方正在回复…
                </p>
              ) : canReply ? (
                replyOpen ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value.slice(0, 60))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void sendReply();
                        }
                      }}
                      placeholder={`回复 ${peerName}`}
                      autoFocus
                      data-testid="qq-reqdetail-reply-input"
                      className="h-9 min-w-0 flex-1 rounded-[8px] bg-white px-3 text-[14.5px] outline-none placeholder:text-black/30 dark:bg-white/10 dark:placeholder:text-white/30"
                    />
                    <button
                      type="button"
                      data-testid="qq-reqdetail-reply-send"
                      onClick={() => void sendReply()}
                      className="h-9 shrink-0 rounded-full px-4 text-[14px] font-medium text-white active:brightness-95"
                      style={{ backgroundColor: QQ_BLUE }}
                    >
                      发送
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="qq-reqdetail-reply"
                    onClick={() => setReplyOpen(true)}
                    className="mt-1 block text-[14.5px] active:opacity-60"
                    style={{ color: QQ_BLUE }}
                  >
                    回复
                  </button>
                )
              ) : null}
            </div>
          </>
        )}

        <p className="pb-2 pt-4 text-[13px] text-black/40 dark:text-white/40">来源</p>
        <div className="rounded-[12px] bg-[#F2F3F5] px-3.5 py-3.5 text-[15px] dark:bg-white/[0.08]">
          <span data-testid="qq-reqdetail-source">{req?.source || (req ? '好友验证消息' : SOURCE_SEARCH_QQ)}</span>
          {!req && contact && (
            <span className="ml-3 text-black/40 dark:text-white/40">
              {contact.qqId ? `QQ:${contact.qqId}` : contact.phone ? `手机:${contact.phone}` : ''}
            </span>
          )}
        </div>

        {/* 同意 / 拒绝 / 前往验证 / 状态 */}
        {req == null ? (
          <button
            type="button"
            data-testid="qq-reqdetail-accept"
            onClick={() => contact && onVerify(contact)}
            disabled={!contact}
            className="mb-6 mt-8 h-12 w-full rounded-full text-[16px] font-medium text-white active:brightness-95 disabled:opacity-50"
            style={{ backgroundColor: QQ_BLUE }}
          >
            前往验证
          </button>
        ) : pending ? (
          req.fromChar ? (
            <div className="mb-6 mt-8 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => onAccept(req)}
                disabled={!contact}
                className="h-12 w-full rounded-full text-[16px] font-medium text-white active:brightness-95 disabled:opacity-50"
                style={{ backgroundColor: QQ_BLUE }}
              >
                同意
              </button>
              <button
                type="button"
                data-testid="qq-reqdetail-reject"
                onClick={() => onReject(req)}
                className="h-12 w-full rounded-full bg-black/[0.05] text-[16px] text-red-500 active:opacity-70 dark:bg-white/[0.08]"
              >
                拒绝
              </button>
            </div>
          ) : (
            // 小号发起、等待 AI 决策的申请：无同意/拒绝按钮（决策在对方手里），可继续回复验证消息
            <p
              className="mb-6 mt-8 text-center text-[15px] text-black/35 dark:text-white/35"
              data-testid="qq-reqdetail-waiting"
            >
              等待对方验证
            </p>
          )
        ) : (
          <p className="mt-8 text-center text-[15px] text-black/35 dark:text-white/35" data-testid="qq-reqdetail-done">
            {status === 'rejected' ? '已拒绝该申请' : '已同意'}
          </p>
        )}
      </div>

      {/* 底部：设为黑名单 | 举报用户 */}
      <div className="flex shrink-0 items-center justify-center gap-4 pb-[30px] pt-3">
        <button
          type="button"
          data-testid="qq-reqdetail-block"
          onClick={() => (req ? onBlock(req) : contact ? onBlock(contact) : undefined)}
          className="text-[15px] active:opacity-60"
          style={{ color: QQ_BLUE }}
        >
          设为黑名单
        </button>
        <span className="h-4 w-px bg-black/15 dark:bg-white/20" aria-hidden="true" />
        <button type="button" onClick={() => onToast('举报暂未开放')} className="text-[15px] active:opacity-60" style={{ color: QQ_BLUE }}>
          举报用户
        </button>
      </div>
    </div>
  );
}


// ---------------- 设置页 / 账号与安全页 ----------------

export function SettingsPage({
  me,
  onBack,
  onOpenSecurity,
  onOpenDress,
  onLogout,
  onToast,
}: {
  me: QQUser;
  onBack: () => void;
  onOpenSecurity: () => void;
  /** 个性装扮与特权外显 → 主题界面（毛玻璃胶囊：主题/气泡两个选择） */
  onOpenDress: () => void;
  onLogout: () => void;
  onToast: (m: string) => void;
}) {
  // Task 30 头像双击动作：拍一拍文案编辑（QQ 侧独立于微信；按账号隔离存储）
  const [clapOpen, setClapOpen] = useState(false);
  const [clapDraft, setClapDraft] = useState('');
  const [clapText, setClapText] = useState<string>(() => readQqClapText());
  const openClap = () => {
    setClapDraft(clapText);
    setClapOpen(true);
  };
  const saveClap = () => {
    setClapOpen(false);
    const t = clapDraft.trim();
    writeQqClapText(t);
    setClapText(t);
    onToast('拍一拍已保存');
  };
  const clapShown = clapText ? `拍了拍${clapText}` : '未设置';
  const rows: { icon: React.ReactNode; color: string; label: string; hint?: string; onClick?: () => void; testid?: string }[] = [
    { icon: <Bell className="h-5 w-5" strokeWidth={1.9} />, color: '#3BA0FF', label: '消息通知', onClick: () => onToast('消息通知暂未开放') },
    { icon: <SlidersHorizontal className="h-5 w-5" strokeWidth={1.9} />, color: '#3BA0FF', label: '模式选择', hint: '普通模式', onClick: () => onToast('模式选择暂未开放') },
    { icon: <Shirt className="h-5 w-5" strokeWidth={1.9} />, color: '#F0479C', label: '个性装扮与特权外显', onClick: onOpenDress },
    { icon: <Sparkles className="h-5 w-5" strokeWidth={1.9} />, color: '#3BA0FF', label: '头像双击动作', hint: clapShown, onClick: openClap, testid: 'qq-settings-clap' },
    { icon: <Settings className="h-5 w-5" strokeWidth={1.9} />, color: '#3BA0FF', label: '通用', onClick: () => onToast('通用设置暂未开放') },
  ];
  const privacyRows: { icon: React.ReactNode; label: string }[] = [
    { icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />, label: '隐私设置' },
    { icon: <FileText className="h-5 w-5" strokeWidth={1.9} />, label: '个人信息收集清单' },
    { icon: <Link2 className="h-5 w-5" strokeWidth={1.9} />, label: '第三方个人信息共享清单' },
    { icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />, label: '个人信息保护设置' },
  ];

  return (
    <div className="flex h-full flex-col bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      <div className="relative flex h-12 shrink-0 items-center bg-[#F6F7F9] px-3 dark:bg-[#111214]">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">设置</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-[44px] pt-2">
        <QqSearch value="" onChange={() => undefined} />

        {/* 账号与安全 */}
        <button
          type="button"
          data-testid="qq-settings-security"
          onClick={onOpenSecurity}
          className="mt-3 flex h-[60px] w-full items-center gap-3 rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <User className="h-5 w-5 shrink-0 text-black/75 dark:text-white/75" aria-hidden="true" />
          <span className="flex-1 text-[16px]">账号与安全</span>
          <QqAvatar src={me.avatar} alt={me.name} size={30} />
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">功能</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {rows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={r.onClick}
              className={`flex h-[54px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center" style={{ color: r.color }} aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              {r.hint && <span className="text-[14px] text-black/30 dark:text-white/30">{r.hint}</span>}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
          {/* 第三十四轮：「AI 主动消息」全局总开关删除（每角色独立设置入口保留在聊天设置里） */}
        </div>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">隐私</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {privacyRows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={() => onToast(`${r.label}暂未开放`)}
              className={`flex h-[54px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center text-black/75 dark:text-white/75" aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onToast('关于QQ暂未开放')}
          className="mt-4 flex h-[54px] w-full items-center gap-3 rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <Info className="h-5 w-5 shrink-0 text-black/75 dark:text-white/75" aria-hidden="true" />
          <span className="flex-1 text-[16px]">关于QQ与帮助</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        <button
          type="button"
          data-testid="qq-settings-logout"
          onClick={onLogout}
          className="mt-4 flex h-[54px] w-full items-center gap-3 rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <LogOut className="h-5 w-5 shrink-0 text-black/75 dark:text-white/75" aria-hidden="true" />
          <span className="flex-1 text-[16px]">退出当前账号</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>
      </div>

      {/* 头像双击动作设置弹窗（Task 30）：编辑拍一拍文案——好友双击我的头像拍一拍时会显示这个后缀 */}
      {clapOpen && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 px-8" data-testid="qq-clap-edit-layer" onClick={() => setClapOpen(false)}>
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#2A2C31]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pb-1 pt-4 text-center text-[16px] font-medium">头像双击动作</p>
            <p className="pb-1 text-center text-[12px] text-black/40 dark:text-white/40">好友双击你的头像拍一拍时会看到「拍了拍+后缀」</p>
            <div className="px-4 pb-3 pt-1">
              <input
                value={clapDraft}
                onChange={(e) => setClapDraft(e.target.value)}
                maxLength={30}
                autoFocus
                data-testid="qq-clap-edit-input"
                placeholder="如：的小脑袋（留空清除）"
                className="w-full rounded-[8px] border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[15px] leading-[1.45] outline-none focus:border-[#0099FF] dark:border-white/15 dark:bg-white/[0.06]"
              />
            </div>
            <div className="flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setClapOpen(false)}
                className="h-11 flex-1 text-[16px] active:bg-black/5 dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="qq-clap-edit-save"
                onClick={saveClap}
                className="h-11 flex-1 text-[16px] font-medium text-[#0099FF] active:bg-black/5 dark:active:bg-white/10"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PenguinMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" style={{ width: size, height: size }} className={className} aria-hidden="true">
      <ellipse cx="20" cy="17" rx="11" ry="12" fill="#2B2B33" />
      <ellipse cx="20" cy="22" rx="7.2" ry="7.6" fill="#fff" />
      <circle cx="15.8" cy="13.5" r="2.6" fill="#fff" />
      <circle cx="24.2" cy="13.5" r="2.6" fill="#fff" />
      <circle cx="16.3" cy="13.9" r="1.15" fill="#20242B" />
      <circle cx="23.7" cy="13.9" r="1.15" fill="#20242B" />
      <path d="M15.5 17.6c1.4 1.5 7.6 1.5 9 0 .9 1.4-1.6 4-4.5 4s-5.4-2.6-4.5-4z" fill="#FFA611" />
      <rect x="13" y="26.5" width="14" height="4" rx="2" fill="#F5455C" />
    </svg>
  );
}

/** 多账号小号/匿名号首字母圆（Task 40-D）：小号暖色系 / 匿名号灰黑系，深色模式降饱和变体 */
export function QqAccountBubble({ name, kind, size = 44 }: { name: string; kind: 'alt' | 'anon'; size?: number }) {
  const first = name.trim().charAt(0) || (kind === 'anon' ? '匿' : '小');
  const letter = /[a-z]/i.test(first) ? first.toUpperCase() : first;
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${
        kind === 'anon'
          ? 'bg-gradient-to-br from-[#A9AEB6] to-[#5C6167] dark:from-[#767B82] dark:to-[#41454B]'
          : 'bg-gradient-to-br from-[#FFB56E] to-[#EE7A4B] dark:from-[#A96B3F] dark:to-[#84502C]'
      }`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {letter}
    </div>
  );
}

/**
 * 可切换账号列表（Task 41）：大号恒在；小号只显示「登录过」的——登录历史标记 或 存量会话
 * （升级兼容：老用户已登录的小号即使还没历史标记也照常显示）；当前账号保底不消失。
 * 匿名号只属于电话/信息，不进 QQ。联系人 App 刚创建、从未登录过的小号不出现在这里，
 * 用「登录小号」登录成功后（markAccountLoginHistory）才出现。
 */
export function readQqSwitchableAccounts(activeId: string): PhoneAccount[] {
  const hist = new Set(accountLoginHistory('qq'));
  return getAccounts().filter((a) => {
    if (a.kind === 'anon') return false;
    if (a.id === MAIN_ACCOUNT_ID) return true;
    if (a.id === activeId) return true;
    if (hist.has(a.id)) return true;
    // 存量兼容：该账号作用域下已有登录会话 = 登录过
    try {
      const key = a.id === MAIN_ACCOUNT_ID ? LS_SESSION : `${LS_SESSION}--${a.id}`;
      return !!window.localStorage.getItem(key);
    } catch {
      return false;
    }
  });
}

/**
 * 抽屉「切换账号」弹出卡片（对照真实 QQ 截图样式）：
 * 白色圆角卡 + 上箭头小三角；每行 头像 + 名字 + 号码，当前账号右侧蓝勾。
 * 匿名号码不在此展示（2025 需求：匿名号只属于电话/信息，与切换账号无关）。
 * 数据口径与 SecurityPage 一致：登录过的账号（登录历史/存量会话/当前保底）+ 档案展示名。
 */
export function QqDrawerAccountCard({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [accounts, setAccounts] = useState<PhoneAccount[]>(() => readQqSwitchableAccounts(getActiveAccountIdFor('qq')));
  const [activeId, setActiveId] = useState<string>(() => getActiveAccountIdFor('qq'));
  /** 「添加账号」弹层：新建大号/小号，创建后直接登录进入 */
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    const refresh = (e: Event) => {
      const detail = (e as CustomEvent<{ app?: string }>).detail;
      if (detail && detail.app !== 'qq') return;
      setAccounts(readQqSwitchableAccounts(getActiveAccountIdFor('qq')));
      setActiveId(getActiveAccountIdFor('qq'));
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, refresh);
  }, []);
  const [mainOwner, setMainOwner] = useState<{ name: string; qqId: string; avatar: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void mainOwnerContact().then((o) => {
      if (alive) setMainOwner(o ? { name: o.name?.trim() ?? '', qqId: o.qqId?.trim() ?? '', avatar: o.avatar } : null);
    });
    return () => {
      alive = false;
    };
  }, []);
  const [profiles, setProfiles] = useState<ContactRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void listContactsFor('qq')
      .then((all) => {
        if (alive) setProfiles(all);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const profileOf = (acc: PhoneAccount): ContactRecord | null =>
    profiles.find((c) => c.kind === 'user' && (c.altOf === acc.id || c.id === acc.ownerContactId)) ?? null;
  const accNameOf = (acc: PhoneAccount): string => {
    if (acc.id === MAIN_ACCOUNT_ID) {
      const mainProfile = profiles.find((c) => c.kind === 'user' && !c.altOf) ?? null;
      return (mainProfile ? socialNameOf(mainProfile) : '') || mainOwner?.name || '机主';
    }
    const profile = profileOf(acc);
    return (profile ? socialNameOf(profile) : '') || acc.name;
  };
  const accNoOf = (acc: PhoneAccount): string =>
    acc.id === MAIN_ACCOUNT_ID ? mainOwner?.qqId || acc.qqId || '' : acc.qqId;

  return (
    <div className="absolute inset-0 z-50" onClick={onClose} data-testid="qq-drawer-acc-card-backdrop">
      <div
        className="absolute left-5 top-[212px] w-[270px] overflow-visible rounded-[10px] bg-white shadow-[0_10px_38px_rgba(0,0,0,0.22)] dark:bg-[#232529]"
        onClick={(e) => e.stopPropagation()}
        data-testid="qq-drawer-acc-card"
      >
        {/* 上箭头小三角（指向抽屉「切换账号」胶囊按钮） */}
        <div aria-hidden="true" className="absolute -top-[6px] left-9 h-3 w-3 rotate-45 rounded-[2px] bg-white dark:bg-[#232529]" />
        <div className="overflow-hidden rounded-[10px]">
          {accounts.map((acc, idx) => {
            const isCurrent = acc.id === activeId;
            const name = accNameOf(acc);
            return (
              <button
                key={acc.id}
                type="button"
                data-testid={`qq-drawer-acc-row-${acc.id}`}
                onClick={isCurrent ? onClose : () => onPick(acc.id)}
                className={`flex h-[64px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                  idx > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.06]' : ''
                }`}
              >
                {(() => {
                  // 第三十二轮：切换账号卡片头像跟随 QQ——每个账号显示自己档案的 QQ 槽位头像（avatars.qq），
                  // 没设过 QQ 头像时：大号回退机主全局头像，小号回退首字母彩色圆
                  const prof = profileOf(acc);
                  const accAvatar = prof?.avatars?.qq ?? (acc.id === MAIN_ACCOUNT_ID ? mainOwner?.avatar ?? null : null);
                  return accAvatar ? (
                    <QqAvatar src={accAvatar} alt={name} size={44} />
                  ) : (
                    <QqAccountBubble name={name} kind="alt" size={44} />
                  );
                })()}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="block truncate text-[16px] font-medium leading-tight">{name}</span>
                    {/* 第三十二轮：「大号/小号」徽标删除——列表里都是可登录的账号，不再分档位 */}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-black/35 dark:text-white/35">{accNoOf(acc)}</span>
                </span>
                {isCurrent && <Check className="h-5 w-5 shrink-0 text-[#1E6FFF] dark:text-[#4AA3FF]" aria-hidden="true" />}
              </button>
            );
          })}
          {/* 添加账号：新建大号/小号（弹层见下），创建后自动登录并出现在列表 */}
          <button
            type="button"
            data-testid="qq-drawer-acc-add"
            onClick={() => setAddOpen(true)}
            className={`flex h-[56px] w-full items-center justify-center gap-1.5 text-[14px] text-black/60 active:bg-black/[0.04] dark:text-white/60 dark:active:bg-white/[0.06] ${
              accounts.length > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.06]' : ''
            }`}
          >
            <span className="grid h-4.5 w-4.5 place-items-center rounded-full bg-[#1E6FFF] text-[12px] leading-none text-white dark:bg-[#4AA3FF]" aria-hidden="true">＋</span>
            添加账号
          </button>
        </div>

        {/* 添加账号弹层：创建成功 → 写 QQ 登录态（会话 + 登录历史）→ 切到新账号（根组件事件驱动重读登录态，全程不刷新） */}
        {addOpen && (
          <AccountAddSheet
            onClose={() => setAddOpen(false)}
            onCreated={(acc, rec) => {
              setAddOpen(false);
              try {
                markAccountLoginHistory('qq', acc.id);
                clearForceLoginWall('qq');
                // 先切作用域再写会话：accLs 按当前账号现算，切换后写入的是新账号作用域的会话键
                switchAccountFor('qq', acc.id);
                window.localStorage.setItem(accLs(LS_SESSION, 'qq'), rec.id);
              } catch {
                // 存储异常忽略
              }
              onPick(acc.id);
            }}
          />
        )}
      </div>
    </div>
  );
}

export function SecurityPage({
  me,
  onBack,
  onToast,
  onLoginOther,
}: {
  me: QQUser;
  onBack: () => void;
  onToast: (m: string) => void;
  /** 「登录小号」自由登录成功 → 根组件 handleLogin（切作用域 + 记登录历史，Task 41） */
  onLoginOther: (u: QQUser) => void;
}) {
  // 多账号 v2（Task 40-2b）：账号管理区改读注册表（大号 + 小号；匿名号只属于电话/信息，不进 QQ）。
  // 切换账号不再整页刷新（switchAccountFor 事件驱动）→ 账号快照入组件 state 并订阅事件刷新（当前行蓝勾实时移动）
  // 多账号 Task 41：只显示「登录过」的小号（登录历史 / 存量会话兼容 / 当前账号保底）——
  // 联系人 App 刚创建、从未登录过的小号不进列表，用下方「登录小号」登录后才出现。
  const [accounts, setAccounts] = useState<PhoneAccount[]>(() => readQqSwitchableAccounts(getActiveAccountIdFor('qq')));
  const [activeId, setActiveId] = useState<string>(() => getActiveAccountIdFor('qq'));
  useEffect(() => {
    const refresh = (e: Event) => {
      const detail = (e as CustomEvent<{ app?: string }>).detail;
      if (detail && detail.app !== 'qq') return; // 其他 App 的账号切换与 QQ 账号列表无关
      setAccounts(readQqSwitchableAccounts(getActiveAccountIdFor('qq')));
      setActiveId(getActiveAccountIdFor('qq'));
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, refresh);
  }, []);
  /** 「登录小号」自由登录墙（覆盖全页；slot=null 不绑定槽位，用任意小号账密登录） */
  const [loginOpen, setLoginOpen] = useState(false);
  // 大号行显示资料（单库直读大号机主联系人 mainOwnerContact；Task 40-F 修正）:
  // 不能用 me（登录用户）——在小号视角下 me 是小号的登录身份，会把大号行显示成小号资料
  const [mainOwner, setMainOwner] = useState<{ name: string; qqId: string; avatar: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void mainOwnerContact().then((o) => {
      if (alive) setMainOwner(o ? { name: o.name?.trim() ?? '', qqId: o.qqId?.trim() ?? '', avatar: o.avatar } : null);
    });
    return () => {
      alive = false;
    };
  }, []);
  // 账号显示名（Task 40-S）：与登录后 App 内展示口径一致——档案联系人展示名（备注>昵称>名字）优先，
  // 注册表名兼底。否则小号设了昵称后「切换账号页的名字和登录后的名字对不上」。
  const [profiles, setProfiles] = useState<ContactRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void listContactsFor('qq')
      .then((all) => {
        if (alive) setProfiles(all);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const profileOf = (acc: PhoneAccount): ContactRecord | null =>
    profiles.find((c) => c.kind === 'user' && (c.altOf === acc.id || c.id === acc.ownerContactId)) ?? null;
  const accNameOf = (acc: PhoneAccount): string => {
    if (acc.id === MAIN_ACCOUNT_ID) {
      const mainProfile = profiles.find((c) => c.kind === 'user' && !c.altOf) ?? null;
      return (mainProfile ? socialNameOf(mainProfile) : '') || mainOwner?.name || '机主';
    }
    const profile = profileOf(acc);
    return (profile ? socialNameOf(profile) : '') || acc.name;
  };
  const accNoOf = (acc: PhoneAccount): string =>
    acc.id === MAIN_ACCOUNT_ID
      ? mainOwner?.qqId || acc.qqId || ''
      : acc.kind === 'anon'
        ? acc.phone
        : acc.qqId;

  const linkRows: { icon: React.ReactNode; label: string; hint?: string; tail?: React.ReactNode }[] = [
    { icon: <PenguinMark size={22} className="text-[#3BA0FF]" />, label: '关联QQ号', tail: <QqAvatar src={me.avatar} alt={me.name} size={30} /> },
    { icon: <QrCode className="h-5 w-5" strokeWidth={1.9} />, label: 'QID', hint: '已开启' },
    { icon: <Smartphone className="h-5 w-5" strokeWidth={1.9} />, label: '手机号', hint: maskPhone(me.phone) },
    { icon: <Link2 className="h-5 w-5" strokeWidth={1.9} />, label: '账号绑定与授权管理' },
  ];
  const safeRows: { icon: React.ReactNode; label: string; hint?: string }[] = [
    { icon: <KeyRound className="h-5 w-5" strokeWidth={1.9} />, label: '修改密码' },
    { icon: <MonitorSmartphone className="h-5 w-5" strokeWidth={1.9} />, label: '登录设备管理' },
    { icon: <LockKeyhole className="h-5 w-5" strokeWidth={1.9} />, label: '手势解锁', hint: '未设置' },
    { icon: <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />, label: '更多安全设置' },
  ];

  return (
    <div className="relative flex h-full flex-col bg-[#F6F7F9] pt-[54px] dark:bg-[#111214]">
      <div className="relative flex h-12 shrink-0 items-center bg-[#F6F7F9] px-3 dark:bg-[#111214]">
        <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-[17px] font-medium">账号与安全</span>
        <button type="button" className="ml-auto text-[16px] text-black/70 active:opacity-60 dark:text-white/70" onClick={() => onToast('编辑暂未开放')}>
          编辑
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-[44px] pt-2">
        {/* 关联账号横幅 */}
        <button
          type="button"
          onClick={() => onToast('关联账号暂未开放')}
          className="flex w-full items-center gap-3 rounded-[14px] bg-white px-4 py-3.5 text-left active:bg-black/[0.03] dark:bg-[#1B1C1F]"
        >
          <PenguinMark size={26} className="shrink-0" />
          <span className="flex-1 text-[14px] leading-snug">点击添加关联账号，同时接收多个账号消息。</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
        </button>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">账号管理</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]" data-testid="qq-security-accounts">
          {/* 注册表账号列表：当前账号蓝勾；点其他账号 → switchAccountFor('qq', id)（事件驱动不刷新，快照经事件订阅刷新） */}
          {accounts.map((acc, idx) => {
            const isCurrent = acc.id === activeId;
            const name = accNameOf(acc);
            return (
              <button
                key={acc.id}
                type="button"
                data-testid={`qq-account-row-${acc.id}`}
                onClick={isCurrent ? undefined : () => switchAccountFor('qq', acc.id)}
                className={`flex h-[64px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                  idx > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
                }`}
              >
                {acc.id === MAIN_ACCOUNT_ID ? (
                  <QqAvatar src={mainOwner?.avatar ?? null} alt={name} size={44} />
                ) : (
                  <QqAccountBubble name={name} kind={acc.kind === 'anon' ? 'anon' : 'alt'} size={44} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-medium">{name}</div>
                  <div className="truncate text-[13px] text-black/35 dark:text-white/35">{accNoOf(acc)}</div>
                </div>
                {isCurrent ? (
                  <Check className="h-5 w-5 shrink-0 text-[#1E6FFF] dark:text-[#4AA3FF]" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
                )}
              </button>
            );
          })}

          {/* 登录小号入口（Task 41）：小号统一在联系人 App 「小号」tab 创建；创建后不直接出现在列表，
              在这里用小号账密登录成功后才出现（登录历史），登录过的小号切换不再需要登录 */}
          <button
            type="button"
            data-testid="qq-account-login-alt"
            onClick={() => setLoginOpen(true)}
            className="flex h-[64px] w-full items-center gap-3 border-t border-black/[0.04] px-4 text-left active:bg-black/[0.03] dark:border-white/[0.05] dark:active:bg-white/[0.06]"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/[0.05] text-black/30 dark:bg-white/[0.08] dark:text-white/30">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] text-black/45 dark:text-white/45">登录小号</span>
              <span className="mt-0.5 block truncate text-[12px] text-black/25 dark:text-white/25">新建小号：打开联系人 App → 「小号」；登录后出现在上面的列表</span>
            </span>
          </button>
        </div>
        <p className="px-1 pt-2 text-[12px] leading-snug text-black/30 dark:text-white/30">切换仅作用于 QQ，不影响微信 / 信息 / 电话的账号；在联系人 App 删除小号后，正在使用它的 App 会自动退出该账号。</p>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">账号关联</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {linkRows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={() => onToast(`${r.label}暂未开放`)}
              className={`flex h-[56px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center text-black/75 dark:text-white/75" aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              {r.hint && <span className="text-[14px] text-black/30 dark:text-white/30">{r.hint}</span>}
              {r.tail ?? null}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>

        <p className="px-1 pb-1.5 pt-5 text-[13px] text-black/35 dark:text-white/35">安全管理</p>
        <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#1B1C1F]">
          {safeRows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={() => onToast(`${r.label}暂未开放`)}
              className={`flex h-[56px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.03] ${
                i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.05]' : ''
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center text-black/75 dark:text-white/75" aria-hidden="true">
                {r.icon}
              </span>
              <span className="flex-1 truncate text-[16px]">{r.label}</span>
              {r.hint && <span className="text-[14px] text-black/30 dark:text-white/30">{r.hint}</span>}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      {/* 登录小号：自由登录墙覆盖层（slot=null 不绑定槽位；返回关闭不退出 QQ） */}
      {loginOpen && (
        <div className="absolute inset-0 z-30">
          <LoginScreen
            onLogin={(u) => {
              setLoginOpen(false);
              onLoginOther(u);
            }}
            onBack={() => setLoginOpen(false)}
          />
        </div>
      )}
    </div>
  );
}


// ---------------- 收藏页（个人抽屉「收藏」入口；数据在 @/lib/msg-favorites） ----------------

export function QqFavoritesPage({ onBack }: { onBack: () => void; onToast?: (m: string) => void }) {
  // 收藏页在提前 return 的分支里，App 根 toast 不渲染 → 页内自带 toast
  const [toast, showToast] = useLocalToast();
  const onToast = showToast;
  const [list, setList] = useState<MsgFavorite[]>(() => loadFavorites('qq'));

  const del = (id: string) => {
    removeFavorite('qq', id);
    setList((prev) => prev.filter((x) => x.id !== id));
    onToast('已删除收藏');
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F5F6F7] text-[#1F2329] dark:bg-[#111214] dark:text-white">
      {/* 顶栏（QQ 风格返回 + 标题） */}
      <div className="shrink-0 bg-[#F5F6F7] pt-[54px] dark:bg-[#111214]">
        <div className="flex h-12 items-center gap-1 px-3">
          <button type="button" aria-label="返回" data-testid="qq-fav-back" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <div className="ml-1 flex flex-1 items-center">
            <span className="text-[17px] font-semibold leading-tight">我的收藏</span>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-24 text-black/35 dark:text-white/35" data-testid="qq-fav-empty">
            <Star className="h-10 w-10" strokeWidth={1.2} />
            <p className="text-[13px]">暂无收藏 · 长按聊天消息可收藏</p>
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((f) => (
              <div key={f.id} data-testid="qq-fav-item" className="rounded-[12px] bg-white p-3 dark:bg-[#1E1F23]">
                <div className="flex items-center gap-2">
                  <QqAvatar src={f.contactAvatar} alt={f.contactName} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/55 dark:text-white/55">{f.contactName}</span>
                  <span className="shrink-0 text-[11px] text-black/35 dark:text-white/35">
                    {f.msgRole === 'me' ? '我' : '对方'} · {fmtChatTime(f.time)}
                  </span>
                  <button
                    type="button"
                    aria-label="删除收藏"
                    data-testid="qq-fav-del"
                    onClick={() => del(f.id)}
                    className="shrink-0 text-black/30 active:opacity-60 dark:text-white/30"
                  >
                    <Trash2 className="h-[16px] w-[16px]" strokeWidth={1.8} />
                  </button>
                </div>
                <div className="mt-2 rounded-[8px] bg-[#F6F7F8] px-2.5 py-2 dark:bg-white/[0.06]">
                  {f.stkUrl ? (
                    <img src={f.stkUrl} alt={f.content} className="max-h-[110px] w-auto max-w-full rounded object-contain" />
                  ) : f.imgSrc ? (
                    <img src={f.imgSrc} alt="收藏图片" className="max-h-[160px] w-auto max-w-full rounded object-cover" />
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.45]">{f.content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 页内 toast（已删除收藏等提示） */}
      <LocalToast msg={toast} />
    </div>
  );
}
