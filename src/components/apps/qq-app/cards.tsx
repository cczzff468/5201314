'use client';

/** 红包/转账/亲属卡/群卡片/位置/支付方式与密码 UI —— v1.9.27 任务10 从 qq.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Check, ChevronLeft, ChevronRight, Clock, Delete, Fingerprint, Gift, MapPin, SquarePen, Undo2, Users, Wallet, X } from 'lucide-react';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
// 美团×AI 联动：QQ 私聊与微信同构接入（规则注入+动作执行），历史里的代付/分享/代点卡片序列化为 AI 可读文本
// Task 40 错误提示优化：错误分类文案 + 连续失败冷却 + 错误详情（居中灰字提示行用，原始报错不直接展示）
// Task 40 草稿箱：输入框文本按会话隔离持久化（刷新/切会话回来不丢，发送成功清空；不进 AI 上下文）
// Task 40 错误提示行：失败消息位置渲染的居中灰字（点击重试/长按菜单）
// 第十六轮：AI 动态状态（情绪+作息）注入
import { // 【fix3-d-4】引擎统一动态视图：转发弹层用显式 author 判定原作者（不再按名字猜）
  listMomentPosts, // 【20-d】升级图重新生成（A2）：长按/右键升级过的真图打开弹层重绘（预填上次描述）
  regenerateMomentImage } from '@/lib/moments';
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// 多账号 v2（Task 40-2b）：kv 裸键自动按 qq 当前账号作用域；purge 限账号用 kvKeysByPrefix+kvDelRaw
// 多账号（Task 40 v2）：注册表/切换/创建走 per-app accounts API；QQ 登录态等 LS 键每次经 accLs(key,'qq')
// 现算（大号原键，小号 --{id} 后缀）；切换账号不刷新网页，根组件监听 ACCOUNT_CHANGED_EVENT 重读
// 头像按 App 隔离：QQ 端读取/写入一律走 qq 槽位（listContactsFor 投影读取，updateContact 的 avatars 合并写入），不再共享联系人 App 的全局默认头像
// 古早主题（retro）：复古 Tab 图标 + 拟物图标底座 + 配色表（QQ 版）
// 生图（锁脸）：照片标签（[图片:描述]/[照片:描述]）提取/生成/规则构建（与微信端共用同一逻辑层，未配置/失败降级文字图片卡片）；
// 手动「文字图片」为卡片版（autoCardText），不走生图
// 【20-d】补充流式分段 carry-over 工具（splitUnfinishedPhotoTag/stripUnfinishedPhotoTag）：
// 流式把 [图片:xxx] 标签切成两段时跨段拼接还原 + 尾部半截标签兜底剥除（与微信/信息端同口径）
import type { ContactRecord } from '@/lib/contacts';
import { type GroupCardData } from '@/lib/ios/group-social';

import { MsgLoc, MsgPacket, QQFamData, QQMsg, QQUser, QQ_BLUE } from './core';
import { BANK_FALLBACK, BANK_META, BankCard, QqPayPwdLockData, WalletData, fmtMoney, loadPayPwd, qqClearPayPwdLock, qqLoadPayPwdLock, qqRecordPayPwdFail, qqSavePayPwdLock, sanitizeAmount, savePayPwd } from './wallet';
import { WalletNavHeader } from './wallet-pages';
import { QqAvatar } from './widgets';

// ---------------- 红包 / 转账（聊天加号面板 → 发送卡片 → 点击进详情） ----------------

/** 红包小图标（加号面板用，红色信封；单聊/群聊共用） */
export function RpIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M4 7.5c5 3.4 11 3.4 16 0" />
      <circle cx="12" cy="12.6" r="2.1" />
    </svg>
  );
}

/** 红包卡片上的奶油色企鹅剪影（对照 QQ 红包封面） */
export function RpPenguin({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <ellipse cx="20" cy="18.5" rx="10.5" ry="12.5" fill="#FBE7B2" />
      <ellipse cx="20" cy="22" rx="6.4" ry="7.6" fill="#E85B54" opacity="0.55" />
      <circle cx="15.9" cy="13.6" r="2.5" fill="#FFF6DC" />
      <circle cx="24.1" cy="13.6" r="2.5" fill="#FFF6DC" />
      <circle cx="16.4" cy="14" r="1.1" fill="#C9402F" />
      <circle cx="23.6" cy="14" r="1.1" fill="#C9402F" />
      <path d="M16 17.8c1.5 1.5 6.5 1.5 8 0 .8 1.3-1.5 3.6-4 3.6s-4.8-2.3-4-3.6z" fill="#E8912D" />
    </svg>
  );
}

/** 红包封面大企鹅剪影暗纹（纯剪影，供封面纹样层用） */
export function RpPenguinSilhouette({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <ellipse cx="20" cy="18.5" rx="10.5" ry="12.5" fill="rgba(196,32,48,0.16)" />
      <ellipse cx="20" cy="23" rx="6.6" ry="8" fill="rgba(196,32,48,0.10)" />
      <path d="M11.5 29.5c1.6 2.8 5 4.7 8.5 4.7s6.9-1.9 8.5-4.7c-1.1 4.9-4.5 8.1-8.5 8.1s-7.4-3.2-8.5-8.1z" fill="rgba(196,32,48,0.16)" />
    </svg>
  );
}

/** 红包封面纹样层（对照真机封面：右侧细密斜线纹理 + 左上圆弧线 + 菱形描边 + 大企鹅剪影暗纹），绝对定位铺满父容器 */
export function RpCoverPattern() {
  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* 右侧竖向斜线纹理区 */}
      <span
        className="absolute inset-y-0 right-0 w-[36%] opacity-75"
        style={{ backgroundImage: 'repeating-linear-gradient(112deg, rgba(255,235,200,0.13) 0px, rgba(255,235,200,0.13) 1.5px, transparent 1.5px, transparent 6.5px)' }}
      />
      {/* 左上大圆弧线 */}
      <span className="absolute -left-12 -top-16 h-48 w-48 rounded-full border-[3px] border-white/[0.09]" />
      {/* 中左菱形描边 */}
      <span className="absolute -left-3 top-[42%] h-20 w-20 rotate-45 rounded-[16%] border-[3px] border-white/[0.08]" />
      {/* 右侧大企鹅剪影暗纹 */}
      <RpPenguinSilhouette className="absolute -right-7 top-[24%] h-44 w-40" />
    </span>
  );
}

/** 聊天中的红包卡片（对照真机封面：企鹅+QQ字样+祝福语+右侧斜线纹理/圆弧/菱形/企鹅暗纹+底部亮红大弧+開/QQ红包；自己发的点开进详情，对方的先开箱） */
export function RedPacketBubble({ packet, showOpen, onClick }: { packet: MsgPacket; showOpen: boolean; onClick: () => void }) {
  const claimed = (packet.claims ?? []).length > 0;
  // 终态：已领取/已退回/已拒收/已过期（24h 未领取清算，剩余金额退回发起人）
  const settled = claimed || packet.status === 'returned' || packet.status === 'rejected' || packet.expired;
  // 终态（已领取/已退回/已拒收/已过期）→ 显示原状态文案；待领取中 → 有祝福语显示祝福语、没写祝福语显示「待领取」（与转账卡留言规则一致）
  const rpNote = settled
    ? packet.expired
      ? '已过期'
      : packet.status === 'returned'
      ? '已退回'
      : packet.status === 'rejected'
        ? '已拒收'
        : '已领取'
    : packet.note && packet.note.trim()
      ? packet.note
      : '待领取';
  return (
    <button
      type="button"
      data-testid="qq-rp-bubble"
      onClick={onClick}
      className="chat-card chat-card-rp chat-card-body relative block w-[176px] overflow-hidden rounded-[14px] text-left shadow-lg shadow-black/15 transition-all duration-300 active:scale-[0.97]"
      style={{
        backgroundImage: 'linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%)',
        // 领取/退还/拒收后卡片颜色变灰（对照真实 QQ：已领取的红包封面褪色）
        filter: settled ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`QQ红包 ${rpNote}${settled ? '（已处理）' : ''}`}
    >
      {/* 封面纹样 */}
      <RpCoverPattern />
      <div className="relative flex flex-col items-center px-3 pt-[18px]">
        <RpPenguin size={34} />
        <span className="mt-0.5 text-[10px] font-semibold tracking-[0.32em] text-[#FBE7B2]/90" aria-hidden="true">QQ</span>
        <p className="mt-3 line-clamp-2 min-h-[26px] text-center text-[16px] font-medium leading-snug text-[#FFF3D6] [text-shadow:0_1px_2px_rgba(180,30,40,0.28)]">{rpNote}</p>
      </div>
      {/* 底部亮红大弧形（椭圆上缘成拱）+ 開 / QQ红包 */}
      <div className="relative mt-2 h-[64px]">
        <span className="absolute left-1/2 top-[18px] h-[130px] w-[280px] -translate-x-1/2 rounded-[50%]" style={{ backgroundColor: '#FF6E62' }} aria-hidden="true" />
        {showOpen ? (
          <span className="absolute left-1/2 top-[13px] grid h-11 w-11 -translate-x-1/2 place-items-center rounded-full bg-[#FBE7B2] shadow-md shadow-black/10" aria-hidden="true">
            <span className="text-[19px] font-bold leading-none text-[#D8332F]">開</span>
          </span>
        ) : (
          <span className="chat-card-label absolute inset-x-0 bottom-[9px] text-center text-[11px] font-medium tracking-[0.25em] text-[#FFE3C2]">QQ红包</span>
        )}
      </div>
    </button>
  );
}

/** 聊天中的转账卡片（蓝卡 圈↔/对勾/退还↩ + ¥金额 + 状态文案 + 底部「转账」；206px 与微信转账卡同宽；自己也作为「已收款/已退还」接收凭据卡复用）。
 *  状态文案按角色与收款状态区分：接收完成后才显示「已转入好友余额」，之前是「待对方收款」；
 *  待收款中：有转账留言时状态行优先显示留言（没写留言才显示状态文案，与微信端同规则）；
 *  终态（已收款/已退还/已拒收）：不再显示留言，改回显示原状态文案（与微信端同规则）；
 *  收款/退还/拒收后卡片颜色变灰（对照真实 QQ：终态卡褪色），退还卡圆图标换成↩ */
export function TransferBubble({ packet, mine, received, onClick }: { packet: MsgPacket; mine: boolean; received: boolean; onClick: () => void }) {
  const refunded = packet.status === 'returned';
  // 终态：已收款/已退还/已拒收/已过期（24h 未收款清算，退回发起人）
  const expired = packet.expired === true;
  // 终态（已收款/已退还/已拒收/已过期）→ 显示原状态文案；待收款中 → 有留言显示留言、没写留言显示状态文案
  const settled = received || Boolean(packet.status) || expired;
  // 收款凭据卡（packet.receiptOf 有值）一律显示「已收款」——用户反馈：AI 转给我的钱，
  // 我收款后的凭据卡不能显示「已转入好友余额」（方向反了，微信端同步修）
  const status = expired
    ? '已过期'
    : refunded
      ? '已退还'
      : packet.status === 'rejected'
        ? '已拒收'
        : received
          ? packet.receiptOf
            ? '已收款'
            : mine
              ? '已转入好友余额'
              : '已收款'
          : mine
            ? '待对方收款'
            : '待你收款';
  return (
    <button
      type="button"
      data-testid="qq-transfer-bubble"
      onClick={onClick}
      className="chat-card chat-card-tr chat-card-body block w-[206px] overflow-hidden rounded-[12px] text-left shadow-md shadow-black/10 transition-all duration-300 active:scale-[0.97]"
      style={{
        backgroundImage: 'linear-gradient(135deg, #29ABF2 0%, #0099FF 100%)',
        // 收款/退还/拒收/过期后卡片颜色变灰（对照真实 QQ：终态卡褪色）
        filter: received || packet.status || packet.expired ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`转账 ${fmtMoney(packet.amount)} 元（${status}）`}
    >
      <div className="flex items-center gap-2.5 px-3.5 pb-3 pt-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-white/85" aria-hidden="true">
          {refunded || expired ? <Undo2 className="h-5 w-5 text-white" strokeWidth={2.4} /> : received ? <Check className="h-5 w-5 text-white" strokeWidth={2.6} /> : <ArrowLeftRight className="h-5 w-5 text-white" strokeWidth={2.2} />}
        </span>
        <span className="min-w-0">
          <span className="block text-[20px] font-semibold leading-tight text-white">¥{fmtMoney(packet.amount)}</span>
          <span className="mt-0.5 block truncate text-[13px] text-white/90" data-testid="qq-transfer-bubble-status">{!settled && packet.note && packet.note.trim() ? packet.note : status}</span>
        </span>
      </div>
      <div className="chat-card-label border-t border-white/25 px-3.5 py-1.5 text-[12.5px] text-white/95">转账</div>
    </button>
  );
}

/** 聊天中的亲属卡卡片（金卡 礼物图标 + 标题/状态 + 底部「亲属卡」；AI 赠送 / 领取状态展示） */
export function FamilyBubble({ fam, mine, peerName, onClick }: { fam: QQFamData; mine: boolean; peerName: string; onClick: () => void }) {
  const status = fam.rejected ? '已退回' : fam.claimed ? (mine ? '对方已领取' : '已领取') : mine ? '待对方领取' : '待你领取';
  return (
    <button
      type="button"
      data-testid="qq-family-bubble"
      onClick={onClick}
      className="chat-card chat-card-fam chat-card-body block w-[206px] overflow-hidden rounded-[12px] text-left shadow-md shadow-black/10 transition-all duration-300 active:scale-[0.97]"
      style={{
        backgroundImage: 'linear-gradient(135deg, #F7D488 0%, #EDB95E 100%)',
        // 领取/退回后卡片颜色变灰（与微信亲属卡一致）
        filter: fam.claimed || fam.rejected ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`亲属卡 每月额度${fam.monthlyLimit}元（${status}）`}
    >
      <div className="flex items-center gap-2.5 px-3.5 pb-3 pt-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-white/85" aria-hidden="true">
          <Gift className="h-5 w-5 text-white" strokeWidth={2.2} />
        </span>
        <span className="min-w-0">
          <span className="block text-[16px] font-semibold leading-tight text-white">{mine ? `给${peerName}的亲属卡` : '收到一张亲属卡'}</span>
          <span className="mt-0.5 block truncate text-[13px] text-white/90" data-testid="qq-family-bubble-status">{status}</span>
        </span>
      </div>
      <div className="chat-card-label border-t border-white/25 px-3.5 py-1.5 text-[12.5px] text-white/95">亲属卡</div>
    </button>
  );
}

/**
 * 群聊邀请卡片（AI 主动建群/拉人时发出；QQ 蓝样式）：
 * pending = 副文案 + 接受/拒绝按钮（点「接受邀请」才进群）；accepted/rejected = 状态行（卡片本体不可点，不进群）。
 */
export function QqGroupCardBubble({
  card,
  onAccept,
  onReject,
}: {
  card: GroupCardData;
  onAccept: () => void;
  onReject: () => void;
}) {
  const rejected = card.status === 'rejected';
  return (
    <div
      data-testid="qq-group-card"
      className={`w-[248px] select-none overflow-hidden rounded-[10px] bg-white shadow-sm dark:bg-[#232426] ${rejected ? 'opacity-60' : ''}`}
    >
      {/* 卡片本体不可点击进群（需求：点卡片不进群，点「接受邀请」才算进群）；进群入口只有接受按钮 */}
      <div className="flex w-full items-center gap-2.5 px-3 pb-2.5 pt-3 text-left">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-[#0099FF]/10 dark:bg-[#0099FF]/20"
        >
          <Users className="h-5 w-5 text-[#0099FF]" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-[1.3] text-black dark:text-white">{card.name}</span>
          <span className="mt-0.5 block truncate text-[12px] leading-[1.3] text-black/45 dark:text-white/45">
            {card.inviterName}邀请你加入群聊{card.memberNames.length > 1 ? `（${card.memberNames.slice(0, 3).join('、')}${card.memberNames.length > 3 ? '等' : ''}）` : ''}
          </span>
        </span>
      </div>
      {card.status === 'pending' ? (
        <div className="flex border-t border-black/[0.06] dark:border-white/[0.08]">
          <button
            type="button"
            data-testid="qq-group-card-reject"
            onClick={onReject}
            className="flex-1 py-2 text-[13.5px] text-black/55 active:bg-black/[0.04] dark:text-white/55 dark:active:bg-white/[0.06]"
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid="qq-group-card-accept"
            onClick={onAccept}
            className="flex-1 border-l border-black/[0.06] py-2 text-[13.5px] font-medium text-[#0099FF] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
          >
            接受邀请
          </button>
        </div>
      ) : (
        <div className="border-t border-black/[0.06] px-3 py-1.5 text-center text-[12px] text-black/40 dark:border-white/[0.08] dark:text-white/40">
          {rejected ? '已拒绝' : '已加入群聊'}
        </div>
      )}
    </div>
  );
}

/** 聊天系统通知行（居中小图标 + 灰字 + 彩色尾词，如「xx领取了你的红包」） */
export function QQNoticeRow({ icon, pre, accent }: { icon: 'rp' | 'tr' | 'fam'; pre: string; accent: string }) {
  return (
    <div className="mb-3 flex justify-center" data-testid="qq-notice-row">
      <span className="flex max-w-[86%] items-center gap-1.5 text-[12.5px] text-black/45 dark:text-white/45">
        {icon === 'rp' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(168deg, #FC8163, #F2394E)' }}
          >
            <RpIcon className="h-[11px] w-[11px] text-white" />
          </span>
        ) : icon === 'tr' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #29ABF2, #0099FF)' }}
          >
            <ArrowLeftRight className="h-[10px] w-[10px] text-white" strokeWidth={2.6} />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #F7D488, #EDB95E)' }}
          >
            <Gift className="h-[10px] w-[10px] text-white" strokeWidth={2.4} />
          </span>
        )}
        <span className="truncate">{pre}</span>
        <span className="shrink-0" style={{ color: icon === 'rp' ? '#F5455C' : icon === 'tr' ? '#0099FF' : '#E8912D' }}>
          {accent}
        </span>
      </span>
    </div>
  );
}

/** 发红包页（对照截图②：普通/拼手气/专属 tab + 单个金额 + 祝福语 + 封面 + 支付方式[余额/银行卡] + 大金额 + 塞钱进红包）。
 *  单聊/群聊共用：传入 members（群成员清单）即启用群模式 —— 普通红包支持多个个数、专属红包需从群成员里选收款人
 *  （packet 带上 toId/toName；群模式普通红包 count>1 时实际扣款 = 单个金额×个数，由调用方计） */
export function RedPacketCompose({ wallet, cards, onToast, onClose, onSend, members }: { wallet: WalletData; cards: BankCard[]; onToast: (m: string) => void; onClose: () => void; onSend: (p: MsgPacket, methodId: string) => void; members?: ContactRecord[] }) {
  const [tab, setTab] = useState<'normal' | 'lucky' | 'dedicated'>('normal');
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState('1');
  const [note, setNote] = useState('恭喜发财');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const [target, setTarget] = useState<ContactRecord | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const methodCard = cards.find((c) => c.id === methodId) ?? null;
  const num = Math.round((parseFloat(amount) || 0) * 100) / 100;
  const cnt = Math.min(100, Math.max(1, Math.round(parseFloat(count) || 1)));
  const total = num;
  const groupMode = Array.isArray(members) && members.length > 0;
  const ok = num > 0 && (tab !== 'lucky' || cnt >= 1) && (tab !== 'dedicated' || !groupMode || target != null);
  const tabLabel = (t: 'normal' | 'lucky' | 'dedicated'): string => (t === 'normal' ? '普通' : t === 'lucky' ? '拼手气红包' : '专属红包');
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="发红包" onBack={onClose} />
      {/* tab 行 */}
      <div className="flex shrink-0 items-center gap-7 px-6 pt-1">
        {(['normal', 'lucky', 'dedicated'] as const).map((t) => (
          <button key={t} type="button" data-testid={`qq-rp-tab-${t}`} onClick={() => setTab(t)} className="relative pb-2.5">
            <span className={`text-[16px] ${tab === t ? 'font-medium text-[#1F2329] dark:text-white' : 'text-black/45 dark:text-white/45'}`}>{tabLabel(t)}</span>
            {tab === t ? <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[#F5455C]" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-3">
        {/* 金额卡 */}
        <div className="flex h-[62px] items-center justify-between rounded-[14px] bg-white px-4 dark:bg-[#232529]">
          <span className="text-[16px] text-[#1F2329] dark:text-white">{tab === 'lucky' ? '总金额' : '单个金额'}</span>
          <span className="flex items-center gap-2">
            <input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
              placeholder="0.00"
              aria-label="红包金额"
              data-testid="qq-rp-amount"
              className="w-[120px] bg-transparent text-right text-[20px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
            />
            <span className="text-[16px] text-[#1F2329] dark:text-white">元</span>
          </span>
        </div>
        {(tab === 'lucky' || (groupMode && tab === 'normal')) ? (
          <div className="mt-2.5 flex h-[62px] items-center justify-between rounded-[14px] bg-white px-4 dark:bg-[#232529]">
            <span className="text-[16px] text-[#1F2329] dark:text-white">红包个数</span>
            <span className="flex items-center gap-2">
              <input
                value={count}
                inputMode="numeric"
                onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                aria-label="红包个数"
                data-testid="qq-rp-count"
                className="w-[120px] bg-transparent text-right text-[20px] text-[#1F2329] outline-none dark:text-white"
              />
              <span className="text-[16px] text-[#1F2329] dark:text-white">个</span>
            </span>
          </div>
        ) : null}
        {/* 专属红包收款成员（群模式限定：从群成员里选一个人领） */}
        {groupMode && tab === 'dedicated' ? (
          <button
            type="button"
            data-testid="qq-rp-target"
            onClick={() => setPickOpen(true)}
            className="mt-2.5 flex h-[62px] w-full items-center justify-between rounded-[14px] bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#232529] dark:active:bg-white/[0.05]"
          >
            <span className="text-[16px] text-[#1F2329] dark:text-white">指定成员</span>
            <span className="flex items-center gap-2">
              {target ? (
                <span className="flex items-center gap-1.5">
                  <QqAvatar src={target.avatar} alt={target.name} size={26} />
                  <span className="text-[15px] text-[#1F2329] dark:text-white">{target.name}</span>
                </span>
              ) : (
                <span className="text-[14px] text-black/35 dark:text-white/35">选择群成员</span>
              )}
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </span>
          </button>
        ) : null}
        {/* 祝福语 */}
        <div className="mt-2.5 flex h-[62px] items-center gap-3 rounded-[14px] bg-white px-4 dark:bg-[#232529]">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 20))}
            placeholder="恭喜发财"
            aria-label="红包祝福语"
            data-testid="qq-rp-note"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
          />
        </div>
        {/* 封面 */}
        <div className="mt-2.5 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <button type="button" onClick={() => onToast('红包封面暂未开放')} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] text-[#1F2329] dark:text-white">红包封面</span>
              <span className="mt-0.5 block text-[13px] text-black/35 dark:text-white/35">默认</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
          <div className="border-t border-black/[0.04] dark:border-white/[0.06]" />
          <button type="button" onClick={() => onToast('领取更多红包封面暂未开放')} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">领取更多红包封面</span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
        {/* 支付方式 */}
        <div className="mt-2.5 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <button type="button" data-testid="qq-rp-method" onClick={() => setMethodOpen(true)} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">支付方式</span>
            <span className="mr-1 max-w-[55%] truncate text-[14px] text-black/45 dark:text-white/45">
              {methodId === 'balance' ? `QQ钱包余额（可用 ${fmtMoney(wallet.balance)} 元）` : `${methodCard?.bank ?? ''}（尾号${methodCard?.last4 ?? ''}）`}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
        {/* 大金额 + 按钮 */}
        <div className="mt-10 text-center">
          <p className="text-[52px] font-bold leading-none tracking-tight text-[#1F2329] dark:text-white">
            <span className="mr-1 text-[30px] font-semibold align-[6px]" aria-hidden="true">¥</span>
            {num.toFixed(2)}
          </p>
          <button
            type="button"
            disabled={!ok}
            data-testid="qq-rp-send"
            onClick={() => {
              if (!ok) return;
              onSend({
                type: 'redpacket',
                amount: total,
                note: note.trim() || '恭喜发财',
                count: tab === 'lucky' || (groupMode && tab === 'normal') ? cnt : 1,
                mode: tab,
                claims: [],
                ...(groupMode && tab === 'dedicated' && target ? { toId: target.id, toName: target.name } : {}),
              }, methodId);
            }}
            style={{ backgroundColor: ok ? '#F5455C' : '#F8B9BE' }}
            className="mx-auto mt-6 block h-12 w-[240px] rounded-full text-[17px] font-medium text-white transition-colors duration-200 active:brightness-95"
          >
            塞钱进红包
          </button>
        </div>
      </div>
      <p className="shrink-0 pb-6 pt-3 text-center text-[13px] text-black/30 dark:text-white/30">未领取的红包，将于24小时后发起退款</p>
      {methodOpen ? (
        <PayMethodSheet
          wallet={wallet}
          cards={cards}
          selectedId={methodId}
          onClose={() => setMethodOpen(false)}
          onPick={(id) => {
            setMethodId(id);
            setMethodOpen(false);
          }}
        />
      ) : null}
      {/* 指定成员选择 sheet（群模式专属红包：只有被选中的成员能领） */}
      {pickOpen && members ? (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={() => setPickOpen(false)} data-testid="qq-rp-target-sheet">
          <div className="max-h-[62%] overflow-hidden rounded-t-[16px] bg-white dark:bg-[#232529]" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 pb-2 pt-4 text-[15px] font-medium text-[#1F2329] dark:text-white">选择指定成员（只有 TA 能领这个红包）</div>
            <div className="max-h-[52vh] overflow-y-auto pb-6">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`qq-rp-target-${m.id}`}
                  onClick={() => {
                    setTarget(m);
                    setPickOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <QqAvatar src={m.avatar} alt={m.name} size={38} />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-[#1F2329] dark:text-white">{m.name}</span>
                  {target?.id === m.id ? <Check className="h-5 w-5 shrink-0 text-[#0099FF]" aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 向好友转账页（对照截图①：转账给 头像/QQ号 + 金额卡 + 留言 0/12 + 支付方式[余额/银行卡] + 转账按钮 + 防诈提示） */
export function TransferCompose({ peer, wallet, cards, onToast, onClose, onSend }: { peer: ContactRecord; wallet: WalletData; cards: BankCard[]; onToast: (m: string) => void; onClose: () => void; onSend: (p: MsgPacket, methodId: string) => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const methodCard = cards.find((c) => c.id === methodId) ?? null;
  const num = Math.round((parseFloat(amount) || 0) * 100) / 100;
  const ok = num > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="向好友转账" onBack={onClose} />
      <div className="flex-1 overflow-y-auto px-4 pt-4">
        <div className="flex items-center gap-3 px-1 py-2">
          <QqAvatar src={peer.avatar} alt={peer.name} size={52} />
          <div className="min-w-0">
            <p className="truncate text-[19px] font-medium text-[#1F2329] dark:text-white">转账给 {peer.name}</p>
            <p className="mt-0.5 truncate text-[14px] text-black/40 dark:text-white/40">QQ号：{peer.qqId ?? '暂无'}</p>
          </div>
        </div>
        <div className="mt-3 rounded-[16px] bg-white px-5 pb-4 pt-4 dark:bg-[#232529]">
          <p className="text-[17px] text-[#1F2329] dark:text-white">转账金额</p>
          <div className="mt-4 flex items-center gap-2 border-b border-black/[0.08] pb-5 dark:border-white/10">
            <span className="text-[40px] font-medium leading-none text-[#1F2329] dark:text-white" aria-hidden="true">¥</span>
            <input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
              aria-label="转账金额"
              data-testid="qq-transfer-amount"
              className="w-full bg-transparent text-[40px] font-medium text-[#1F2329] outline-none dark:text-white"
            />
          </div>
          <div className="mt-3.5 flex items-center gap-3 pb-1">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 12))}
              placeholder="添加转账留言"
              aria-label="转账留言"
              data-testid="qq-transfer-note"
              className="min-w-0 flex-1 bg-transparent text-[17px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
            />
            <span className="shrink-0 text-[15px] text-black/35 dark:text-white/35">{note.length}/12</span>
          </div>
        </div>
        {/* 支付方式 */}
        <div className="mt-2.5 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <button type="button" data-testid="qq-transfer-method" onClick={() => setMethodOpen(true)} className="flex w-full items-center px-4 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]">
            <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">支付方式</span>
            <span className="mr-1 max-w-[55%] truncate text-[14px] text-black/45 dark:text-white/45">
              {methodId === 'balance' ? `QQ钱包余额（可用 ${fmtMoney(wallet.balance)} 元）` : `${methodCard?.bank ?? ''}（尾号${methodCard?.last4 ?? ''}）`}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          disabled={!ok}
          data-testid="qq-transfer-send"
          onClick={() => ok && onSend({ type: 'transfer', amount: num, note: note.trim() }, methodId)}
          className={`mx-auto mt-9 block h-[52px] w-[220px] rounded-[16px] text-[17px] font-medium text-white ${ok ? 'active:brightness-95' : ''}`}
          style={{ backgroundColor: ok ? QQ_BLUE : '#8AD4F7' }}
        >
          转账
        </button>
      </div>
      <p className="shrink-0 pb-6 pt-3 text-center text-[14px] text-black/30 dark:text-white/30">请务必确认对方真实身份，警惕电信网络诈骗</p>
      {methodOpen ? (
        <PayMethodSheet
          wallet={wallet}
          cards={cards}
          selectedId={methodId}
          onClose={() => setMethodOpen(false)}
          onPick={(id) => {
            setMethodId(id);
            setMethodOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** 红包开箱弹窗（对照截图②：近全屏大红卡 + 封面纹样 + 发红包人 + 祝福语 + 大「開」+ 弹窗外关闭） */
export function RedPacketOpenModal({ senderName, avatar, note, onOpen, onClose, onRefund }: { senderName: string; avatar: string | null; note: string; onOpen: () => void; onClose: () => void; onRefund?: () => void }) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/70 px-7 pb-12" role="dialog" aria-label="打开红包">
      <style>{'@keyframes qqRpModalIn{from{transform:scale(.86);opacity:0}to{transform:scale(1);opacity:1}}'}</style>
      <div
        className="relative h-[64vh] max-h-[600px] min-h-[430px] w-full max-w-[340px] overflow-hidden rounded-[22px] shadow-2xl"
        style={{ backgroundImage: 'linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%)', animation: 'qqRpModalIn 0.26s ease-out' }}
      >
        {/* 封面纹样 */}
        <RpCoverPattern />
        <div className="relative flex h-full flex-col items-center">
          <div className="h-[31%] shrink-0" aria-hidden="true" />
          <div className="flex items-center gap-2">
            <QqAvatar src={avatar} alt={senderName} size={28} />
            <p className="text-[16px] text-[#FFEFD2]">{senderName}发出的红包</p>
          </div>
          <p className="mt-8 text-[32px] font-medium tracking-wide text-[#FFF3D6] [text-shadow:0_2px_4px_rgba(180,30,40,0.3)]">{note}</p>
          <div className="flex-1" aria-hidden="true" />
          {/* 底部亮红大弧 + 開 */}
          <div className="relative h-[150px] w-full shrink-0">
            <span className="absolute left-1/2 top-[48px] h-[230px] w-[440px] -translate-x-1/2 rounded-[50%]" style={{ backgroundColor: '#FF6E62' }} aria-hidden="true" />
            <button
              type="button"
              data-testid="qq-rp-open"
              onClick={onOpen}
              className="absolute left-1/2 top-[24px] grid h-[92px] w-[92px] -translate-x-1/2 place-items-center rounded-full bg-[#FBE7B2] shadow-lg shadow-black/15 transition-transform active:scale-95"
              aria-label="开红包"
            >
              <span className="text-[40px] font-bold leading-none text-[#D8332F]">開</span>
            </button>
          </div>
        </div>
      </div>
      {/* 卡片下方：退还 + 关闭（退还可把对方发的红包原路退回） */}
      <div className="absolute bottom-9 left-1/2 flex -translate-x-1/2 items-center gap-4">
        {onRefund ? (
          <button
            type="button"
            data-testid="qq-rp-refund"
            onClick={onRefund}
            className="flex h-11 items-center rounded-full border-2 border-white/70 bg-black/20 px-6 text-[15px] font-medium text-white/90 active:opacity-70"
          >
            退还
          </button>
        ) : null}
        <button type="button" aria-label="关闭" data-testid="qq-rp-close" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full border-2 border-white/70 text-white/90 active:opacity-60">
          <X className="h-5 w-5" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

/** 红包详情页（对照真机：全屏沉浸红头直达状态栏[导航+封面纹样+金色封套标+发送人+祝福语+金色金额] + 下方领取统计与列表，拼手气含手气最佳） */
export function RedPacketDetailPage({ me, peer, msg, onBack, onToast }: { me: QQUser; peer: ContactRecord; msg: QQMsg; onBack: () => void; onToast: (m: string) => void }) {
  const p = msg.packet;
  if (!p) return null;
  const mine = msg.role === 'me';
  const senderName = mine ? me.name : peer.name;
  const avatar = mine ? me.avatar : peer.avatar;
  const claims = p.claims ?? [];
  const claimedTotal = claims.reduce((s, c) => s + c.amount, 0);
  const count = p.count ?? 1;
  const myClaim = claims.find((c) => c.name === me.name);
  const best = claims.length > 1 ? Math.max(...claims.map((c) => c.amount)) : -1;
  const fmtT = (ts: number): string => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-hidden bg-[#F5F6F8] dark:bg-[#16171A]">
      {/* 全屏沉浸红色头部（含状态栏区）：导航 + 封套标 + 发送人 + 祝福语 + 金额 */}
      <div
        className="relative shrink-0 px-3 pb-20 pt-[54px]"
        style={{ borderBottomLeftRadius: '46% 54px', borderBottomRightRadius: '46% 54px', backgroundImage: 'linear-gradient(172deg, #FD8A67 0%, #F5455C 58%, #EE3A50 100%)', boxShadow: '0 12px 26px rgba(214,52,66,0.25)' }}
      >
        <RpCoverPattern />
        <div className="relative flex h-11 items-center px-1">
          <button type="button" aria-label="返回" data-testid="qq-wallet-back" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-white/95 active:bg-white/15">
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
          </button>
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[17px] font-medium text-white">QQ红包</span>
          <button type="button" onClick={() => onToast('红包记录暂未开放')} className="ml-auto mr-1 text-[15px] text-white/95 active:opacity-60">红包记录</button>
        </div>
        <div className="relative mt-4 flex flex-col items-center" data-testid="qq-rp-detail-head">
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#FBE7B2]/20 px-3 py-1 text-[12px] tracking-[0.2em] text-[#FFE9B8] ring-1 ring-inset ring-[#FBE7B2]/40" aria-hidden="true">
            <RpIcon className="h-3.5 w-3.5" />
            QQ红包
          </span>
          <div className="flex items-center gap-2">
            <QqAvatar src={avatar} alt={senderName} size={34} />
            <p className="text-[18px] font-medium text-[#FFF3D6]">{senderName}发送的红包</p>
          </div>
          <p className="mt-2 text-[15px] text-[#FFE3C2]/85">{p.note}</p>
          <p className="mt-6 text-[48px] font-bold leading-none tracking-tight text-[#FFE9B8] [text-shadow:0_2px_8px_rgba(170,25,40,0.4)]" data-testid="qq-rp-detail-amount">
            <span className="mr-1 align-[6px] text-[26px] font-semibold" aria-hidden="true">¥</span>
            {fmtMoney(claims.length > 0 ? claimedTotal : p.amount)}
          </p>
          {myClaim ? (
            <span className="mt-3 rounded-full bg-[#FBE7B2]/20 px-3.5 py-1.5 text-[14px] text-[#FFE9B8] ring-1 ring-inset ring-[#FBE7B2]/35">收到的红包已存入余额</span>
          ) : p.expired ? (
            <p className="mt-3 text-[14px] text-[#FFE3C2]/85" data-testid="qq-rp-detail-expired">红包已过期，剩余金额已退回</p>
          ) : p.status === 'returned' ? (
            /* L12：拼手气（count>1）被 AI 退回时 claims 已按 #32 清空（只退「总额-已领」），
               不能按全额宣称「已存入钱包」；单份退回才是全额入账；对方发的卡被退回则资金归对方 */
            <p className="mt-3 text-[14px] text-[#FFE3C2]/85" data-testid="qq-rp-detail-refunded">
              {mine
                ? count > 1
                  ? '红包已退回，未领取金额已退回钱包'
                  : '红包已退回，金额已存入钱包余额'
                : '红包已退回，金额已退还给对方'}
            </p>
          ) : p.status === 'rejected' ? (
            <p className="mt-3 text-[14px] text-[#FFE3C2]/85" data-testid="qq-rp-detail-rejected">对方拒收了该红包</p>
          ) : mine && claims.length > 0 ? (
            <p className="mt-3 text-[14px] text-[#FFE3C2]/75">好友领取后自动存入其余额</p>
          ) : null}
        </div>
      </div>
      <div className="relative -mt-10 flex-1 overflow-y-auto px-4 pb-8">
        <div className="rounded-[12px] bg-[#EDEEF0] px-4 py-2.5 dark:bg-white/[0.06]">
          <p className="text-[14px] text-black/45 dark:text-white/45" data-testid="qq-rp-detail-stat">
            {count}个红包，
            {p.expired
              ? '已过期'
              : p.status === 'returned'
              ? '已退回'
              : p.status === 'rejected'
                ? '已拒收'
                : claims.length >= count
                  ? '已领完'
                  : claims.length > 0
                    ? `已领${claims.length}个`
                    : '等待领取'}
            ，共{fmtMoney(claims.length > 0 ? claimedTotal : p.amount)}元
          </p>
        </div>
        <div className="mt-2 overflow-hidden rounded-[14px] bg-white shadow-sm shadow-black/[0.04] dark:bg-[#232529]">
          {claims.length === 0 ? (
            <p className="py-10 text-center text-[14px] text-black/35 dark:text-white/35">好友领取后将展示在这里</p>
          ) : (
            claims.map((c, i) => {
              const isBest = p.mode === 'lucky' && claims.length > 1 && c.amount === best;
              return (
                <div key={`${c.name}-${c.ts}-${i}`} className={`flex h-[64px] items-center gap-3 px-4 ${i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.06]' : ''}`}>
                  <QqAvatar src={c.avatar} alt={c.name} size={38} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-[16px] text-[#1F2329] dark:text-white">
                      {c.name}
                      {isBest ? <span className="shrink-0 rounded bg-gradient-to-r from-[#F5B96A] to-[#E8912D] px-1.5 py-0.5 text-[10px] font-medium text-white" aria-hidden="true">手气最佳</span> : null}
                    </p>
                    <p className="text-[13px] text-black/35 dark:text-white/35">{fmtT(c.ts)}</p>
                  </div>
                  <span className={`shrink-0 text-[16px] ${isBest ? 'font-semibold text-[#E8912D] dark:text-[#F0B25E]' : 'text-[#1F2329] dark:text-white'}`}>{fmtMoney(c.amount)}元</span>
                </div>
              );
            })
          )}
        </div>
        <p className="mt-4 px-1 text-[12px] leading-relaxed text-black/35 dark:text-white/35">未领取的红包，将于24小时后发起退款；红包金额仅在本机演示环境流转。</p>
      </div>
    </div>
  );
}

/** 收款页（点对方发来的未收款转账卡片进入，对照微信收款页：蓝圈时钟 + 待你收款 + 金额 + 转账时间 + 收款按钮 + 退还提示） */
export function TransferReceivePage({
  peer,
  msg,
  onBack,
  onAccept,
  onRefund,
}: {
  peer: ContactRecord;
  msg: QQMsg;
  onBack: () => void;
  onAccept: (msgId: string) => void;
  onRefund: () => void;
}) {
  const p = msg.packet;
  if (!p) return null;
  const d = new Date(msg.time);
  const fmtFull = `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white pt-[54px] dark:bg-[#16171A]" data-testid="qq-tr-receive">
      {/* 顶部：仅返回键（对照收款页） */}
      <div className="flex h-11 shrink-0 items-center px-2">
        <button type="button" aria-label="返回" data-testid="qq-tr-receive-back" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-[#1F2329] active:bg-black/[0.06] dark:text-white">
          <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.4} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8">
        <div className="mt-[10vh] flex flex-col items-center">
          <Clock className="h-[76px] w-[76px] text-[#12B7F5]" strokeWidth={1.6} aria-hidden="true" />
          <p className="mt-7 text-[17px] text-[#1F2329] dark:text-white" data-testid="qq-tr-receive-status">
            {peer.name}向你转账，待你收款
          </p>
          <p className="mt-5 text-[48px] font-bold leading-none tracking-tight text-[#1F2329] dark:text-white" data-testid="qq-tr-receive-amount">
            <span className="mr-1 align-[5px] text-[26px] font-semibold" aria-hidden="true">¥</span>
            {fmtMoney(p.amount)}
          </p>
        </div>
        <div className="mt-12 border-t border-black/[0.08] px-1 dark:border-white/10">
          <div className="flex min-h-[54px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账时间</span>
            <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull}</span>
          </div>
          {p.note ? (
            <div className="flex min-h-[54px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账留言</span>
              <span className="min-w-0 truncate text-[16px] text-[#1F2329] dark:text-white">{p.note}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 px-12 pb-9">
        <button
          type="button"
          data-testid="qq-tr-receive-accept"
          onClick={() => onAccept(msg.id)}
          className="mx-auto block h-11 w-[62%] rounded-[10px] text-[17px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: QQ_BLUE }}
        >
          收款
        </button>
        <p className="mt-4 text-center text-[13.5px] text-black/40 dark:text-white/40">
          1天内未确认，将退还给对方。{' '}
          <button type="button" onClick={onRefund} className="text-[#12B7F5] active:opacity-60" data-testid="qq-tr-receive-refund">
            退还
          </button>
        </p>
      </div>
    </div>
  );
}

/** 交易详情页（对照截图⑥：蓝圈对勾 + 收款文案 + 金额 + 查看余额 + 留言/时间）。
 *  退还态：琥珀圈↩ + 「你已退还/对方已退还」+ 退款时间行。
 *  receiverIsMe 由调用方按消息角色 + receiptOf + 旧数据配对推导：文案区分「你已收款 / XX已收款」；
 *  退还人：退还凭据卡自带 refundedBy，原卡按消息角色反推（我发的→对方退的；对方发的→我退的） */
export function TransferDetailPage({ me, peer, msg, receiverIsMe, onBack, onToast, onAccept }: { me: QQUser; peer: ContactRecord; msg: QQMsg; receiverIsMe: boolean; onBack: () => void; onToast: (m: string) => void; onAccept: (msgId: string) => void }) {
  const p = msg.packet;
  if (!p) return null;
  const mine = msg.role === 'me';
  const incoming = !mine;
  const returned = p.status === 'returned';
  // 24h 过期清算终态：不可再收款，资金已退回发起人
  const expired = p.expired === true;
  const fmtFull = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="交易详情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5">
        <div className="mt-14 flex flex-col items-center">
          <span className={`grid h-[72px] w-[72px] place-items-center rounded-full border-[4px] ${returned || expired ? 'border-[#F6AC3D]' : 'border-[#12B7F5]'}`} aria-hidden="true">
            {returned || expired ? <Undo2 className="h-9 w-9 text-[#F6AC3D]" strokeWidth={2.6} /> : <Check className="h-9 w-9 text-[#12B7F5]" strokeWidth={3} />}
          </span>
          <p className="mt-6 text-[17px] text-[#1F2329] dark:text-white" data-testid="qq-tr-detail-line">
            {expired
              ? '转账已过期，资金已退回'
              : returned
              ? (p.refundedBy ?? (mine ? 'peer' : 'me')) === 'peer'
                ? '对方已退还'
                : '你已退还'
              : receiverIsMe
                ? '你已收款，资金已存入钱包余额'
                : mine
                  ? p.status === 'rejected'
                    ? '对方已拒收'
                    : p.received
                      ? `${peer.name}已收款`
                      : '转账成功，等待对方收款'
                  : incoming && !p.received && !p.status
                    ? `${peer.name}向你转账，待收款`
                    : `${peer.name}已收款`}
          </p>
          <p className="mt-5 text-[48px] font-bold leading-none tracking-tight text-[#1F2329] dark:text-white" data-testid="qq-tr-detail-amount">
            <span className="mr-1 text-[26px] font-semibold align-[5px]" aria-hidden="true">¥</span>
            {fmtMoney(p.amount)}
          </p>
          {incoming && !p.received && !p.status && !expired ? (
            <button
              type="button"
              data-testid="qq-tr-detail-accept"
              onClick={() => {
                // 收款全部由父级 onAccept 完成（标记 received + 入钱包余额 + 追加接收卡片，与收款页主路径同一处理器）。
                // #28 这里不得再本地 gainToWallet：旧实现按钮内重复入账一次（潜伏双计）；当前详情页兑底入口
                // 只在收款后可达、本按钮不可达，仍按父级路径收敛并注释防未来接线回归
                onAccept(msg.id);
                onToast(`已收款 ${fmtMoney(p.amount)} 元`);
              }}
              className="mt-4 h-10 w-[140px] rounded-full text-[16px] font-medium text-white active:brightness-95"
              style={{ backgroundColor: QQ_BLUE }}
            >
              收款
            </button>
          ) : (
            <button type="button" onClick={() => onToast('余额请前往钱包-余额查看')} className="mt-4 text-[16px] text-[#12B7F5] active:opacity-60">
              查看余额
            </button>
          )}
        </div>
        <div className="mt-10 border-t border-black/[0.08] px-1 dark:border-white/10">
          <div className="flex min-h-[54px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账留言</span>
            <span className="truncate text-[16px] text-[#1F2329] dark:text-white">{p.note || 'QQ转账'}</span>
          </div>
          <div className="flex min-h-[54px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">转账时间</span>
            {/* 退还凭据卡显示原转账发生时间（originTime），原卡显示消息自身时间 */}
            <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull(returned ? (p.originTime ?? msg.time) : msg.time)}</span>
          </div>
          {returned && typeof p.refundedAt === 'number' && (
            <div className="flex min-h-[54px] items-center justify-between gap-4" data-testid="qq-tr-refund-time-row">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">退款时间</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull(p.refundedAt)}</span>
            </div>
          )}
          {expired && typeof p.expiredAt === 'number' && (
            <div className="flex min-h-[54px] items-center justify-between gap-4" data-testid="qq-tr-expired-time-row">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">退款时间</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull(p.expiredAt)}</span>
            </div>
          )}
          {!mine ? (
            <div className="flex min-h-[54px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">对方</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{peer.name}（QQ号 {peer.qqId ?? '暂无'}）</span>
            </div>
          ) : (
            <div className="flex min-h-[54px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">收款方</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{peer.name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 亲属卡详情页（AI 赠送 / 状态展示）：金卡 + 关系/每月额度/留言 + 领取/退还按钮（对方发的未领取时） */
export function FamilyDetailPage({
  peer,
  msg,
  onBack,
  onToast,
  onClaim,
  onRefund,
}: {
  peer: ContactRecord;
  msg: QQMsg;
  onBack: () => void;
  onToast: (m: string) => void;
  onClaim: (msgId: string) => void;
  /** 退还（拒收）对方送的亲属卡（仅对方发的未领取卡片传入） */
  onRefund?: (msgId: string) => void;
}) {
  const f = msg.fam;
  if (!f) return null;
  const mine = msg.role === 'me';
  const d = msg.fam?.claimedAt ? new Date(msg.fam.claimedAt) : null;
  const fmtFull = d
    ? `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`
    : '';
  const claimable = !mine && !f.claimed && !f.rejected;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="亲属卡" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5">
        <div
          className="mt-8 overflow-hidden rounded-[16px] shadow-lg shadow-black/10"
          style={{ backgroundImage: 'linear-gradient(150deg, #F7D488 0%, #EDB95E 60%, #E3A94B 100%)' }}
          data-testid="qq-family-detail-card"
        >
          <div className="flex items-center gap-3 px-5 pb-4 pt-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-white/85" aria-hidden="true">
              <Gift className="h-6 w-6 text-white" strokeWidth={2.1} />
            </span>
            <div className="min-w-0">
              <p className="text-[17px] font-semibold leading-tight text-white">{mine ? `给${peer.name}的亲属卡` : `${peer.name}送给你的亲属卡`}</p>
              <p className="mt-0.5 text-[12.5px] text-white/90">关系：{f.relation}</p>
            </div>
          </div>
          <div className="mx-5 mb-4 rounded-[12px] bg-white/22 px-4 py-3">
            <p className="text-[12.5px] text-white/90">每月消费上限</p>
            <p className="mt-0.5 text-[30px] font-bold leading-none text-white" data-testid="qq-family-detail-limit">
              ¥{fmtMoney(f.monthlyLimit)}
            </p>
            {f.message && <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-white/95">“{f.message}”</p>}
          </div>
          <div className="border-t border-white/25 px-5 py-2 text-[12px] text-white/95">亲属卡 · 消费由赠卡方代付（模拟）</div>
        </div>

        <div className="mt-5 border-t border-black/[0.08] px-1 dark:border-white/10">
          <div className="flex min-h-[52px] items-center justify-between gap-4">
            <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">状态</span>
            <span className="text-[16px] text-[#1F2329] dark:text-white" data-testid="qq-family-detail-status">
              {f.rejected ? '已退回' : f.claimed ? '已领取' : mine ? '待对方领取' : '待你领取'}
            </span>
          </div>
          {f.claimed && fmtFull && (
            <div className="flex min-h-[52px] items-center justify-between gap-4">
              <span className="shrink-0 text-[15px] text-black/40 dark:text-white/40">领取时间</span>
              <span className="text-[16px] text-[#1F2329] dark:text-white">{fmtFull}</span>
            </div>
          )}
        </div>

        {claimable && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              data-testid="qq-family-detail-claim"
              onClick={() => {
                onClaim(msg.id);
                onToast('已领取亲属卡，对方为你买单（模拟）');
              }}
              className="block h-11 w-[150px] rounded-full text-[16px] font-medium text-white active:brightness-95"
              style={{ backgroundColor: QQ_BLUE }}
            >
              领取
            </button>
            {onRefund ? (
              <button
                type="button"
                data-testid="qq-family-detail-refund"
                onClick={() => onRefund(msg.id)}
                className="block h-11 w-[150px] rounded-full border border-black/15 bg-white text-[16px] font-medium text-[#1F2329] active:bg-black/[0.04] dark:border-white/15 dark:bg-transparent dark:text-white"
              >
                退还
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 位置（发送位置页 + 聊天位置卡片） ----------------

/** 位置卡片假地图（位置气泡 / 发送位置页顶部预览复用；CSS 路网 + 大头针） */
export function MapPreview({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <span className={`relative block overflow-hidden bg-[#E9F1E6] ${className}`} aria-hidden="true">
      {/* 路网纹理 */}
      <span
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(90deg, rgba(255,255,255,0.85) 2px, transparent 2px), linear-gradient(0deg, rgba(255,255,255,0.85) 2px, transparent 2px)',
          backgroundSize: '56px 44px',
        }}
      />
      <span className="absolute inset-x-0 top-[46%] h-[10px] -rotate-6 bg-[#FBD7A8]/90" />
      <span className="absolute inset-y-0 left-[38%] w-[8px] rotate-3 bg-[#CBE3F8]/90" />
      <span className="absolute right-[12%] top-[16%] h-10 w-16 rounded-[10px] bg-[#C8E6C1]/90" />
      <span className="absolute bottom-[12%] left-[8%] h-8 w-12 rounded-[8px] bg-[#C8E6C1]/80" />
      {/* 中心大头针 */}
      <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center">
        <MapPin className="h-7 w-7 drop-shadow" strokeWidth={2.2} style={{ color: '#F0605C' }} />
        <span className="-mt-0.5 h-1.5 w-1.5 rounded-full bg-black/20" />
      </span>
      {label ? <span className="absolute bottom-2 left-2 rounded-md bg-white/95 px-2 py-1 text-[11px] text-[#1F2329] shadow-sm">{label}</span> : null}
    </span>
  );
}

/** 聊天中的位置卡片（上地图下信息，对照 QQ 位置消息；单聊/群聊共用） */
export function LocationBubble({ loc, onClick }: { loc: MsgLoc; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="qq-loc-bubble"
      onClick={onClick}
      className="block w-[228px] overflow-hidden rounded-[12px] text-left shadow-md shadow-black/10 transition-transform active:scale-[0.97]"
      aria-label={`位置 ${loc.name}`}
    >
      <MapPreview className="h-[104px] w-full" label={loc.name} />
      <span className="block bg-white px-3 py-2.5 dark:bg-[#2A2C31]">
        <span className="block truncate text-[15px] font-medium text-[#1F2329] dark:text-white">{loc.name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-black/40 dark:text-white/40">{loc.addr}</span>
      </span>
    </button>
  );
}

/** 内置常用位置（发送位置页；与用户资料地域杭州呼应） */
export const LOC_PRESETS: Array<{ name: string; addr: string; lat?: number; lng?: number; dist: string }> = [
  { name: '东方通信大厦', addr: '浙江省杭州市西湖区文三路398号', lat: 30.2787, lng: 120.1244, dist: '172米' },
  { name: '西湖风景名胜区', addr: '浙江省杭州市西湖区龙井路1号', lat: 30.2429, lng: 120.1476, dist: '3.6公里' },
  { name: '湖滨银泰in77', addr: '浙江省杭州市上城区延安路98号', lat: 30.253, lng: 120.163, dist: '5.4公里' },
  { name: '钱江新城城市阳台', addr: '浙江省杭州市上城区之江路888号', lat: 30.248, lng: 120.214, dist: '8.2公里' },
  { name: '滨江宝龙城', addr: '浙江省杭州市滨江区滨盛路3822号', lat: 30.185, lng: 120.195, dist: '9.8公里' },
  { name: '三里屯太古里', addr: '北京市朝阳区三里屯路19号', lat: 39.9368, lng: 116.4472, dist: '1200公里' },
  { name: '陆家嘴环球金融中心', addr: '上海市浦东新区世纪大道100号', lat: 31.2354, lng: 121.5057, dist: '1640公里' },
];

/** 发送位置页（内置地点一键发送 + 自定义位置表单，发送后聊天内出现位置卡片；单聊/群聊共用） */
export function LocationPickerPage({ onClose, onSend }: { onClose: () => void; onSend: (loc: MsgLoc) => void }) {
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');
  const [addr, setAddr] = useState('');
  const ok = name.trim().length > 0 && addr.trim().length > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]" data-testid="qq-loc-page">
      <WalletNavHeader title="发送位置" onBack={onClose} />
      {custom ? (
        <>
          <div className="flex-1 overflow-y-auto px-4 pt-4">
            <div className="overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
              <div className="border-b border-black/[0.04] px-4 py-3 dark:border-white/[0.06]">
                <p className="text-[12px] text-black/40 dark:text-white/40">位置名称</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 20))}
                  placeholder="如：公司、家、学校"
                  aria-label="位置名称"
                  data-testid="qq-loc-name"
                  className="mt-1 h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
                />
              </div>
              <div className="px-4 py-3">
                <p className="text-[12px] text-black/40 dark:text-white/40">详细地址</p>
                <input
                  value={addr}
                  onChange={(e) => setAddr(e.target.value.slice(0, 40))}
                  placeholder="街道、门牌号等"
                  aria-label="详细地址"
                  data-testid="qq-loc-addr"
                  className="mt-1 h-7 w-full bg-transparent text-[16px] text-[#1F2329] outline-none placeholder:text-black/25 dark:text-white dark:placeholder:text-white/25"
                />
              </div>
            </div>
            <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">位置信息仅在本机演示环境使用，发送后以卡片形式出现在聊天中。</p>
          </div>
          <div className="px-4 pb-[30px] pt-3">
            <button
              type="button"
              disabled={!ok}
              data-testid="qq-loc-custom-send"
              onClick={() => ok && onSend({ name: name.trim(), addr: addr.trim() })}
              className={`h-12 w-full rounded-full text-[16px] font-medium text-white ${ok ? 'bg-[#1B9FF0] active:opacity-85' : 'bg-[#9FD6FA]'}`}
            >
              发送位置
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto pb-6">
            <div className="px-4 pt-3">
              <MapPreview className="h-[168px] w-full rounded-[14px] shadow-sm" label="当前所在位置" />
            </div>
            <button
              type="button"
              data-testid="qq-loc-custom"
              onClick={() => setCustom(true)}
              className="mt-3 flex h-14 w-full items-center gap-3 bg-white px-4 text-left active:bg-black/[0.03] dark:bg-[#232529] dark:active:bg-white/[0.05]"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#1B9FF0]/10 text-[#1B9FF0]" aria-hidden="true">
                <SquarePen className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </span>
              <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">自定义位置</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
            <p className="px-4 pb-1 pt-4 text-[13px] text-black/40 dark:text-white/40">附近位置</p>
            <div className="overflow-hidden bg-white dark:bg-[#232529]">
              {LOC_PRESETS.map((l, i) => (
                <button
                  key={l.name}
                  type="button"
                  data-testid={`qq-loc-item-${i}`}
                  onClick={() => onSend({ name: l.name, addr: l.addr, lat: l.lat, lng: l.lng })}
                  className={`flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05] ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.06]' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] text-[#1F2329] dark:text-white">{l.name}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-black/40 dark:text-white/40">{l.addr}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-black/35 dark:text-white/35">{l.dist}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- 支付方式 / 支付密码（红包/转账付款 + 微信风格自绘键盘） ----------------

/** 支付方式选择底部弹层（QQ钱包余额 / 银行卡，发红包/转账页用） */
export function PayMethodSheet({ wallet, cards, selectedId, onClose, onPick }: { wallet: WalletData; cards: BankCard[]; selectedId: string; onClose: () => void; onPick: (id: string) => void }) {
  const rows: Array<{ id: string; name: string; sub: string; node: React.ReactNode }> = [
    {
      id: 'balance',
      name: 'QQ钱包余额',
      sub: `可用 ${fmtMoney(wallet.balance)} 元`,
      node: (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1B9FF0] text-white" aria-hidden="true">
          <Wallet className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
      ),
    },
    ...cards.map((c) => {
      const meta = BANK_META[c.bank] ?? BANK_FALLBACK;
      return {
        id: c.id,
        name: `${c.bank} ${c.type ?? '储蓄卡'}`,
        sub: `尾号${c.last4} · 可用 ${fmtMoney(c.balance ?? 0)} 元`,
        node: (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-white" style={{ backgroundImage: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }} aria-hidden="true">
            {c.bank.slice(0, 1)}
          </span>
        ),
      };
    }),
  ];
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label="选择支付方式" onClick={onClose}>
      <div className="rounded-t-[18px] bg-white px-4 pb-8 pt-3 dark:bg-[#232529]" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-black/15 dark:bg-white/20" aria-hidden="true" />
        <p className="py-1 text-center text-[16px] font-medium text-[#1F2329] dark:text-white">选择支付方式</p>
        <div className="mt-1 max-h-[320px] overflow-y-auto">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              data-testid={`qq-pay-method-${r.id === 'balance' ? 'balance' : (cards.find((c) => c.id === r.id)?.last4 ?? r.id)}`}
              onClick={() => onPick(r.id)}
              className="flex w-full items-center gap-3 rounded-[12px] px-2 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              {r.node}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-[#1F2329] dark:text-white">{r.name}</span>
                <span className="block text-[12px] text-black/40 dark:text-white/40">{r.sub}</span>
              </span>
              {selectedId === r.id ? <Check className="h-5 w-5 shrink-0 text-[#1B9FF0]" strokeWidth={2.5} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-2 h-11 w-full rounded-full bg-black/[0.05] text-[15px] text-[#1F2329] active:opacity-70 dark:bg-white/10 dark:text-white">
          取消
        </button>
      </div>
    </div>
  );
}

/** 微信风格 6 位支付密码自绘数字键盘（不唤起系统键盘；校验逻辑由父级完成，errorKey 变化时父级重挂载本组件 → 清空并抖动） */
export function PayPwdSheet({ title, sub, hint, errorKey, locked = false, onComplete, onClose }: { title: string; sub?: string; hint?: string; errorKey: number; locked?: boolean; onComplete: (pwd: string) => void; onClose: () => void }) {
  const [digits, setDigits] = useState('');
  // 用 ref 累加避免同一 tick 内连点被 React 批处理吞掉（每次 push 都基于最新串）
  const acc = useRef('');
  const push = (d: string) => {
    if (locked) return;
    const next = (acc.current + d).slice(0, 6);
    acc.current = next;
    setDigits(next);
    if (next.length === 6) {
      const done = next;
      acc.current = '';
      window.setTimeout(() => onComplete(done), 150);
    }
  };
  const keyBtn =
    'flex h-[52px] items-center justify-center bg-white text-[22px] font-medium text-[#1F2329] active:bg-black/[0.07] dark:bg-[#2A2C31] dark:text-white dark:active:bg-white/10';
  return (
    <div className="rounded-t-[18px] bg-[#F2F3F5] pb-7 dark:bg-[#1B1C1F]" onClick={(e) => e.stopPropagation()} data-testid="qq-keypad">
      <style>{'@keyframes qqShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}'}</style>
      <div className="relative flex h-12 items-center justify-center border-b border-black/[0.06] dark:border-white/[0.08]">
        <button type="button" aria-label="关闭" data-testid="qq-keypad-close" onClick={onClose} className="absolute left-3 grid h-8 w-8 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10">
          <X className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <p className="text-[16px] font-medium text-[#1F2329] dark:text-white">{title}</p>
      </div>
      {sub ? <p className="pb-1 pt-2 text-center text-[13px] text-black/45 dark:text-white/45">{sub}</p> : null}
      <div className="mx-auto mt-2 flex w-fit gap-2.5" style={errorKey > 0 ? { animation: 'qqShake 0.46s' } : undefined}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="grid h-11 w-10 place-items-center rounded-[8px] border border-black/15 bg-white dark:border-white/20 dark:bg-white/[0.06]" aria-hidden="true">
            {i < digits.length ? <span className="h-2.5 w-2.5 rounded-full bg-[#1F2329] dark:bg-white" /> : null}
          </span>
        ))}
      </div>
      <p className="mt-2 h-5 text-center text-[13px] text-[#F5455C]" aria-live="polite">
        {hint ?? ''}
      </p>
      <div className={`grid grid-cols-3 gap-[1px] border-t border-black/10 bg-black/10 dark:border-white/10 dark:bg-white/10 ${locked ? 'opacity-40 pointer-events-none' : ''}`}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" data-testid={`qq-keypad-${k}`} onClick={() => push(k)} className={keyBtn} disabled={locked}>
            {k}
          </button>
        ))}
        <span className="bg-white dark:bg-[#2A2C31]" aria-hidden="true" />
        <button type="button" data-testid="qq-keypad-0" onClick={() => push('0')} className={keyBtn} disabled={locked}>
          0
        </button>
        <button type="button" aria-label="删除" data-testid="qq-keypad-del" onClick={() => { if (!locked) { acc.current = acc.current.slice(0, -1); setDigits(acc.current); } }} className={keyBtn} disabled={locked}>
          <Delete className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** 支付密码验证浮层（红包/转账/充值/提现/小金库支付前调用；正确回调 onOk，错误清空重输）。
 *  #97：5 次失败 30s 锁定——锁定期间禁用输入并显示倒计时，防止暴力试错 */
export function PayPwdGate({ label, onOk, onClose }: { label: string; onOk: () => void; onClose: () => void }) {
  const [errKey, setErrKey] = useState(0);
  const [lock, setLock] = useState<QqPayPwdLockData>(() => qqLoadPayPwdLock());
  const [remainSec, setRemainSec] = useState(0);
  useEffect(() => {
    if (lock.lockedUntil <= 0) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((lock.lockedUntil - Date.now()) / 1000));
      setRemainSec(remain);
      if (remain <= 0) {
        const cleared = { fails: 0, lockedUntil: 0 };
        qqSavePayPwdLock(cleared);
        setLock(cleared);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lock.lockedUntil]);
  const isLocked = lock.lockedUntil > 0 && Date.now() < lock.lockedUntil;
  return (
    <div className="absolute inset-0 z-[60] flex flex-col justify-end bg-black/60" role="dialog" aria-label="验证支付密码" onClick={isLocked ? undefined : onClose}>
      <PayPwdSheet
        key={errKey}
        title="请输入支付密码"
        sub={label}
        hint={isLocked ? `密码错误次数过多，请 ${remainSec} 秒后再试` : errKey > 0 ? `密码错误，请重新输入${lock.fails > 0 ? `（已失败 ${lock.fails} 次，5 次后将锁定 30 秒）` : ''}` : undefined}
        errorKey={errKey}
        locked={isLocked}
        onClose={onClose}
        onComplete={(pwd) => {
          if (isLocked) return;
          const d = loadPayPwd();
          if (d.pwd && pwd === d.pwd) {
            qqClearPayPwdLock();
            onOk();
          } else {
            const next = qqRecordPayPwdFail();
            setLock(next);
            setErrKey((k) => k + 1);
          }
        }}
      />
    </div>
  );
}

/** 支付设置页（支付密码开启/关闭/修改；微信风格自绘 6 位数字键盘） */
export function PaySettingsPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [data, setData] = useState(() => loadPayPwd());
  const [flow, setFlow] = useState<null | { mode: 'set' | 'confirm' | 'verify-off' | 'verify-change'; first?: string }>(null);
  const [errKey, setErrKey] = useState(0);
  // #97 锁定状态（verify-off/verify-change 失败累加，成功清零；5 次 30s 锁定）
  const [lock, setLock] = useState<QqPayPwdLockData>(() => qqLoadPayPwdLock());
  const [remainSec, setRemainSec] = useState(0);
  useEffect(() => {
    if (lock.lockedUntil <= 0) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((lock.lockedUntil - Date.now()) / 1000));
      setRemainSec(remain);
      if (remain <= 0) {
        const cleared = { fails: 0, lockedUntil: 0 };
        qqSavePayPwdLock(cleared);
        setLock(cleared);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lock.lockedUntil]);
  const isLocked = lock.lockedUntil > 0 && Date.now() < lock.lockedUntil;
  const enabled = data.enabled && !!data.pwd;
  const meta = flow
    ? flow.mode === 'set'
      ? { title: '设置支付密码', sub: '请输入 6 位数字' }
      : flow.mode === 'confirm'
        ? { title: '确认支付密码', sub: '请再次输入' }
        : flow.mode === 'verify-off'
          ? { title: '关闭支付密码', sub: '验证后即可关闭' }
          : { title: '修改支付密码', sub: '请输入原支付密码' }
    : null;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
      <WalletNavHeader title="支付设置" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        <div className="flex items-center gap-3 rounded-[14px] bg-[#FFF7E8] px-4 py-3.5 text-[13px] leading-relaxed text-[#8A6A3F] dark:bg-[#3A3222]/60 dark:text-[#E3C893]">
          <Fingerprint className="h-6 w-6 shrink-0" strokeWidth={1.7} aria-hidden="true" />
          开启后，发红包、转账、充值、提现与小金库转入转出都需要先验证支付密码
        </div>
        <div className="mt-4 overflow-hidden rounded-[14px] bg-white dark:bg-[#232529]">
          <div className="flex min-h-[58px] items-center gap-3 border-b border-black/[0.04] px-4 py-2.5 dark:border-white/[0.06]">
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] text-[#1F2329] dark:text-white">支付密码</span>
              <span className="mt-0.5 block text-[12px] text-black/40 dark:text-white/40">{enabled ? '已开启 · 支付时需验证' : '未开启'}</span>
            </span>
            <button
              type="button"
              data-testid="qq-pay-toggle"
              aria-label={enabled ? '关闭支付密码' : '开启支付密码'}
              aria-pressed={enabled}
              onClick={() => {
                setErrKey(0);
                setFlow(enabled ? { mode: 'verify-off' } : { mode: 'set' });
              }}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${enabled ? 'bg-[#0099FF]' : 'bg-black/20 dark:bg-white/25'}`}
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} aria-hidden="true" />
            </button>
          </div>
          {enabled ? (
            <button
              type="button"
              data-testid="qq-pay-change"
              onClick={() => {
                setErrKey(0);
                setFlow({ mode: 'verify-change' });
              }}
              className="flex min-h-[54px] w-full items-center px-4 py-2.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.05]"
            >
              <span className="flex-1 text-[16px] text-[#1F2329] dark:text-white">修改支付密码</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">支付密码为 6 位数字，仅保存在本机浏览器（localStorage），用于本机演示支付验证。</p>
      </div>
      {flow && meta ? (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/55" role="dialog" aria-label={meta.title} onClick={() => setFlow(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <PayPwdSheet
              key={`${flow.mode}-${errKey}`}
              title={meta.title}
              sub={meta.sub}
              hint={isLocked ? `密码错误次数过多，请 ${remainSec} 秒后再试` : errKey > 0 ? `密码错误，请重新输入${lock.fails > 0 ? `（已失败 ${lock.fails} 次，5 次后将锁定 30 秒）` : ''}` : undefined}
              errorKey={errKey}
              locked={isLocked}
              onClose={() => setFlow(null)}
              onComplete={(pwd) => {
                if (isLocked) return;
                if (flow.mode === 'set') {
                  setErrKey(0);
                  setFlow({ mode: 'confirm', first: pwd });
                } else if (flow.mode === 'confirm') {
                  if (pwd === flow.first) {
                    savePayPwd({ enabled: true, pwd });
                    setData(loadPayPwd());
                    qqClearPayPwdLock();
                    setFlow(null);
                    onToast('支付密码已开启');
                  } else {
                    onToast('两次输入不一致，请重新设置');
                    setErrKey((k) => k + 1);
                    setFlow({ mode: 'set' });
                  }
                } else if (flow.mode === 'verify-off') {
                  if (pwd === data.pwd) {
                    savePayPwd({ enabled: false, pwd: null });
                    setData(loadPayPwd());
                    qqClearPayPwdLock();
                    setFlow(null);
                    onToast('支付密码已关闭');
                  } else {
                    setLock(qqRecordPayPwdFail());
                    setErrKey((k) => k + 1);
                  }
                } else if (pwd === data.pwd) {
                  setErrKey(0);
                  qqClearPayPwdLock();
                  setFlow({ mode: 'set' });
                } else {
                  setLock(qqRecordPayPwdFail());
                  setErrKey((k) => k + 1);
                }
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
