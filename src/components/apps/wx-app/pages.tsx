'use client';

/** 新的朋友/申请/添加/好友详情/资料/设置/切号/收藏/看一看/搜索页 —— v1.9.27 任务10 从 wechat.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Globe, Image as ImageIcon, MessageCircle, Newspaper, Phone, Plus, QrCode, Radar, ScanLine, Search, Smartphone, Star, Trash2, User, Users, Video, Wallet, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { loadFavorites, removeFavorite, type MsgFavorite } from '@/lib/msg-favorites';
import { useUI } from '@/lib/ios/store';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
import { loadGroupMsgs, type ChatGroup } from '@/lib/ios/groups';
import { GroupAvatar, groupRowId } from '../wx-group';
import { LocalToast, useLocalToast } from '../page-toast';
// Task 40 错误提示优化 + 草稿箱：错误分类与连续失败冷却、会话草稿持久化、失败灰字提示行组件
// 美团×AI 联动（外卖参与/双向代付）：动作执行、上下文块、历史序列化
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// v1.3 Shizuku 自主权：[手机操作:命令] 标记的执行器 + 按开关动态注入的教学规则（设置 APP → AI 动手）
// 第十六轮：AI 动态状态（情绪+作息）注入 + 送礼物情绪事件
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
import { useChatSkin } from '@/lib/ios/chat-skin';
// 多账号 v2（Task 40-2a）：per-app 账号 API——accLs 键作用域调用时现算；switchAccountFor 切换只写标记+派发事件（不刷新网页）
// 第三十四轮：添加账号弹层（AccountAddSheet）删除——「添加账号」改为直接用账号密码登录（LoginScreen）
import { ACCOUNT_CHANGED_EVENT, MAIN_ACCOUNT_ID, accountLoginHistory, accLs, deleteAccount, getAccounts, getActiveAccountIdFor, markAccountLoginHistory, switchAccountFor, type PhoneAccount } from '@/lib/ios/accounts';
import { listContacts, mainOwnerContact, updateContact } from '@/lib/ios/contacts-store';
import { fileToAvatarDataUrl } from '@/lib/ios/avatar-upload';
import { noteAvatarChanged } from '@/lib/ios/avatar-ai';
import { avatarFor, displayNameOf, isFriendIn, socialNameOf } from '@/lib/contacts';
import type { ContactRecord } from '@/lib/contacts';
import { SOURCE_SEARCH_WX, appendReqThread, genCharThreadReply, processAltFriendReq, shouldUseAltDecisionFlow, type FriendReqExtras, type FriendReqThreadMsg } from '@/lib/ios/friend-state';
// v73 AI 聊天悬浮小窗：顶栏「小窗模式」按钮入口（打开全局小窗并退出全屏聊天）
import { ChatToggle, type ChatSearchItem } from '../chat-settings';
import { formatBranchDate } from '@/lib/ios/branch';

import { LS_SESSION, WxFriendReq, WxMoment, WxMsg, WxUser, compressImageFile, fmtChatTime, fmtReqDayLabel, loadMsgs, loadStrList, maskPhone, readWxClapText, saveStrList, writeWxClapText } from './core';
import { LoginScreen } from './login';
import { EllipsisGlyph, PseudoQR, WxAvatar, WxMenuRow, WxTileIcon } from './widgets';

// ---------------- 新的朋友页（按时间分组；待处理申请点「查看」进详情；AI 加回申请同列表展示） ----------------

export function NewFriendsPage({
  reqs,
  onBack,
  onGoAdd,
  onOpenReq,
}: {
  reqs: WxFriendReq[];
  onBack: () => void;
  onGoAdd: () => void;
  /** 点申请行/查看 → 好友申请详情页 */
  onOpenReq: (r: WxFriendReq) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, WxFriendReq[]>();
    for (const r of reqs) {
      const k = fmtReqDayLabel(r.time);
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [reqs]);

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-3">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-newfriends-back"
            onClick={onBack}
            className="active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">新的朋友</div>
          <button
            type="button"
            data-testid="wx-newfriends-add"
            onClick={onGoAdd}
            className="text-[15px] active:opacity-50"
          >
            添加朋友
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {/* 搜索框（点击进入添加朋友） */}
        <button
          type="button"
          onClick={onGoAdd}
          className="mx-3 mt-1 flex h-[38px] w-[calc(100%-24px)] items-center justify-center gap-1.5 rounded-[6px] bg-white text-[14px] text-black/30 active:bg-black/5 dark:bg-[#1E1E1E] dark:text-white/30"
        >
          <Search className="h-4 w-4" strokeWidth={2} />
          搜索 账号/手机号
        </button>

        {/* 添加手机联系人 */}
        <button
          type="button"
          onClick={onGoAdd}
          className="mt-2 flex w-full items-center gap-3 border-y border-black/[0.05] bg-white px-4 py-3 text-left active:bg-black/[0.04] dark:border-white/[0.08] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
        >
          <Phone className="h-[26px] w-[26px] text-[#07C160]" strokeWidth={1.8} aria-hidden="true" />
          <span className="min-w-0 flex-1 text-[16px]">添加手机联系人</span>
          <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
        </button>

        {reqs.length === 0 ? (
          <p className="py-14 text-center text-[13.5px] text-black/35 dark:text-white/35">
            暂无新的朋友通知，去「添加朋友」认识新朋友吧
          </p>
        ) : (
          groups.map(([label, list]) => (
            <div key={label}>
              <p className="px-4 pb-1 pt-3 text-[13px] text-black/45 dark:text-white/45">{label}</p>
              <div className="bg-white dark:bg-[#1A1A1A]">
                {list.map((r) => {
                  const status = r.status ?? 'accepted';
                  return (
                    <button
                      type="button"
                      key={`${r.id}-${r.time}`}
                      data-testid={`wx-req-${r.name}`}
                      onClick={() => onOpenReq(r)}
                      className="flex w-full items-center gap-3 border-b border-black/[0.05] px-4 py-2.5 text-left last:border-b-0 active:bg-black/[0.03] dark:border-white/[0.08] dark:active:bg-white/[0.05]"
                    >
                      <WxAvatar src={r.avatar} alt={r.name} size={42} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[16px]">{r.name}</p>
                        <p className="mt-0.5 truncate text-[13px] text-black/40 dark:text-white/40">{r.message}</p>
                      </div>
                      {status === 'pending' ? (
                        <span
                          className="shrink-0 rounded-[4px] border border-[#07C160] px-3.5 py-1.5 text-[14px] font-medium text-[#07C160] active:bg-[#07C160]/10"
                          data-testid={`wx-req-status-${r.name}`}
                        >
                          查看
                        </span>
                      ) : (
                        <span className="shrink-0 text-[14px] text-black/35 dark:text-white/35" data-testid={`wx-req-status-${r.name}`}>
                          {status === 'rejected' ? '已拒绝' : '已添加'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------- 好友申请详情页（新的朋友点申请 / 搜索结果点人进入；req=null = 搜索资料预览模式） ----------------

export function FriendReqDetailPage({
  req,
  contact,
  liveAvatar,
  onBack,
  onAccept,
  onReject,
  onBlock,
  onVerify,
  onToast,
}: {
  /** 好友申请（null = 搜索结果资料预览：还没有申请，走「前往验证」发申请） */
  req: WxFriendReq | null;
  /** 申请对应的联系人（被彻底删除时为 null：展示快照，验证按钮置灰） */
  contact: ContactRecord | null;
  /** 头像实时解析（换头像后历史申请/快照立即显示当前头像） */
  liveAvatar: (snapshot: string | null | undefined, ref: { peerId?: string | null; name?: string | null }) => string | null;
  onBack: () => void;
  /** 同意申请（前往验证，pending AI 申请）：宿主恢复好友关系 + 状态流转 + 刷新 */
  onAccept: (r: WxFriendReq) => void;
  /** 拒绝申请：AI 停止再申请 */
  onReject: (r: WxFriendReq) => void;
  /** 加入黑名单 */
  onBlock: (r: WxFriendReq | ContactRecord) => void;
  /** 资料预览模式「前往验证」：进申请添加朋友页 */
  onVerify: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  const status = req?.status ?? 'accepted';
  const pending = req != null && status === 'pending';
  const peerName = req?.name ?? (contact ? displayNameOf(contact) : '对方');
  const peerId = req?.contactId ?? contact?.id ?? null;
  const avatar = liveAvatar(req?.avatar ?? contact?.avatar ?? null, { peerId, name: peerName });

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
    appendReqThread('wx', req.id, msg);
    setReplyText('');
    setReplyOpen(false);
    if (contact && (contact.persona ?? '').trim()) {
      setReplyBusy(true);
      try {
        if (shouldUseAltDecisionFlow('wx', req)) {
          // 小号发起的申请：每条回复都触发 AI 重新决策（同意/拒绝/先回复，按人设随时可以同意）
          await processAltFriendReq('wx', req.id, contact.id);
        } else {
          const reply = await genCharThreadReply('wx', contact, [...thread, msg], 'reply');
          if (reply) appendReqThread('wx', req.id, { who: 'peer', text: reply, time: Date.now() });
        }
      } catch {
        // 生成失败静默：用户消息已在线程里
      } finally {
        setReplyBusy(false);
      }
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-req-detail">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-reqdetail-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="更多"
            onClick={() => onToast('资料设置暂未开放')}
            className="px-3 active:opacity-50"
          >
            <EllipsisGlyph />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* 头部：头像 + 昵称 + 性别 + 备注名/朋友权限（对照微信好友申请详情） */}
        <div className="bg-white px-4 pb-5 pt-2 dark:bg-[#1A1A1A]">
          <div className="flex items-start gap-4">
            <WxAvatar src={avatar} alt={peerName} size={76} />
            <div className="min-w-0 flex-1 pt-1.5">
              <p className="flex items-center gap-1.5 text-[22px] font-semibold leading-tight">
                <span className="truncate">{peerName}</span>
                {contact?.gender === '男' && <User className="h-[19px] w-[19px] shrink-0 text-[#4D9CF8]" aria-hidden="true" strokeWidth={2} />}
                {contact?.gender === '女' && <User className="h-[19px] w-[19px] shrink-0 text-[#FF6B81]" aria-hidden="true" strokeWidth={2} />}
              </p>
              {/* 备注名 / 朋友权限（微信样式蓝字链接；入口暂未开放） */}
              <p className="mt-3 flex gap-6 text-[16px] text-[#576B95] dark:text-[#8FA5C9]">
                <button type="button" onClick={() => onToast('设置备注名暂未开放')}>备注名</button>
                <button type="button" onClick={() => onToast('朋友权限暂未开放')}>朋友权限</button>
              </p>
              {contact?.region && <p className="mt-1.5 truncate text-[13px] text-black/40 dark:text-white/40">地区：{contact.region}</p>}
            </div>
          </div>
        </div>

        {/* 验证消息记录（我/对方 多轮对话 + 附图 + 回复） */}
        {thread.length > 0 && (
          <div className="bg-white px-4 pb-5 dark:bg-[#1A1A1A]">
            <div className="rounded-[8px] border border-black/10 p-4 dark:border-white/15" data-testid="wx-reqdetail-thread">
              {thread.map((m, i) => (
                <p key={`${m.time}-${i}`} className="break-words text-[15.5px] leading-[1.9]">
                  {m.who === 'me' ? '我: ' : `${peerName}: `}
                  {m.text}
                </p>
              ))}
              {req?.extras?.photos && req.extras.photos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {req.extras.photos.map((p, i) => (
                    <img key={i} src={p} alt={`照片${i + 1}`} className="h-16 w-16 rounded-[6px] object-cover" />
                  ))}
                </div>
              )}
              {req?.extras?.image && (
                <img src={req.extras.image} alt="申请附图" className="mt-3 max-h-[180px] w-auto max-w-full rounded-[6px] object-cover" />
              )}
              {replyBusy ? (
                <p className="mt-1 text-[15px] text-black/35 dark:text-white/35" data-testid="wx-reqdetail-reply-busy">
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
                      data-testid="wx-reqdetail-reply-input"
                      className="h-9 min-w-0 flex-1 rounded-[6px] bg-black/[0.04] px-3 text-[14.5px] outline-none placeholder:text-black/30 dark:bg-white/10 dark:placeholder:text-white/30"
                    />
                    <button
                      type="button"
                      data-testid="wx-reqdetail-reply-send"
                      onClick={() => void sendReply()}
                      className="shrink-0 rounded-[6px] bg-[#07C160] px-4 py-1.5 text-[14px] font-medium text-white active:bg-[#06AD56]"
                    >
                      发送
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="wx-reqdetail-reply"
                    onClick={() => setReplyOpen(true)}
                    className="mt-1 block text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
                  >
                    回复
                  </button>
                )
              ) : null}
            </div>
          </div>
        )}

        {/* 来源（资料预览模式附微信号，便于确认搜索到的人） */}
        <div className="mt-3 bg-white dark:bg-[#1A1A1A]">
          <div className="flex items-center gap-8 px-4 py-4">
            <span className="w-[64px] shrink-0 text-[17px]">来源</span>
            <span className="min-w-0 flex-1 text-[16px] text-black/40 dark:text-white/40" data-testid="wx-reqdetail-source">
              {req?.source || (req ? '朋友验证消息' : SOURCE_SEARCH_WX)}
            </span>
          </div>
          {!req && contact && (
            <div className="flex items-center gap-8 border-t border-black/[0.05] px-4 py-4 dark:border-white/[0.08]">
              <span className="w-[64px] shrink-0 text-[17px]">微信号</span>
              <span className="min-w-0 flex-1 truncate text-[16px] text-black/40 dark:text-white/40">
                {contact.wechatId || contact.qqId || contact.phone || '未设置'}
              </span>
            </div>
          )}
        </div>

        {/* 前往验证（同意）/ 拒绝 / 状态 */}
        {req == null ? (
          <button
            type="button"
            data-testid="wx-reqdetail-accept"
            onClick={() => contact && onVerify(contact)}
            disabled={!contact}
            className="mt-3 w-full bg-white py-[17px] text-center text-[17px] text-[#576B95] active:bg-black/[0.04] disabled:opacity-40 dark:bg-[#1A1A1A] dark:text-[#8FA5C9] dark:active:bg-white/[0.06]"
          >
            前往验证
          </button>
        ) : pending ? (
          req.fromChar ? (
            <div className="mt-3 flex gap-px">
              <button
                type="button"
                onClick={() => onAccept(req)}
                disabled={!contact}
                className="flex-1 bg-white py-[17px] text-center text-[17px] text-[#576B95] active:bg-black/[0.04] disabled:opacity-40 dark:bg-[#1A1A1A] dark:text-[#8FA5C9] dark:active:bg-white/[0.06]"
              >
                前往验证
              </button>
              <button
                type="button"
                data-testid="wx-reqdetail-reject"
                onClick={() => onReject(req)}
                className="flex-1 bg-white py-[17px] text-center text-[17px] text-red-500 active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
              >
                拒绝
              </button>
            </div>
          ) : (
            // 小号发起、等待 AI 决策的申请：无同意/拒绝按钮（决策在对方手里），可继续回复验证消息
            <p
              className="mt-3 bg-white py-[17px] text-center text-[16px] text-black/35 dark:bg-[#1A1A1A] dark:text-white/35"
              data-testid="wx-reqdetail-waiting"
            >
              等待对方验证
            </p>
          )
        ) : (
          <p className="mt-3 bg-white py-[17px] text-center text-[16px] text-black/35 dark:bg-[#1A1A1A] dark:text-white/35" data-testid="wx-reqdetail-done">
            {status === 'rejected' ? '已拒绝该申请' : '已添加'}
          </p>
        )}
      </div>

      {/* 底部：加入黑名单 | 投诉 */}
      <div className="flex shrink-0 items-center justify-center gap-4 pb-[30px] pt-3">
        <button type="button" data-testid="wx-reqdetail-block" onClick={() => req ? onBlock(req) : contact && onBlock(contact)} className="text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
          加入黑名单
        </button>
        <span className="h-4 w-px bg-black/15 dark:bg-white/20" aria-hidden="true" />
        <button type="button" onClick={() => onToast('投诉暂未开放')} className="text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
          投诉
        </button>
      </div>
    </div>
  );
}

// ---------------- 申请添加朋友页（添加朋友搜索结果点人进入；发送 = 记录申请 + 加为好友） ----------------

export const WX_COMMON_GREETING_KEY = 'wx-common-greeting';

export function ApplyFriendPage({
  me,
  target,
  onBack,
  onSend,
  onToast,
}: {
  me: WxUser;
  /** 要添加的联系人（搜索结果） */
  target: ContactRecord;
  onBack: () => void;
  /** 发送申请：宿主加好友 + 写「新的朋友」+ 恢复被删状态 */
  onSend: (payload: { greeting: string; extras: FriendReqExtras }) => void;
  onToast: (m: string) => void;
}) {
  const [greeting, setGreeting] = useState(() => {
    try {
      // 多账号 v2（Task 40-2a）：常用招呼语按微信当前账号作用域（调用时现算）
      // 招呼语会进对方 AI 的上下文：恒用真名（用户规则：AI 永不知道机主昵称）
      const saved = window.localStorage.getItem(accLs(WX_COMMON_GREETING_KEY, 'wx'));
      return saved?.trim() || `我是${me.realName || me.name}`;
    } catch {
      return `我是${me.realName || me.name}`;
    }
  });
  const [image, setImage] = useState<string | null>(null);
  const [remark, setRemark] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [memo, setMemo] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [permOpen, setPermOpen] = useState(false);
  const [permChat, setPermChat] = useState(true);
  const [permMoments, setPermMoments] = useState(true);
  const [permExercise, setPermExercise] = useState(true);
  const [hideMine, setHideMine] = useState(false);
  const [hideTheirs, setHideTheirs] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [memoDraft, setMemoDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);

  const handleFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const src = await compressImageFile(f, 720);
    if (!src) {
      onToast('图片读取失败');
      return;
    }
    setImage(src);
  };

  const handlePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = 4 - photos.length;
    if (room <= 0) {
      onToast('最多添加 4 张照片');
      return;
    }
    const picked = [...files].slice(0, room);
    const out: string[] = [];
    for (const f of picked) {
      const src = await compressImageFile(f, 720);
      if (src) out.push(src);
    }
    if (out.length === 0) {
      onToast('图片读取失败');
      return;
    }
    setPhotos((prev) => [...prev, ...out].slice(0, 4));
  };

  /** 灰色圆角卡（对照申请添加朋友页：打招呼内容/备注等输入区） */
  const cardCls = 'mx-4 rounded-[10px] bg-[#F6F6F6] dark:bg-[#242424]';
  /** 蓝字选择行（标签/备忘/照片/朋友权限） */
  const cellRow = 'flex h-[56px] w-full items-center justify-between px-4 text-left active:opacity-70';

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-3">
          <button type="button" aria-label="返回" data-testid="wx-apply-close" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-semibold">申请添加朋友</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {/* 打招呼内容（灰卡：多行输入 + 分隔线 + 添加图片） */}
        <p className="px-6 pb-2 pt-4 text-[15px] text-black/45 dark:text-white/45">打招呼内容</p>
        <div className={`${cardCls} px-4 py-3`}>
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value.slice(0, 100))}
            rows={4}
            data-testid="wx-apply-greeting"
            className="w-full resize-none bg-transparent text-[16px] leading-[1.7] caret-[#07C160] outline-none"
          />
          <div className="h-px bg-black/[0.07] dark:bg-white/[0.09]" aria-hidden="true" />
          <div className="mt-2.5 flex items-center gap-3">
            <button type="button" data-testid="wx-apply-image" onClick={() => fileRef.current?.click()} className="flex items-center gap-2 text-[15px] text-black/40 active:opacity-60 dark:text-white/40">
              <ImageIcon className="h-[19px] w-[19px]" strokeWidth={1.8} />
              {image ? '重新添加图片' : '添加图片'}
            </button>
            {image && (
              <span className="ml-auto flex items-center gap-2">
                <img src={image} alt="打招呼附图" className="h-11 w-11 rounded-[6px] object-cover" />
                <button type="button" onClick={() => setImage(null)} aria-label="移除图片" className="text-[13px] text-black/40 active:opacity-60 dark:text-white/40">
                  移除
                </button>
              </span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <button
          type="button"
          data-testid="wx-apply-common-greeting"
          onClick={() => {
            try {
              window.localStorage.setItem(accLs(WX_COMMON_GREETING_KEY, 'wx'), greeting.trim());
            } catch {
              // 忽略
            }
            onToast('已设为常用打招呼内容');
          }}
          className="mt-3 block px-6 text-[15.5px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
        >
          设为常用打招呼内容
        </button>

        {/* 备注（灰卡输入 + 自己昵称一键填入建议） */}
        <p className="px-6 pb-2 pt-5 text-[15px] text-black/45 dark:text-white/45">备注</p>
        <div className={`${cardCls} flex h-[56px] items-center px-4`}>
          <input
            value={remark}
            onChange={(e) => setRemark(e.target.value.slice(0, 30))}
            placeholder="添加备注"
            data-testid="wx-apply-remark"
            className="h-full w-full bg-transparent text-[16px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
          />
        </div>
        <button
          type="button"
          data-testid="wx-apply-remark-suggest"
          onClick={() => setRemark(me.name.slice(0, 30))}
          className="mt-3 block px-6 text-[15.5px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
        >
          {me.name} <span aria-hidden="true">↖</span>
        </button>

        {/* 标签 */}
        <p className="px-6 pb-2 pt-5 text-[15px] text-black/45 dark:text-white/45">标签</p>
        <div className={cardCls}>
          <button type="button" data-testid="wx-apply-tags" onClick={() => setTagOpen(true)} className={cellRow}>
            <span className="min-w-0 flex-1 truncate text-left text-[16px] text-[#576B95] dark:text-[#8FA5C9]">
              {tags.length > 0 ? tags.join('、') : '添加标签'}
            </span>
            <ChevronRight className="h-[19px] w-[19px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* 备忘 */}
        <p className="px-6 pb-2 pt-5 text-[15px] text-black/45 dark:text-white/45">备忘</p>
        <div className={cardCls}>
          <button type="button" data-testid="wx-apply-memo" onClick={() => setMemoOpen(true)} className={cellRow}>
            <span className="min-w-0 flex-1 truncate text-left text-[16px] text-[#576B95] dark:text-[#8FA5C9]">{memo || '添加备忘'}</span>
            <ChevronRight className="h-[19px] w-[19px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* 照片（≤4 张，随申请存档，详情页展示） */}
        <p className="px-6 pb-2 pt-5 text-[15px] text-black/45 dark:text-white/45">照片</p>
        <div className={cardCls}>
          <button type="button" data-testid="wx-apply-photos" onClick={() => photosRef.current?.click()} className={cellRow}>
            <span className="min-w-0 flex-1 truncate text-left text-[16px] text-[#576B95] dark:text-[#8FA5C9]">
              {photos.length > 0 ? `已添加 ${photos.length} 张` : '添加照片'}
            </span>
            <ChevronRight className="h-[19px] w-[19px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              {photos.map((p, i) => (
                <span key={i} className="relative">
                  <img src={p} alt={`照片${i + 1}`} className="h-16 w-16 rounded-[6px] object-cover" />
                  <button
                    type="button"
                    aria-label={`移除照片${i + 1}`}
                    onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-white"
                  >
                    <X className="h-3 w-3" strokeWidth={2.6} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            ref={photosRef}
            type="file"
            accept="image/*"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={(e) => {
              void handlePhotos(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {/* 朋友权限（聊天/朋友圈/微信运动） */}
        <p className="px-6 pb-2 pt-5 text-[15px] text-black/45 dark:text-white/45">朋友权限</p>
        <div className={cardCls}>
          <button type="button" data-testid="wx-apply-perm" onClick={() => setPermOpen(true)} className={cellRow}>
            <span className="min-w-0 flex-1 truncate text-left text-[16px] text-[#576B95] dark:text-[#8FA5C9]">
              聊天、朋友圈{permExercise ? '、微信运动' : ''}
            </span>
            <ChevronRight className="h-[19px] w-[19px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* 朋友圈可见性（双向开关） */}
        <div className={`${cardCls} mt-4`}>
          <div className={cellRow}>
            <span className="text-[15.5px]">不让他看我的朋友圈和状态</span>
            <ChatToggle on={hideMine} onChange={setHideMine} accent="#07C160" testId="wx-apply-hide-mine" label="不让他看我的朋友圈和状态" />
          </div>
          <div className="h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />
          <div className={cellRow}>
            <span className="text-[15.5px]">不看他(她)的朋友圈和状态</span>
            <ChatToggle on={hideTheirs} onChange={setHideTheirs} accent="#07C160" testId="wx-apply-hide-theirs" label="不看他(她)的朋友圈和状态" />
          </div>
        </div>

        <button
          type="button"
          data-testid="wx-apply-send"
          disabled={busy}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            onSend({
              greeting: greeting.trim() || `我是${me.realName || me.name}`,
              extras: { image, remark: remark.trim() || null, tags, memo: memo.trim() || null, photos, permChat, permMoments, permExercise, hideMine, hideTheirs },
            });
          }}
          className="mx-auto mt-10 block h-12 w-[240px] max-w-[72%] rounded-[14px] bg-[#07C160] text-[17px] font-medium text-white active:bg-[#06AD56] disabled:opacity-60"
        >
          发送
        </button>
      </div>

      {/* 标签编辑弹窗 */}
      {tagOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setTagOpen(false)}>
          <div className="w-full max-w-[300px] rounded-[10px] bg-white p-5 dark:bg-[#1A1A1A]" onClick={(e) => e.stopPropagation()}>
            <p className="text-[16px] font-medium">添加标签</p>
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder="多个标签用逗号分隔"
              autoFocus
              className="mt-3 h-10 w-full rounded-[8px] bg-black/[0.05] px-3 text-[14px] outline-none placeholder:text-black/30 dark:bg-white/10 dark:placeholder:text-white/30"
            />
            {tags.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="flex items-center gap-1 rounded-[4px] bg-black/[0.05] px-2 py-1 text-[12.5px] dark:bg-white/10">
                    {t}
                    <button type="button" aria-label={`删除标签${t}`} onClick={() => setTags((prev) => prev.filter((x) => x !== t))}>
                      <X className="h-3 w-3" strokeWidth={2.4} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-4 flex gap-2.5">
              <button type="button" onClick={() => setTagOpen(false)} className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10">
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = tagDraft
                    .split(/[,,、\s]+/)
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 6);
                  if (next.length) setTags((prev) => [...new Set([...prev, ...next])].slice(0, 6));
                  setTagDraft('');
                  setTagOpen(false);
                }}
                className="h-10 flex-1 rounded-[8px] bg-[#07C160] text-[14px] font-medium text-white active:opacity-80"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 备忘编辑弹窗 */}
      {memoOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setMemoOpen(false)}>
          <div className="w-full max-w-[300px] rounded-[10px] bg-white p-5 dark:bg-[#1A1A1A]" onClick={(e) => e.stopPropagation()}>
            <p className="text-[16px] font-medium">添加备忘</p>
            <textarea
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value.slice(0, 100))}
              placeholder="写点备忘（仅自己可见）"
              rows={3}
              autoFocus
              className="mt-3 w-full resize-none rounded-[8px] bg-black/[0.05] p-3 text-[14px] outline-none placeholder:text-black/30 dark:bg-white/10 dark:placeholder:text-white/30"
            />
            <div className="mt-3 flex gap-2.5">
              <button type="button" onClick={() => setMemoOpen(false)} className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10">
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setMemo(memoDraft.trim());
                  setMemoOpen(false);
                }}
                className="h-10 flex-1 rounded-[8px] bg-[#07C160] text-[14px] font-medium text-white active:opacity-80"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 朋友权限弹窗（聊天/朋友圈/微信运动） */}
      {permOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-8" onClick={() => setPermOpen(false)}>
          <div className="w-full max-w-[300px] rounded-[10px] bg-white p-5 dark:bg-[#1A1A1A]" onClick={(e) => e.stopPropagation()}>
            <p className="text-[16px] font-medium">朋友权限</p>
            <div className="mt-2">
              {([['聊天', permChat, setPermChat], ['朋友圈', permMoments, setPermMoments], ['微信运动', permExercise, setPermExercise]] as const).map(
                ([label, on, set]) => (
                  <div key={label} className="flex h-12 items-center justify-between">
                    <span className="text-[15px]">{label}</span>
                    <ChatToggle on={on} onChange={set} accent="#07C160" label={label} />
                  </div>
                ),
              )}
            </div>
            <button type="button" onClick={() => setPermOpen(false)} className="mt-3 h-10 w-full rounded-[8px] bg-[#07C160] text-[14px] font-medium text-white active:opacity-80">
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 添加朋友页 ----------------

export function AddFriendPage({
  contacts,
  me,
  onBack,
  onOpenReqDetail,
  onOpenChat,
  onToast,
}: {
  contacts: ContactRecord[];
  me: WxUser;
  onBack: () => void;
  /** 点搜索结果（非好友）→ 好友申请详情页（资料预览）→ 前往验证 → 申请添加朋友页 */
  onOpenReqDetail: (c: ContactRecord) => void;
  /** 点「发消息」：直接打开与该好友的聊天 */
  onOpenChat: (c: ContactRecord) => void;
  onToast: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');

  const query = q.trim().toLowerCase();
  const searched = query.length > 0;
  const results = useMemo(() => {
    if (!query) return [];
    return contacts.filter(
      (c) =>
        c.kind !== 'user' &&
        ((c.phone ?? '').toLowerCase().includes(query) ||
          (c.wechatId ?? '').toLowerCase().includes(query) ||
          (c.qqId ?? '').toLowerCase().includes(query))
    );
  }, [contacts, query]);

  const options: Array<[string, string, string, React.ReactNode]> = [
    ['扫一扫', '扫描二维码名片', '#5A9CF8', <ScanLine key="1" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['手机联系人', '添加通讯录中的朋友', '#07C160', <Smartphone key="2" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['雷达', '添加身边的朋友', '#7B68EE', <Radar key="3" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['面对面建群', '与身边的朋友进入同一个群聊', '#07C160', <Users key="5" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['公众号', '获取更多资讯', '#5A9CF8', <Newspaper key="6" className="h-[21px] w-[21px]" strokeWidth={2} />],
    ['服务号', '获取更多购物信息和服务', '#F26D6D', <Wallet key="7" className="h-[21px] w-[21px]" strokeWidth={2} />],
  ];

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-addfriend-back"
            onClick={onBack}
            className="active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">添加朋友</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {/* 搜索框 */}
        <div className="px-3 pb-2 pt-1">
          <div className="flex h-[38px] items-center gap-2 rounded-[6px] bg-[#F2F2F2] px-3 dark:bg-[#1E1E1E]">
            <Search className="h-4 w-4 shrink-0 text-black/30 dark:text-white/30" strokeWidth={2} />
            <input
              data-testid="wx-addfriend-query"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setErr('');
              }}
              placeholder="搜索 账号/手机号"
              aria-label="搜索微信号或手机号添加朋友"
              autoCapitalize="off"
              autoCorrect="off"
              className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
          {err && (
            <p className="mt-1.5 px-1 text-[12.5px] text-red-500" role="alert">
              {err}
            </p>
          )}
        </div>

        {searched ? (
          results.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-[15px] text-black/45 dark:text-white/45">该用户不存在</p>
              <p className="mt-1.5 text-[12.5px] text-black/30 dark:text-white/30">
                换个手机号 / 微信号 / QQ号 试试，或先到「联系人」App 创建
              </p>
            </div>
          ) : (
            <div>
              {results.map((c) => {
                const added = isFriendIn(c, 'wx');
                return added ? (
                  <button
                    type="button"
                    key={c.id}
                    data-testid={`wx-add-result-${c.name}`}
                    onClick={() => onOpenChat(c)}
                    className="flex w-full items-center gap-3 border-b border-black/[0.06] px-4 py-2.5 text-left active:bg-black/[0.03] dark:border-white/[0.08] dark:active:bg-white/[0.05]"
                  >
                    <WxAvatar src={c.avatar} alt={c.name} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px]">{c.name}</p>
                      <p className="mt-0.5 truncate text-[12.5px] text-black/40 dark:text-white/40">
                        微信号：{c.wechatId || c.qqId || c.phone || '未设置'}
                      </p>
                    </div>
                    <span
                      data-testid={`wx-add-chat-${c.name}`}
                      className="shrink-0 rounded-[5px] border border-[#07C160] px-3 py-1.5 text-[13.5px] font-medium text-[#07C160]"
                    >
                      发消息
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    key={c.id}
                    data-testid={`wx-add-result-${c.name}`}
                    onClick={() => onOpenReqDetail(c)}
                    className="flex w-full items-center gap-3 border-b border-black/[0.06] px-4 py-2.5 text-left active:bg-black/[0.03] dark:border-white/[0.08] dark:active:bg-white/[0.05]"
                  >
                    <WxAvatar src={c.avatar} alt={c.name} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px]">{c.name}</p>
                      <p className="mt-0.5 truncate text-[12.5px] text-black/40 dark:text-white/40">
                        微信号：{c.wechatId || c.qqId || c.phone || '未设置'}
                      </p>
                    </div>
                    <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
                  </button>
                );
              })}
              <p className="px-4 pt-2.5 text-[12.5px] leading-relaxed text-black/35 dark:text-white/35">
                该账号来自「联系人」App；点击搜索结果可查看资料并发送好友申请，已是好友的可直接发消息
              </p>
            </div>
          )
        ) : (
          <>
            {/* 功能入口列表 */}
            <div className="bg-white dark:bg-[#1A1A1A]">
              {options.map(([label, sub, color, icon], i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onToast(`「${label}」暂未开放`)}
                  className="relative flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  {i > 0 && <span className="absolute left-[66px] right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />}
                  <WxTileIcon bg={color}>{icon}</WxTileIcon>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px]">{label}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-black/35 dark:text-white/35">{sub}</span>
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
                </button>
              ))}
            </div>

            {/* 我的二维码名片 */}
            <div className="flex flex-col items-center pb-6 pt-10">
              <div className="rounded-[12px] bg-white p-3.5 shadow-[0_3px_18px_rgba(0,0,0,0.09)] ring-1 ring-black/5 dark:ring-white/10">
                <PseudoQR seed={me.wechatId || me.id} size={172} />
              </div>
              <p className="mt-3 text-[12.5px] text-black/35 dark:text-white/35">扫一扫上面的二维码图案，加我微信</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- 好友详情页（通讯录点好友进入，同微信） ----------------

export function FriendDetailPage({
  friend,
  onBack,
  onOpenChat,
  onOpenMoments,
  onCall,
  onToast,
  onDeleteContact,
  branchInfo,
  onDeleteBranch,
}: {
  friend: ContactRecord;
  onBack: () => void;
  onOpenChat: (c: ContactRecord) => void;
  onOpenMoments: (c: ContactRecord) => void;
  /** Task 28-b 「音视频通话」ActionSheet 选项回调（voice/video）：宿主关详情页并经聊天页拨号（openVoiceCall 全链路） */
  onCall: (media: 'voice' | 'video') => void;
  onToast: (m: string) => void;
  /** 删除联系人（删除好友关系）：宿主弹二次确认；不传 = 隐藏（自己资料页） */
  onDeleteContact?: () => void;
  /** Task 37 角色分支：分支身份信息（仅分支角色传入；展示「X 的平行分支」说明） */
  branchInfo?: { parentName: string; createdAt: number } | null;
  /** Task 37 角色分支：删除该分支（宿主弹二次确认后真删）；不传 = 隐藏 */
  onDeleteBranch?: () => void;
}) {
  // 跨 App 跳转：点「朋友资料」→ 打开联系人 App 后直接进入该联系人的编辑页
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingContactEdit = useUI((s) => s.setPendingContactEdit);
  // Task 28-b 「音视频通话」底部 ActionSheet（语音通话/视频通话 + 取消；点遮罩也可取消）
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  return (
    <div className="wx-fdetail-page absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏：返回 + ··· */}
      <div className="shrink-0 pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-fdetail-back"
            onClick={onBack}
            className="active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="更多"
            onClick={() => onToast('资料设置暂未开放')}
            className="px-3 active:opacity-50"
          >
            <EllipsisGlyph />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {/* 头部：头像 + 名字 + 性别 + 微信号 */}
        <div className="bg-white px-4 py-5 dark:bg-[#1A1A1A]">
          <div className="flex items-start gap-4">
            <WxAvatar src={friend.avatar} alt={friend.name} size={64} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="flex items-center gap-1.5 text-[21px] font-semibold leading-tight">
                <span className="truncate">{friend.name}</span>
                {friend.gender === '男' && (
                  <User className="h-[18px] w-[18px] shrink-0 text-[#4D9CF8]" aria-hidden="true" strokeWidth={2} />
                )}
                {friend.gender === '女' && (
                  <User className="h-[18px] w-[18px] shrink-0 text-[#FF6B81]" aria-hidden="true" strokeWidth={2} />
                )}
              </p>
              <p className="mt-2 truncate text-[14px] text-black/45 dark:text-white/45">
                微信号：{friend.wechatId || friend.qqId || friend.phone || '未设置'}
              </p>
            </div>
          </div>
        </div>

        {/* 朋友资料（点击 → 联系人 App 对应联系人的编辑界面） */}
        <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-fdetail-edit"
            onClick={() => {
              setPendingContactEdit(friend.id);
              switchToApp('contacts');
            }}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[16px]">朋友资料</span>
              <span className="mt-1 block text-[13px] leading-[1.55] text-black/35 dark:text-white/35">
                添加朋友的备注名、电话、标签、备忘、照片等，并设置朋友权限。
              </span>
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        {/* Task 37 分支身份说明（仅分支角色可见） */}
        {branchInfo && (
          <div className="mt-2 bg-white px-4 py-3.5 dark:bg-[#1A1A1A]">
            <p className="flex items-center gap-1.5 text-[15px] font-medium">
              分支角色
              <span className="rounded-[3px] bg-[#07C160]/10 px-[5px] py-px text-[10px] font-normal leading-[14px] text-[#07C160]">分支</span>
            </p>
            <p className="mt-1 text-[13px] leading-[1.65] text-black/45 dark:text-white/45">
              「{branchInfo.parentName}」的平行分支 · {formatBranchDate(branchInfo.createdAt)}创建。与原角色从分支点起各自独立发展，聊天、记忆、朋友圈互不同步。
            </p>
          </div>
        )}

        {/* 朋友圈 / 视频号 */}
        <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
          <WxMenuRow
            first
            label="朋友圈"
            testId="wx-fdetail-moments"
            onClick={() => onOpenMoments(friend)}
            icon={<span />}
          />
          <WxMenuRow
            label="视频号"
            onClick={() => onToast('视频号暂未开放')}
            icon={<span />}
          />
        </div>

        {/* 发消息 / 音视频通话 */}
        <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-fdetail-chat"
            onClick={() => onOpenChat(friend)}
            className="flex w-full items-center justify-center gap-2.5 py-[15px] text-[16px] text-[#576B95] active:bg-black/[0.04] dark:text-[#8FA5C9] dark:active:bg-white/[0.06]"
          >
            <MessageCircle className="h-[21px] w-[21px]" strokeWidth={1.8} />
            发消息
          </button>
          <div className="relative">
            <span className="absolute inset-x-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />
            <button
              type="button"
              data-testid="wx-fdetail-call"
              onClick={() => setCallSheetOpen(true)}
              className="flex w-full items-center justify-center gap-2.5 py-[15px] text-[16px] text-[#576B95] active:bg-black/[0.04] dark:text-[#8FA5C9] dark:active:bg-white/[0.06]"
            >
              <Phone className="h-[21px] w-[21px]" strokeWidth={1.8} />
              音视频通话
            </button>
          </div>
        </div>

        {/* Task 37 删除该分支（真删：聊天/记忆/朋友圈一并清空且不可恢复；二次确认在宿主层） */}
        {onDeleteBranch && (
          <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
            <button
              type="button"
              data-testid="wx-fdetail-delbranch"
              onClick={onDeleteBranch}
              className="flex w-full items-center justify-center py-[15px] text-[16px] text-red-500 active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              删除该分支
            </button>
          </div>
        )}

        {/* 删除联系人（删除好友关系；二次确认弹窗在宿主层，确认后从列表移除并关闭详情） */}
        {onDeleteContact && (
          <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
            <button
              type="button"
              data-testid="wx-fdetail-delete"
              onClick={onDeleteContact}
              className="flex w-full items-center justify-center py-[15px] text-[16px] text-red-500 active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              删除联系人
            </button>
          </div>
        )}
      </div>

      {/* Task 28-b 音视频通话 ActionSheet：底部滑出卡片（容器样式与 WxPayMethodSheet 同款：黑色半透明遮罩
          + 底部圆角卡片滑入，选项行白底黑字、绿色图标；点遮罩/取消关闭。先关卡片再回调拨号，避免弹层叠在全局通话层上） */}
      {callSheetOpen && (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45"
          role="dialog"
          aria-label="音视频通话"
          data-testid="wx-fdetail-call-sheet"
          onClick={() => setCallSheetOpen(false)}
        >
          <style>{'@keyframes wxFdCallIn{from{transform:translateY(65%);opacity:.35}to{transform:translateY(0);opacity:1}}'}</style>
          <div
            className="rounded-t-[14px] bg-[#EDEDED] px-3 pb-8 pt-3 dark:bg-[#1C1C1C]"
            style={{ animation: 'wxFdCallIn 0.24s ease-out' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]">
              <button
                type="button"
                data-testid="wx-fdetail-call-voice"
                onClick={() => {
                  setCallSheetOpen(false);
                  onCall('voice');
                }}
                className="flex h-14 w-full items-center gap-3 px-4 text-left text-[17px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <Phone className="h-[19px] w-[19px] shrink-0 text-[#07C160]" strokeWidth={1.9} aria-hidden="true" />
                语音通话
              </button>
              <div className="h-px bg-black/[0.05] dark:bg-white/[0.07]" aria-hidden="true" />
              <button
                type="button"
                data-testid="wx-fdetail-call-video"
                onClick={() => {
                  setCallSheetOpen(false);
                  onCall('video');
                }}
                className="flex h-14 w-full items-center gap-3 px-4 text-left text-[17px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
              >
                <Video className="h-[19px] w-[19px] shrink-0 text-[#07C160]" strokeWidth={1.9} aria-hidden="true" />
                视频通话
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCallSheetOpen(false)}
              className="mt-3 h-14 w-full rounded-[10px] bg-white text-[17px] active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 我的资料页（个人资料，微信同款） ----------------

export function ProfilePage({
  me,
  record,
  onBack,
  onToast,
}: {
  me: WxUser;
  /** 自己在「联系人 App」里的完整资料（性别 / 地区用） */
  record: ContactRecord | null;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  // 头像按 App 隔离：微信个人资料页换头像只写机主的 avatars.wx 槽位（合并语义），
  // 不影响 QQ/信息/电话/联系人全局头像；未设置过则 avatarFor 投影自动回退全局头像
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const onAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    void fileToAvatarDataUrl(f)
      .then((data) => updateContact(me.id, { avatars: { wx: data } }).then((rec) => ({ rec, data })))
      .then(({ rec, data }) => {
        // 第二十九轮「让 AI 知道我换头像了」：头像描述落库（异步识图）+ 给恋人角色写事件记忆
        if (rec) {
          noteAvatarChanged(me.id, 'wx', data, 'me');
          onToast('头像已更新');
        } else onToast('头像保存失败');
      })
      .catch(() => onToast('头像保存失败'));
  };
  // Task 30 资料编辑：名字/性别/地区/手机号/微信号点行弹修改框——统一写回机主联系人档案
  //（updateContact 全端广播：联系人 App/微信/QQ/信息/电话 + 设置个人信息（名字经 owner-profile-sync 镜像））；
  // 头像（按 App 槽位）与拍一拍文案（按 App 独立存储）是仅有的两个非全局项
  const [editRow, setEditRow] = useState<null | { key: string; label: string }>(null);
  const [editDraft, setEditDraft] = useState('');
  // 拍一拍文案（微信侧独立于 QQ）：本页挂载时读一次，保存后即时回显
  const [clapText, setClapText] = useState<string>(() => readWxClapText());
  const openEdit = (key: string, label: string, initial: string) => {
    setEditRow({ key, label });
    setEditDraft(initial);
  };
  const saveEdit = () => {
    const row = editRow;
    setEditRow(null);
    if (!row) return;
    const t = editDraft.trim();
    if (row.key === 'clap') {
      // 拍一拍文案：微信本地按账号隔离存储（「拍了拍」后缀，如「的小脑袋」；空 = 清除回退未设置）
      writeWxClapText(t);
      setClapText(t);
      onToast('拍一拍已保存');
      return;
    }
    if (!t) {
      onToast('内容不能为空');
      return;
    }
    // 全局写回：updateContact 触发 contact-updated 广播，微信 me 快照/联系人 App/设置个人信息同步刷新
    // 名字行 = 微信昵称（Task 32）：社交 App 里我显示的名字就是联系人 App 的「昵称」字段
    //（展示层 socialNameOf：昵称 ?? 真名；改这里立即生效）；真名在联系人 App 里改；
    // 昵称永不进 AI（人设/决策链路只传真名）。清空昵称 = 回退显示真实名字（normalizeText 空串 → null）
    const patch: Partial<ContactRecord> | null =
      row.key === 'name'
        ? { nickname: t }
        : row.key === 'gender'
          ? { gender: t }
          : row.key === 'region'
            ? { region: t }
            : row.key === 'phone'
              ? { phone: t }
              : row.key === 'wechat'
                ? { wechatId: t }
                : null;
    if (!patch) return;
    void updateContact(me.id, patch)
      .then((rec) => onToast(rec ? '已保存' : '保存失败'))
      .catch(() => onToast('保存失败'));
  };
  const clapShown = clapText ? `拍了拍${clapText}` : '未设置';
  const rows: Array<{ key: string; label: string; value: React.ReactNode }> = [
    { key: 'name', label: '名字', value: <span className="block max-w-[190px] truncate">{me.name}</span> },
    { key: 'gender', label: '性别', value: <span className="block max-w-[190px] truncate">{record?.gender || '未设置'}</span> },
    { key: 'region', label: '地区', value: <span className="block max-w-[210px] truncate">{record?.region || '美国边远小岛'}</span> },
    { key: 'phone', label: '手机号', value: <span className="block max-w-[190px] truncate">{maskPhone(me.phone)}</span> },
    { key: 'wechat', label: '微信号', value: <span className="block max-w-[190px] truncate">{me.wechatId || '未设置'}</span> },
    {
      key: 'qr',
      label: '我的二维码',
      value: <QrCode className="h-[20px] w-[20px] text-black/45 dark:text-white/45" strokeWidth={1.7} />,
    },
    { key: 'clap', label: '拍一拍', value: <span className="block max-w-[190px] truncate">{clapShown}</span> },
  ];
  /** 行点击 → 弹修改框（二维码行 toast 占位；其余按 key 取当前值预填） */
  const onRowClick = (key: string, label: string) => {
    if (key === 'qr') {
      onToast('我的二维码暂未开放');
      return;
    }
    if (key === 'clap') {
      openEdit('clap', '拍一拍', clapText);
      return;
    }
    const initial =
      key === 'name'
        ? me.name
        : key === 'gender'
          ? record?.gender || ''
          : key === 'region'
            ? record?.region || ''
            : key === 'phone'
              ? me.phone ?? ''
              : me.wechatId ?? '';
    openEdit(key, label, initial);
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-profile-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">个人资料</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="bg-white dark:bg-[#1A1A1A]">
          {/* 头像行：点击换头像（写 avatars.wx 槽位，仅微信生效；未设置时跟随全局头像） */}
          <button
            type="button"
            data-testid="wx-profile-avatar"
            aria-label="更换头像"
            onClick={() => avatarFileRef.current?.click()}
            className="flex w-full items-center px-4 py-[9px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            <span className="min-w-0 flex-1 text-[17px]">头像</span>
            <WxAvatar src={me.avatar} alt={me.name} size={60} />
            <ChevronRight className="ml-2 h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
          <input ref={avatarFileRef} type="file" accept="image/*" className="hidden" tabIndex={-1} aria-hidden="true" onChange={onAvatarFile} />
          {/* 资料 / 二维码 / 拍一拍行（除二维码外点行均可修改：资料项全局写回，拍一拍文案微信独立） */}
          {rows.map((r, i) => (
            <button
              key={r.key}
              type="button"
              data-testid={`wx-profile-${r.key}`}
              onClick={() => onRowClick(r.key, r.label)}
              className="relative flex w-full items-center px-4 py-[15px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span className="absolute left-4 right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[17px]">{r.label}</span>
              <span className="mr-2 flex min-w-0 items-center justify-end text-right text-[15.5px] text-black/45 dark:text-white/45">
                {r.value}
              </span>
              <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
            </button>
          ))}
        </div>

      </div>
      {/* 资料修改弹窗（名字/性别/地区/手机号/微信号/拍一拍文案）：编辑消息弹窗同款样式 */}
      {editRow && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 px-8" data-testid="wx-profile-edit-layer" onClick={() => setEditRow(null)}>
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#2A2A2C]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pb-1 pt-4 text-center text-[16px] font-medium">修改{editRow.label}</p>
            <div className="px-4 pb-3 pt-2">
              <input
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                maxLength={editRow.key === 'clap' ? 30 : 30}
                autoFocus
                data-testid="wx-profile-edit-input"
                placeholder={editRow.key === 'clap' ? '如：的小脑袋（留空清除）' : `输入新的${editRow.label}`}
                className="w-full rounded-[8px] border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[15px] leading-[1.45] outline-none focus:border-[#07C160] dark:border-white/15 dark:bg-white/[0.06]"
              />
              {editRow.key === 'clap' && (
                <p className="pt-1.5 text-[12px] leading-[1.5] text-black/40 dark:text-white/40">朋友双击你的头像拍一拍时会显示这个后缀</p>
              )}
            </div>
            <div className="flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setEditRow(null)}
                className="h-11 flex-1 text-[16px] active:bg-black/5 dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="wx-profile-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 text-[16px] font-medium text-[#07C160] active:bg-black/5 dark:active:bg-white/10"
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

// ---------------- 微信设置页（含退出登录） ----------------

export function WxSettingsPage({
  onBack,
  onLogout,
  onOpenAccountSwitch,
}: {
  onBack: () => void;
  onLogout: () => void;
  /** 多账号（Task 40-D）：「切换账号」行 → 打开切换子页 */
  onOpenAccountSwitch: () => void;
}) {
  const rows: { label: string; onClick?: () => void; testid?: string }[] = [
    { label: '账号与安全' },
    { label: '青少年模式' },
    { label: '关怀模式' },
    { label: '消息通知' },
    { label: '隐私' },
    { label: '通用' },
    { label: '关于微信' },
  ];
  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      <div className="pt-[54px]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-settings-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">设置</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        <div className="overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          {rows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              data-testid={r.testid}
              onClick={r.onClick}
              className={`flex w-full items-center justify-between px-4 py-3 text-[16px] active:bg-black/5 ${
                i > 0 ? 'border-t border-black/5 dark:border-white/10' : ''
              }`}
            >
              <span>{r.label}</span>
              <ChevronRight className="h-4 w-4 opacity-30" strokeWidth={2} />
            </button>
          ))}
        </div>
        {/* 第三十四轮：「AI 主动消息」全局总开关删除（每角色独立设置入口保留在聊天设置里） */}
        {/* 切换账号：独立卡片行（设置列表外，退出登录上方；用户要求对照截图样式） */}
        <button
          type="button"
          data-testid="wx-account-entry"
          onClick={onOpenAccountSwitch}
          className="mt-4 w-full rounded-[10px] bg-white py-3 text-center text-[16px] active:bg-black/5 dark:bg-[#1A1A1A]"
        >
          切换账号
        </button>
        <button
          type="button"
          data-testid="wx-logout"
          onClick={onLogout}
          className="mt-2.5 w-full rounded-[10px] bg-white py-3 text-center text-[16px] text-red-500 active:bg-black/5 dark:bg-[#1A1A1A]"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}

// ---------------- 切换账号页（多账号 Task 40-D：灰底 + 顶部大标题区 + 账号卡列表 + 添加 + 管理） ----------------

/**
 * 可切换账号列表（Task 41）：大号恒在；小号只显示「登录过」的——登录历史标记 或 存量会话
 * （升级兼容：老用户已登录的小号即使还没历史标记也照常显示）；当前账号保底不消失。
 * 匿名号只属于电话/信息，不进微信。联系人 App 刚创建、从未登录过的小号不出现在这里，
 * 用「登录小号」登录成功后（markAccountLoginHistory）才出现。
 */
export function readSwitchableAccounts(activeId: string): PhoneAccount[] {
  const hist = new Set(accountLoginHistory('wx'));
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

/** 小号/匿名号首字母圆：小号暖色系 / 匿名号灰黑系，深色模式降饱和变体（与 QQ 端同规则） */
export function WxAccountBubble({ name, kind, size = 52 }: { name: string; kind: 'alt' | 'anon'; size?: number }) {
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

/** 微信双气泡 logo（切换账号页顶部灰 logo，第三十三轮对照参考截图：两只带眼睛的对话气泡，evenodd 挖孔） */
export function WxSwitchLogoGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" className={className} aria-hidden="true">
      {/* 大气泡（左上）+ 两只眼睛挖孔 */}
      <path
        fillRule="evenodd"
        d="M25 9C13.4 9 4 16.6 4 26c0 5.3 3 10 7.7 13.1l-2.1 6.5a.9.9 0 0 0 1.3 1l7.9-4.2c2 .5 4 .7 6.2.7h.4a17.4 17.4 0 0 1-.9-5.6c0-8.5 8-15.4 17.9-15.4h.6C40.8 13.9 33.6 9 25 9zm-7 11.2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm14 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"
      />
      {/* 小气泡（右下，尾巴右上）+ 两只眼睛挖孔 */}
      <path
        fillRule="evenodd"
        d="M41.2 24.2c-9.8 0-17.8 6.5-17.8 14.5s8 14.5 17.8 14.5c1.9 0 3.8-.2 5.5-.7l6.9 3.7a.9.9 0 0 0 1.3-1l-1.9-5.7c3.7-2.7 6-6.5 6-10.8 0-8-8-14.5-17.8-14.5zm-5.6 9a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zm11.2 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z"
      />
    </svg>
  );
}

export function WxAccountSwitchPage({ me, onBack, onLoginOther }: { me: WxUser; onBack: () => void; /** 「登录小号」自由登录成功 → 根组件 handleLogin（切作用域 + 记登录历史） */ onLoginOther: (u: WxUser) => void }) {
  // 页内 toast（App 根 toast 在提前 return 分支不渲染，同收藏页口径）
  const [toast, showToast] = useLocalToast();
  // 注册表账号列表：切换不刷新网页（v2 事件驱动）；删除成功后本地同步移除
  //（当前账号/大号不可删；正在被其他 App 使用的账号删除时自动切回大号 = 自动退出）
  // 匿名号不进微信（只属于电话/信息）：列表与切换一律排除。
  // 多账号 Task 41：只显示「登录过」的小号（登录历史 / 存量会话兼容 / 当前账号保底）——
  // 联系人 App 刚创建、从未登录过的小号不进列表，用下方「登录小号」登录后才出现。
  const [accounts, setAccounts] = useState<PhoneAccount[]>(() => readSwitchableAccounts(getActiveAccountIdFor('wx')));
  // 当前微信账号 id（per-app）：切换事件到达时刷新快照（页面会随 MainScreen 复位跳回主界面，
  // 监听仅作兜底同步，绿点在跳转前一瞬已是新账号）
  const [activeId, setActiveId] = useState(() => getActiveAccountIdFor('wx'));
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; id?: string }>).detail;
      if (!d || d.app !== 'wx') return;
      setAccounts(readSwitchableAccounts(getActiveAccountIdFor('wx')));
      setActiveId(getActiveAccountIdFor('wx'));
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, fn);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, fn);
  }, []);
  /** 「登录小号」自由登录墙（覆盖全页；slot=null 不绑定槽位，用任意小号账密登录）
   *  第三十四轮：「添加账号」也走这里——不再有新建账号弹层，添加账号 = 用账号密码登录 */
  const [loginOpen, setLoginOpen] = useState(false);
  /** 大号机主资料（跨账号直读大号库；不能用 me——小号视角下 me 是小号身份，Task 40-F 修正） */
  const [mainOwner, setMainOwner] = useState<{ name: string; wechatId: string; avatar: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void mainOwnerContact().then((o) => {
      if (alive) setMainOwner(o ? { name: o.name?.trim() ?? '', wechatId: o.wechatId?.trim() ?? '', avatar: o.avatar } : null);
    });
    return () => {
      alive = false;
    };
  }, []);
  // 账号卡显示名（Task 40-S）：与登录后 App 内的展示口径一致——档案联系人展示名（备注>昵称>名字）优先，
  // 注册表名兼底。否则小号设了昵称后「切换账号以后名字跟切换账号那里不一样」。
  const [profiles, setProfiles] = useState<ContactRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void listContacts()
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
  /** 管理模式：非当前、非大号的卡片左上出现 ⊖ 删除钮 */
  const [managing, setManaging] = useState(false);
  /** 删除二次确认目标（受控弹窗，禁 window.confirm） */
  const [delTarget, setDelTarget] = useState<PhoneAccount | null>(null);
  /** 删除时是否保留数据（规则：删除账号后数据是否保留由用户决定；默认不保留） */
  const [delKeepData, setDelKeepData] = useState(false);

  const confirmDelete = async () => {
    const target = delTarget;
    if (!target) return;
    setDelTarget(null);
    // v2 deleteAccount 为 async：正在使用中的账号删除时自动切回大号（退出该账号），不拦截；
    // keepData：保留该账号的聊天/记忆等本地数据（孤儿化不可见）
    const res = await deleteAccount(target.id, { keepData: delKeepData });
    setDelKeepData(false);
    if (res.ok) {
      setAccounts(getAccounts());
      setManaging(false);
      showToast(delKeepData ? '已删除该账号（数据已保留）' : '已删除该账号');
    } else {
      showToast(res.error || '删除失败');
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏：返回 + 管理/完成（第三十三轮对照参考图：去居中标题，管理改黑色；有多个账号才显示管理） */}
      <div className="pt-[54px]">
        <div className="relative flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-account-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          {accounts.length > 1 && (
            <button
              type="button"
              data-testid="wx-account-manage"
              onClick={() => {
                setDelTarget(null);
                setManaging((v) => !v);
              }}
              className="ml-auto mr-1 min-w-[44px] text-right text-[16px] text-black/85 active:opacity-60 dark:text-white/85"
            >
              {managing ? '完成' : '管理'}
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-7">
        {/* 顶部：微信双气泡灰 logo + 大字 + 短分隔线（第三十三轮对照参考截图重做） */}
        <div className="flex flex-col items-center" data-testid="wx-account-header">
          <WxSwitchLogoGlyph className="h-[58px] w-[58px] text-black/[0.15] dark:text-white/[0.15]" />
          <p className="mt-[58px] text-[24px] font-semibold tracking-[0.5px] text-black/90 dark:text-white/90">轻触头像以切换账号</p>
          <span className="mb-8 mt-7 h-px w-[190px] bg-black/[0.12] dark:bg-white/[0.14]" />
        </div>

        {/* 账号卡列表：白卡（深色深灰卡）；当前账号绿点 +「当前使用」；点其他卡 → switchAccountFor('wx') */}
        <div className="space-y-3.5">
          {accounts.map((acc) => {
            const isCurrent = acc.id === activeId;
            const isMain = acc.id === MAIN_ACCOUNT_ID;
            // 显示名与登录后一致（Task 40-S）：大号=机主联系人展示名（昵称优先），小号=档案展示名，回退注册表
            const mainProfile = profiles.find((c) => c.kind === 'user' && !c.altOf) ?? null;
            const name = isMain
              ? (mainProfile ? socialNameOf(mainProfile) : '') || mainOwner?.name || '机主'
              : (profileOf(acc) ? socialNameOf(profileOf(acc)!) : '') || acc.name;
            const wxid = isMain ? mainOwner?.wechatId || acc.wechatId : acc.kind === 'anon' ? acc.phone : acc.wechatId;
            const showDelete = managing && !isCurrent && !isMain;
            return (
              <div key={acc.id} className="relative">
                {showDelete && (
                  <button
                    type="button"
                    aria-label={`删除账号${name}`}
                    data-testid={`wx-account-delete-${acc.id}`}
                    onClick={() => setDelTarget(acc)}
                    className="absolute -left-3 -top-3 z-10 grid h-11 w-11 place-items-center active:opacity-70"
                  >
                    <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[#FA5151] shadow-sm" aria-hidden="true">
                      <span className="block h-[2px] w-[10px] rounded-full bg-white" />
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`wx-account-card-${acc.id}`}
                  onClick={() => {
                    if (managing || isCurrent) return;
                    // v2 不刷新：写 per-app 标记 + 派发事件；本页监听刷新绿点，根组件重读数据/登录态
                    switchAccountFor('wx', acc.id);
                  }}
                  className="flex w-full items-center gap-3.5 rounded-[16px] bg-white px-4 py-[18px] text-left active:bg-black/[0.04] dark:bg-[#1A1A1A]"
                >
                  {(() => {
                    // 第三十二轮：切换账号页头像跟随微信——每个账号显示自己档案的微信槽位头像（avatars.wx），
                    // 没设过微信头像时：大号回退机主全局头像，小号/匿名号回退首字母彩色圆
                    const prof = isMain ? mainProfile : profileOf(acc);
                    const accAvatar = prof?.avatars?.wx ?? (isMain ? mainOwner?.avatar ?? null : null);
                    return accAvatar ? (
                      <WxAvatar src={accAvatar} alt={name} size={52} />
                    ) : (
                      <WxAccountBubble name={name} kind={acc.kind === 'anon' ? 'anon' : 'alt'} size={52} />
                    );
                  })()}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="block truncate text-[17px] font-medium">{name}</span>
                      {/* 第三十二轮：「大号/小号」徽标删除——列表里都是可登录的账号，不再分档位 */}
                    </span>
                    <span className="mt-1 block truncate text-[13px] text-black/35 dark:text-white/35">{wxid || '未设置'}</span>
                  </span>
                  {isCurrent && (
                    <span className="flex shrink-0 items-center gap-1.5" aria-label="当前使用">
                      <span className="h-2 w-2 rounded-full bg-[#07C160]" aria-hidden="true" />
                      <span className="text-[14px] text-black/85 dark:text-white/85">当前使用</span>
                    </span>
                  )}
                </button>
              </div>
            );
          })}

          {/* 添加账号（第三十四轮：弹层删除，点击直接打开账号密码登录墙；账号在联系人 App 创建，
              登录成功后出现在上面的列表）：保留参考图白卡 + 虚线圆角方块样式 */}
          <button
            type="button"
            data-testid="wx-account-add"
            onClick={() => setLoginOpen(true)}
            className="flex h-[76px] w-full items-center gap-3.5 rounded-[16px] bg-white px-4 text-left active:bg-black/[0.04] dark:bg-[#1A1A1A]"
          >
            <span
              className="grid h-[48px] w-[48px] shrink-0 place-items-center rounded-[10px] border-[1.5px] border-dashed border-black/20 text-black/35 dark:border-white/25 dark:text-white/35"
              aria-hidden="true"
            >
              <Plus className="h-[22px] w-[22px]" strokeWidth={1.6} />
            </span>
            <span className="text-[15.5px] text-black/80 dark:text-white/80">添加账号</span>
          </button>

          {/* 第三十四轮：「登录账号」入口卡删除——「添加账号」本身就是账号密码登录，不再重复 */}
        </div>
      </div>

      {/* 登录小号：自由登录墙覆盖层（slot=null 不绑定槽位；返回关闭不退出微信）；「添加账号」同用此登录墙 */}
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

      {/* 删除二次确认（微信风受控弹窗）：默认清数据；可勾选「保留数据」由用户决定（规则六） */}
      {delTarget && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-8" onClick={() => setDelTarget(null)}>
          <div
            role="dialog"
            aria-label={`删除账号${delTarget.name}`}
            className="w-full max-w-[320px] rounded-[10px] bg-white p-5 dark:bg-[#1A1A1A]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[16px] font-medium">删除账号</p>
            <p className="mt-2.5 text-[13.5px] leading-[1.7] text-black/70 dark:text-white/70">
              将删除「{delTarget.name}」的账号与登录态；若微信、QQ 等正在使用该账号，会自动退出并回到大号。此操作不可恢复。
            </p>
            <label
              data-testid="wx-account-delete-keep"
              className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-[8px] bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.06]"
            >
              <input
                type="checkbox"
                checked={delKeepData}
                onChange={(e) => setDelKeepData(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#07C160]"
              />
              <span className="text-[13px] leading-[1.6] text-black/70 dark:text-white/70">保留该账号的数据（聊天记录、记忆、朋友圈等；数据不可见也无法恢复登录）</span>
            </label>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                data-testid="wx-account-delete-cancel"
                onClick={() => setDelTarget(null)}
                className="h-10 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-80 dark:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="wx-account-delete-confirm"
                onClick={confirmDelete}
                className="h-10 flex-1 rounded-[8px] bg-[#FA5151] text-[14px] font-medium text-white active:opacity-80"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <LocalToast msg={toast} />
    </div>
  );
}

// ---------------- 收藏页（「我」tab 收藏入口；数据在 @/lib/msg-favorites） ----------------

export function WxFavoritesPage({ onBack }: { onBack: () => void; onToast?: (m: string) => void }) {
  // 收藏页在 App 根提前 return 的分支里，App 根 toast 不渲染 → 页内自带 toast
  const [toast, showToast] = useLocalToast();
  const onToast = showToast;
  const [list, setList] = useState<MsgFavorite[]>(() => loadFavorites('wx'));

  const del = (id: string) => {
    removeFavorite('wx', id);
    setList((prev) => prev.filter((x) => x.id !== id));
    onToast('已删除收藏');
  };

  return (
    <div className="relative flex h-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white">
      {/* 顶栏（微信灰同聊天页） */}
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-fav-back"
            onClick={onBack}
            className="flex items-center px-1 active:opacity-50"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex flex-1 items-center justify-center pr-9">
            <span className="text-[17px] font-medium">收藏</span>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-24 text-black/35 dark:text-white/35" data-testid="wx-fav-empty">
            <Star className="h-10 w-10" strokeWidth={1.2} />
            <p className="text-[13px]">暂无收藏 · 长按聊天消息可收藏</p>
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((f) => (
              <div key={f.id} data-testid="wx-fav-item" className="rounded-[10px] bg-white p-3 dark:bg-[#1A1A1A]">
                <div className="flex items-center gap-2">
                  <WxAvatar src={f.contactAvatar} alt={f.contactName} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/60 dark:text-white/60">{f.contactName}</span>
                  <span className="shrink-0 text-[11px] text-black/35 dark:text-white/35">
                    {f.msgRole === 'me' ? '我' : '对方'} · {fmtChatTime(f.time)}
                  </span>
                  <button
                    type="button"
                    aria-label="删除收藏"
                    data-testid="wx-fav-del"
                    onClick={() => del(f.id)}
                    className="shrink-0 text-black/30 active:opacity-60 dark:text-white/30"
                  >
                    <Trash2 className="h-[16px] w-[16px]" strokeWidth={1.8} />
                  </button>
                </div>
                <div className="mt-2 rounded-[6px] bg-black/[0.03] px-2.5 py-2 dark:bg-white/[0.05]">
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


// ---------------- 看一看页（发现页 › 看一看：轻量内容流） ----------------

/** 看一看轻量内容流（标题 + 来源 + 阅读量） */
export const LOOK_FEED: { title: string; source: string; reads: string }[] = [
  { title: '两个人最舒服的相处方式，是「分享欲」一直在', source: '情感研究所', reads: '12.6万' },
  { title: '把日常拍成电影感：手机光影小技巧合集', source: '摄影日记', reads: '8.3万' },
  { title: '今天也要好好吃饭：一周家常菜单灵感', source: '下厨房生活家', reads: '23.1万' },
  { title: '那些藏在聊天记录里的小心动', source: '夜谈心', reads: '5.7万' },
];

/** 看一看页（第二十二轮美化）：玻璃卡 22px + 胶囊控件 + 弱标题，
 *  space-y-7 统一节奏、纯色底（无底层光斑）。装扮入口已移至「发现」页 › 主题（末尾，原小程序位）。 */
export function WxLookPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#F6F7F9] text-black dark:bg-[#111214] dark:text-white" data-testid="wx-look-page">
      {/* 顶部玻璃条：同色半透 + blur，滚动时内容从底下晕开 */}
      <div className="shrink-0 bg-[#F6F7F9]/75 pt-[54px] backdrop-blur-xl dark:bg-[#111214]/75">
        <div className="relative flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-look-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold">看一看</div>
        </div>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 space-y-7 overflow-y-auto px-4 pb-10 pt-3">
        {/* 轻量内容流：独立玻璃卡 · 标题 + 来源胶囊 + 阅读量 */}
        <section aria-label="大家都在看">
          <p className="px-2 text-[12.5px] font-semibold tracking-wide text-black/40 dark:text-white/40">大家都在看</p>
          <div className="mt-2.5 space-y-2.5">
            {LOOK_FEED.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onToast('内容即将上线')}
                className="flex w-full items-center gap-3 rounded-[22px] bg-white/60 px-4 py-3.5 text-left backdrop-blur-xl ring-1 ring-white/70 transition-transform active:scale-[0.98] dark:bg-white/[0.06] dark:ring-white/[0.12]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-medium leading-snug">{f.title}</span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="rounded-full bg-black/[0.05] px-2 py-[2px] text-[10.5px] font-medium text-black/50 dark:bg-white/[0.08] dark:text-white/50">{f.source}</span>
                    <span className="text-[10.5px] text-black/35 dark:text-white/35">{f.reads}阅读</span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-black/20 dark:text-white/20" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}


// ---------------- 搜索页（对照微信真机：返回 + 搜索框「搜索本地或网络结果」+ 最近在搜 + 本地/网络结果） ----------------

/** 搜索历史持久化键（最近 10 条，新搜在前去重） */
export const WX_SEARCH_HISTORY_KEY = 'wx-search-history';
export const WX_SEARCH_HISTORY_MAX = 10;

/** 网络结果条目（GET /api/search 返回） */
export interface WebSearchResult {
  name: string;
  url: string;
  snippet: string;
  host_name: string;
  date: string;
  favicon: string;
}

/** 聊天记录搜索命中（含所属会话，点击跳回对应聊天） */
export interface MsgSearchHit {
  key: string;
  title: string;
  avatar: string | null;
  isGroup: boolean;
  group: ChatGroup | null;
  contact: ContactRecord | null;
  senderLabel: string;
  text: string;
  time: number;
}

/** 各类消息规整成可搜索文本（图片/撤回不入搜索，与聊天页 ChatSearchItem 同口径） */
export function wxMsgSearchText(m: WxMsg): string {
  if (m.kind === 'sticker' && m.stk) return m.stk.meaning ? `[表情] ${m.stk.meaning}` : '[表情]';
  if (m.kind === 'redpacket' && m.rp) return `[红包] ${m.rp.blessing}`;
  if (m.kind === 'transfer' && m.tr) return `[转账] ${m.tr.note}`;
  if (m.kind === 'family') return '[亲属卡]';
  if (m.kind === 'location' && m.loc) return `[位置] ${m.loc.name}${m.loc.address ? ` ${m.loc.address}` : ''}`;
  if (m.kind === 'notice' && m.notice) return `${m.notice.pre}${m.notice.accent}`;
  if (m.kind === 'voice') return m.voice?.transcript || m.voice?.localText ? `[语音] ${m.voice?.transcript || m.voice?.localText}` : '[语音]';
  return m.content;
}

export function WxSearchPage({
  me,
  friends,
  groups,
  moments,
  onBack,
  onOpenChat,
  onOpenGroup,
  onOpenMoments,
  onToast,
}: {
  me: WxUser;
  friends: ContactRecord[];
  groups: ChatGroup[];
  moments: WxMoment[];
  onBack: () => void;
  onOpenChat: (c: ContactRecord) => void;
  onOpenGroup: (g: ChatGroup) => void;
  onOpenMoments: () => void;
  onToast: (m: string) => void;
}) {
  const [kw, setKw] = useState('');
  const [hist, setHist] = useState<string[]>(() => loadStrList(WX_SEARCH_HISTORY_KEY));
  /** 网络结果：null = 未请求；配合 webState 渲染加载/失败/空态 */
  const [webResults, setWebResults] = useState<WebSearchResult[]>([]);
  const [webState, setWebState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const reqSeqRef = useRef(0);
  // 第五十六轮：古早/液态皮肤（搜索页是用户点名的「未应用界面」之一）——
  // 古早 = 复古纸底 + 银灰导航条 + 白底内凹搜索框；液态 = 玻璃搜索胶囊
  const skin = useChatSkin();
  // 跨 App：点网络结果 → 打开浏览器 App 导航到该网页
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingBrowserUrl = useUI((s) => s.setPendingBrowserUrl);

  const key = kw.trim().toLowerCase();

  /** 网络结果：关键词变化防抖 600ms 请求 /api/search（竞态用序号守卫；setState 均在定时器/异步回调内） */
  useEffect(() => {
    const q = kw.trim();
    const seq = ++reqSeqRef.current;
    const timer = window.setTimeout(() => {
      if (!q) {
        setWebState('idle');
        setWebResults([]);
        return;
      }
      setWebState('loading');
      fetch(`/api/search?q=${encodeURIComponent(q)}&num=5`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: { results?: WebSearchResult[] }) => {
          if (seq !== reqSeqRef.current) return;
          setWebResults(Array.isArray(data.results) ? data.results : []);
          setWebState('done');
        })
        .catch(() => {
          if (seq !== reqSeqRef.current) return;
          setWebResults([]);
          setWebState('error');
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [kw]);

  /** 命中联系人：备注/昵称/名字/微信号匹配（微信好友） */
  const hitContacts = useMemo<ContactRecord[]>(() => {
    if (!key) return [];
    return friends
      .filter(
        (c) =>
          displayNameOf(c).toLowerCase().includes(key) ||
          c.name.toLowerCase().includes(key) ||
          (c.wechatId ?? '').toLowerCase().includes(key)
      )
      .slice(0, 5);
  }, [friends, key]);

  /** 命中群聊：群备注/群名匹配 */
  const hitGroups = useMemo<ChatGroup[]>(() => {
    if (!key) return [];
    return groups.filter((g) => (g.remark || g.name).toLowerCase().includes(key)).slice(0, 5);
  }, [groups, key]);

  /** 命中聊天记录：全量会话（好友 + 群）按摘要文本匹配，最新在前取 6 条 */
  const hitMsgs = useMemo<MsgSearchHit[]>(() => {
    if (!key) return [];
    const hits: MsgSearchHit[] = [];
    for (const c of friends) {
      for (const m of loadMsgs(c.id)) {
        if (m.kind === 'image' || m.recalled) continue;
        const text = wxMsgSearchText(m);
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
          key: groupRowId(g.id),
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
     
  }, [key, friends, groups]);

  /** 命中朋友圈：正文/作者匹配取 3 条 */
  const hitMoments = useMemo<WxMoment[]>(() => {
    if (!key) return [];
    return moments
      .filter((p) => p.text.toLowerCase().includes(key) || p.authorName.toLowerCase().includes(key))
      .slice(0, 3);
  }, [moments, key]);

  /** 记录搜索词：去重后置顶，最多保留 10 条。
   *  注意直接同步写 localStorage（不走 setHist updater）——点网页结果会立刻切到浏览器 App、
   *  本页随之卸载，updater 会被 React 丢弃导致历史丢失 */
  const pushHist = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const next = [t, ...hist.filter((x) => x !== t)].slice(0, WX_SEARCH_HISTORY_MAX);
    saveStrList(WX_SEARCH_HISTORY_KEY, next);
    setHist(next);
  };
  const clearHist = () => {
    saveStrList(WX_SEARCH_HISTORY_KEY, []);
    setHist([]);
    onToast('已清空搜索历史');
  };
  const openWeb = (url: string) => {
    setPendingBrowserUrl(url);
    switchToApp('browser');
  };

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const hasLocal = hitContacts.length + hitGroups.length + hitMsgs.length + hitMoments.length > 0;
  // 输入被清空时立即隐藏「网页」分区（webState 复位在防抖回调里，渲染层先拉住不闪旧结果）
  const showWeb = kw.trim() !== '' && webState !== 'idle';

  return (
    <div
      className={`absolute inset-0 z-40 flex h-full w-full flex-col text-black dark:text-white ${
        skin.retro
          ? /* 古早：复古纸底（白卡交给下方分区行自带） */ 'rt-root'
          : skin.liquid
            ? /* 液态：液态根渐变 */ 'lg-root'
            : 'bg-white dark:bg-[#111111]'
      }`}
    >
      {/* 顶栏：返回 + 搜索框（对照截图 1）；古早 = 银灰拟物导航条 + 白底内凹搜索框 */}
      <div className={`shrink-0 pt-[54px] ${skin.retro ? 'rt-bar' : ''}`}>
        <div className="flex h-12 items-center gap-1.5 px-2 pb-1">
          <button
            type="button"
            aria-label="返回"
            data-testid="wx-search-back"
            onClick={onBack}
            className={`shrink-0 active:opacity-50 ${skin.retro ? 'text-[#3A3E4C]' : 'rounded-full p-1'}`}
          >
            <ChevronLeft className={`h-[23px] w-[23px] ${skin.retro ? 'font-bold' : ''}`} strokeWidth={skin.retro ? 2.4 : 2.2} />
          </button>
          <div
            className={`flex h-[34px] min-w-0 flex-1 items-center gap-2 px-3 ${
              skin.retro
                ? /* 古早：白底内凹硬边搜索框 */ 'rt-search'
                : skin.liquid
                  ? /* 液态：玻璃搜索胶囊 */ 'lg-search rounded-full'
                  : 'rounded-[8px] bg-black/[0.05] dark:bg-white/[0.08]'
            }`}
          >
            <Search className={`h-4 w-4 shrink-0 ${skin.retro ? 'text-[#6A6E78]' : 'text-black/30 dark:text-white/30'}`} strokeWidth={2.2} aria-hidden="true" />
            <input
              autoFocus
              type="text"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') pushHist(kw);
              }}
              placeholder="搜索本地或网络结果"
              data-testid="wx-search-input"
              aria-label="搜索本地或网络结果"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
            {kw && (
              <button type="button" aria-label="清空" data-testid="wx-search-clear" onClick={() => setKw('')} className="shrink-0 active:opacity-60">
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-black/25 text-[10px] leading-none text-white dark:bg-white/30">
                  ×
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {!key ? (
          /* 最近在搜（对照截图 1：标题 + 垃圾桶清空 + 时钟历史项） */
          hist.length > 0 && (
            <div className="px-4 pt-3" data-testid="wx-search-history">
              <div className="flex items-center justify-between">
                <span className="text-[15px] text-black/45 dark:text-white/45">最近在搜</span>
                <button
                  type="button"
                  aria-label="清空搜索历史"
                  data-testid="wx-search-history-clear"
                  onClick={clearHist}
                  className="p-1 text-black/35 active:opacity-60 dark:text-white/35"
                >
                  <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.9} />
                </button>
              </div>
              <div className="mt-1">
                {hist.map((h) => (
                  <button
                    key={h}
                    type="button"
                    data-testid="wx-search-history-item"
                    onClick={() => setKw(h)}
                    className="flex h-[46px] w-full items-center gap-3 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
                  >
                    <Clock className="h-[18px] w-[18px] shrink-0 text-black/30 dark:text-white/30" strokeWidth={1.8} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{h}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          <>
            {!hasLocal && !showWeb && (
              <p className="mt-16 text-center text-[14px] text-black/35 dark:text-white/35" data-testid="wx-search-empty">
                暂无搜索结果
              </p>
            )}

            {/* 联系人 */}
            {hitContacts.length > 0 && (
              <section data-testid="wx-search-contacts">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">联系人</p>
                {hitContacts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-testid={`wx-search-contact-${c.id}`}
                    onClick={() => {
                      pushHist(kw);
                      onOpenChat(c);
                    }}
                    className="flex h-[54px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <WxAvatar src={c.avatar} alt={displayNameOf(c) || c.name} size={38} />
                    <span className="min-w-0 flex-1 truncate text-[15.5px]">{displayNameOf(c) || c.name}</span>
                    <span className="shrink-0 text-[12px] text-black/30 dark:text-white/30">发消息</span>
                  </button>
                ))}
              </section>
            )}

            {/* 群聊 */}
            {hitGroups.length > 0 && (
              <section data-testid="wx-search-groups">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">群聊</p>
                {hitGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    data-testid={`wx-search-group-${g.id}`}
                    onClick={() => {
                      pushHist(kw);
                      onOpenGroup(g);
                    }}
                    className="flex h-[54px] w-full items-center gap-3 px-4 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <GroupAvatar group={g} contacts={friends} size={38} />
                    <span className="min-w-0 flex-1 truncate text-[15.5px]">{g.remark || g.name}</span>
                    <span className="shrink-0 text-[12px] text-black/30 dark:text-white/30">{g.memberIds.length + 1}人</span>
                  </button>
                ))}
              </section>
            )}

            {/* 聊天记录 */}
            {hitMsgs.length > 0 && (
              <section data-testid="wx-search-msgs">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">聊天记录</p>
                {hitMsgs.map((h, i) => (
                  <button
                    key={`${h.key}-${h.time}-${i}`}
                    type="button"
                    data-testid="wx-search-msg-item"
                    onClick={() => {
                      pushHist(kw);
                      if (h.isGroup && h.group) onOpenGroup(h.group);
                      else if (h.contact) onOpenChat(h.contact);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    {h.isGroup && h.group ? (
                      <span className="shrink-0">
                        <GroupAvatar group={h.group} contacts={friends} size={38} />
                      </span>
                    ) : (
                      <WxAvatar src={h.avatar} alt={h.title} size={38} />
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

            {/* 朋友圈 */}
            {hitMoments.length > 0 && (
              <section data-testid="wx-search-moments">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">朋友圈</p>
                {hitMoments.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid="wx-search-moment-item"
                    onClick={() => {
                      pushHist(kw);
                      onOpenMoments();
                    }}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <WxAvatar src={p.avatar} alt={p.authorName} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-black/45 dark:text-white/45">{p.authorName}</span>
                        <span className="shrink-0 text-[11px] text-black/25 dark:text-white/25">{fmtTime(p.time)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[14.5px] leading-snug">{p.text}</span>
                    </span>
                  </button>
                ))}
              </section>
            )}

            {/* 网页（网络结果） */}
            {showWeb && (
              <section data-testid="wx-search-web">
                <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">网页</p>
                {webState === 'loading' && (
                  <div className="px-4 py-4" data-testid="wx-search-web-loading">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="mb-4 animate-pulse">
                        <div className="h-[14px] w-3/4 rounded bg-black/10 dark:bg-white/10" />
                        <div className="mt-2 h-[12px] w-full rounded bg-black/[0.06] dark:bg-white/[0.06]" />
                        <div className="mt-1.5 h-[12px] w-2/3 rounded bg-black/[0.06] dark:bg-white/[0.06]" />
                      </div>
                    ))}
                  </div>
                )}
                {webState === 'error' && (
                  <p className="px-4 py-3 text-[13px] text-black/35 dark:text-white/35">网络搜索失败，请稍后重试</p>
                )}
                {webState === 'done' && webResults.length === 0 && (
                  <p className="px-4 py-3 text-[13px] text-black/35 dark:text-white/35">没有相关网页</p>
                )}
                {webState === 'done' &&
                  webResults.map((r) => (
                    <button
                      key={r.url}
                      type="button"
                      data-testid="wx-search-web-item"
                      onClick={() => {
                        pushHist(kw);
                        openWeb(r.url);
                      }}
                      className="flex w-full items-start gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                    >
                      <span className="mt-0.5 grid h-[38px] w-[38px] shrink-0 place-items-center overflow-hidden rounded-[8px] bg-black/[0.05] dark:bg-white/[0.08]">
                        {r.favicon ? (
                          <img src={r.favicon} alt="" aria-hidden="true" className="h-5 w-5 object-contain" />
                        ) : (
                          <Globe className="h-5 w-5 text-black/35 dark:text-white/35" strokeWidth={1.8} aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 block text-[15px] font-medium leading-snug">{r.name || r.host_name}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-black/50 dark:text-white/50">{r.snippet}</span>
                        <span className="mt-1 block truncate text-[11px] text-black/30 dark:text-white/30">
                          {r.host_name}
                          {r.date ? ` · ${r.date}` : ''}
                        </span>
                      </span>
                    </button>
                  ))}
              </section>
            )}
          </>
        )}
      </div>
      <span className="sr-only">{me.name}的微信搜索</span>
    </div>
  );
}
