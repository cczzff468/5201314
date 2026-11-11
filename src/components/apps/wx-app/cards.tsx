'use client';

/** 位置/亲属卡气泡 + 加号面板/红包/转账/支付方式/详情页 —— v1.9.27 任务10 从 wechat.tsx 按功能域拆分；顶层声明全部导出供兄弟模块与入口桶引用。 */

import { useState } from 'react';
import { ArrowLeftRight, Camera, Check, Clock, Gift, Heart, Headphones, Image as ImageIcon, Loader2, MapPin, Phone, Smile, Sparkles, Star, Undo2, Users, Video, X, ChevronLeft, ChevronRight } from 'lucide-react';
// v1.9.12 聊天滚动重做（全端共享）：进入即到底/发送必到底/贴底跟随/看历史时「有新消息」轻提示
// Task 40 错误提示优化 + 草稿箱：错误分类与连续失败冷却、会话草稿持久化、失败灰字提示行组件
import { RtPlusCamera, RtPlusImage, RtPlusVoice, RtPlusRedPacket, RtPlusTransfer, RtPlusLocation, RtPlusOffline, RtPlusTextCard, RtPlusTogether, RtPlusGift, RtPlusVideo } from '../retro-icons';
import { type GroupCardData } from '@/lib/ios/group-social';
// 美团×AI 联动（外卖参与/双向代付）：动作执行、上下文块、历史序列化
// 深度思考：指令注入 + [思考]块剥离 + 开关（IndexedDB 按联系人隔离，渲染订阅版随设置页切换即时刷新）
// v1.3 Shizuku 自主权：[手机操作:命令] 标记的执行器 + 按开关动态注入的教学规则（设置 APP → AI 动手）
// 第十六轮：AI 动态状态（情绪+作息）注入 + 送礼物情绪事件
// v33【AI 真人社交】：X论坛近况感知块（TA 发的帖/我发的帖/评论互动 → 私聊能自然提起）
// 多账号 v2（Task 40-2a）：per-app 账号 API——accLs 键作用域调用时现算；switchAccountFor 切换只写标记+派发事件（不刷新网页）
// 第三十四轮：添加账号弹层（AccountAddSheet）删除——「添加账号」改为直接用账号密码登录（LoginScreen）
import type { ContactRecord } from '@/lib/contacts';
// v73 AI 聊天悬浮小窗：顶栏「小窗模式」按钮入口（打开全局小窗并退出全屏聊天）
import { fmtMoney, loadCards, BankDot, resetFamilyCardsInMonth, type WxCard, type WxFamilyCardIn } from '../wechat-wallet';
import { type ChatLocData } from '@/lib/ios/chat-location';

import { fmtFullDate, fmtFullTime, sanitizeAmount, wxCanPay, wxFcGroups, wxLoadBalance, wxMethodLabel } from './core';
import { EllipsisGlyph, WxAvatar } from './widgets';

// ---------------- 位置 + 亲属卡聊天卡片 ----------------

/** 位置页内置地点（点击直接发送位置卡片；经纬度随消息落盘，AI 可读到“用户在哪”） */
export const WX_LOCATIONS: Array<ChatLocData> = [
  { name: '广州塔', address: '广东省广州市海珠区阅江西路222号', lat: 23.1066, lng: 113.3245 },
  { name: '天安门广场', address: '北京市东城区东长安街', lat: 39.9032, lng: 116.3916 },
  { name: '外滩', address: '上海市黄浦区中山东一路', lat: 31.2336, lng: 121.4903 },
  { name: '深圳湾公园', address: '广东省深圳市南山区滨海大道', lat: 22.5178, lng: 113.9367 },
  { name: '西湖风景区', address: '浙江省杭州市西湖区龙井路1号', lat: 30.2429, lng: 120.1476 },
  { name: '春熙路', address: '四川省成都市锦江区', lat: 30.657, lng: 104.081 },
];

/** 简易地图艺术块（位置卡片 / 位置页 / 位置详情复用：米色底 + 道路线网 + 绿地水域 + 红色定位针） */
export function LocMapArt({ className = '', pinSize = 22 }: { className?: string; pinSize?: number }) {
  return (
    <span className={`relative block overflow-hidden bg-[#EAE7DE] dark:bg-[#26261F] ${className}`} aria-hidden="true">
      <span className="absolute left-0 top-[38%] h-[7px] w-full bg-white/90 dark:bg-white/15" />
      <span className="absolute left-[30%] top-0 h-full w-[6px] bg-white/90 dark:bg-white/15" />
      <span className="absolute left-[-10%] top-[8%] h-[4px] w-[75%] rotate-[24deg] bg-white/60 dark:bg-white/10" />
      <span className="absolute left-[42%] top-[30%] h-[4px] w-[70%] rotate-[38deg] bg-[#F6D98A]/80 dark:bg-[#5A5142]" />
      <span className="absolute left-[8%] top-[62%] h-[5px] w-[60%] rotate-[-16deg] bg-white/60 dark:bg-white/10" />
      <span className="absolute right-[6%] top-[8%] h-[26%] w-[22%] rounded-[6px] bg-[#CDE3C1]/80 dark:bg-[#2C3526]" />
      <span className="absolute bottom-[8%] left-[6%] h-[22%] w-[20%] rounded-[6px] bg-[#BFD9EA]/80 dark:bg-[#22303A]" />
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        <span
          className="relative block rotate-45 rounded-full rounded-br-full bg-[#E64340] shadow-[0_2px_4px_rgba(0,0,0,0.28)]"
          style={{ width: pinSize, height: pinSize }}
        >
          <span className="absolute inset-[26%] rounded-full bg-white" />
        </span>
      </span>
    </span>
  );
}

/** 亲属卡黄色圆标（白色卡片 + 环绕轨道 + 小心，对照微信亲属卡图标） */
export function FamGlyph({ size = 42 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: 'linear-gradient(180deg, #FFCE43, #F5B000)' }}
      aria-hidden="true"
    >
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none">
        <rect x="5.8" y="8.4" width="12" height="8" rx="1.5" transform="rotate(-14 11.8 12.4)" fill="#fff" />
        <path d="M3 12.8c1.1 3.7 6.2 6.3 11.6 5.4 4.3-.7 7.2-3.2 7.5-6.2" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
        <path
          d="M19.1 3.4c.42-.5 1.22-.5 1.64 0 .42-.5 1.22-.5 1.64 0 .48.55.34 1.4-.24 1.9l-1.4 1.2-1.4-1.2c-.58-.5-.72-1.35-.24-1.9z"
          fill="#fff"
        />
      </svg>
    </span>
  );
}

/** 亲属卡聊天卡片（图①：白底 + 黄圆图标 + 「给C的亲属卡/待对方领取」+ 右侧淡黄星球轨道装饰 + 左下「亲属卡」；领取/退回后卡片颜色变灰） */
export function FamilyBubble({ title, sub, settled, fromMe, onClick }: { title: string; sub: string; settled: boolean; fromMe?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-fc-bubble"
      onClick={onClick}
      className="chat-card chat-card-fam relative block w-[206px] text-left shadow-sm transition-all duration-300 active:brightness-[0.97]"
      style={{ filter: settled ? 'grayscale(0.62) brightness(0.97)' : undefined }}
      aria-label={`${title}（${sub}）`}
    >
      {/* 小尾巴：白卡同色菱形（与红包/转账/礼物卡同轮统一），尖角处带一点圆弧 */}
      <span
        aria-hidden="true"
        className={`chat-card-tail absolute top-[11px] h-[13px] w-[13px] rotate-45 bg-white dark:bg-[#1E1E1E] ${fromMe === false ? '-left-[3px]' : '-right-[3px]'}`}
        style={{ borderRadius: fromMe === false ? '2px 2px 2px 3px' : '2px 3px 2px 2px' }}
      />
      <span className="chat-card-body relative block overflow-hidden rounded-[4px] bg-white dark:bg-[#1E1E1E]">
        <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-[#FBF0C4] dark:bg-[#3B3722]" />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-3 top-4 h-[82px] w-[150px] -rotate-[24deg] rounded-[50%] border-[3px] border-[#F6DFA2] dark:border-[#4A4426]"
        />
        <span className="relative flex items-center gap-2.5 px-3 pb-1.5 pt-3">
          <FamGlyph size={42} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-medium leading-snug text-[#574423] dark:text-[#E6D6AE]" data-testid="wx-fc-bubble-title">
              {title}
            </span>
            <span className="mt-0.5 block truncate text-[13px] text-[#BCA678] dark:text-[#9A8B62]" data-testid="wx-fc-bubble-status">
              {sub}
            </span>
          </span>
        </span>
        <span className="chat-card-label relative block px-3 pb-2 pt-2 text-[12px] text-black/30 dark:text-white/30">亲属卡</span>
      </span>
    </button>
  );
}

/** 位置聊天卡片（微信同款：上部名称/地址白底 + 下方小地图 + 红色定位针；群聊复用同一套组件） */
export function LocBubble({ name, address, onClick }: { name: string; address: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-loc-bubble"
      onClick={onClick}
      className="block w-[206px] overflow-hidden rounded-[8px] bg-white text-left shadow-sm active:brightness-95 dark:bg-[#1E1E1E]"
    >
      <span className="block px-3 pb-2 pt-2.5">
        <span className="block truncate text-[15px] leading-snug">{name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-black/40 dark:text-white/40">{address}</span>
      </span>
      <LocMapArt className="h-[64px] w-full" pinSize={24} />
    </button>
  );
}

/** 图片消息气泡（圆角直出，点开全屏预览）：中等尺寸（用户反馈过大 → 从 250×330 收敛）。
 *  img 用固定像素上限（max-w/max-h 均为绝对值，按比例缩放互不冲突；百分比在 flex 包裹层内会循环解析导致尺寸失真）；群聊复用同一套组件 */
export function ImageMsgBubble({ src, onClick }: { src: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-img-bubble"
      onClick={onClick}
      className="block overflow-hidden rounded-[6px] active:opacity-80"
    >
      <img src={src} alt="图片消息" className="block max-h-[220px] w-auto min-w-[110px] max-w-[168px] object-cover" loading="lazy" />
    </button>
  );
}

/** 位置页（大地图 + 内置地点列表 + 自定义位置；选中即发送位置卡片；群聊复用同一套组件） */
export function LocationPickerPage({
  onClose,
  onSend,
  onToast,
}: {
  onClose: () => void;
  onSend: (name: string, address: string, coords?: { lat?: number; lng?: number }) => void;
  onToast: (m: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const submitCustom = () => {
    const n = name.trim();
    if (!n) {
      onToast('请输入位置名称');
      return;
    }
    onSend(n, address.trim() || n);
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-loc-picker">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-loc-back" onClick={onClose} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 text-center text-[17px] font-medium">{custom ? '自定义位置' : '位置'}</div>
          <span className="w-[46px]" />
        </div>
      </div>
      {custom ? (
        <div className="min-h-0 flex-1 px-4 pt-4">
          <div className="rounded-[10px] bg-white px-4 dark:bg-[#1A1A1A]">
            <input
              data-testid="wx-loc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="位置名称"
              autoFocus
              className="h-[52px] w-full border-b border-black/[0.06] bg-transparent text-[16px] outline-none placeholder:text-black/30 dark:border-white/[0.08] dark:placeholder:text-white/30"
            />
            <input
              data-testid="wx-loc-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="详细地址（可选）"
              className="h-[52px] w-full bg-transparent text-[15px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
          </div>
          <button
            type="button"
            data-testid="wx-loc-send"
            onClick={submitCustom}
            className="mt-6 h-12 w-full rounded-[8px] bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56]"
          >
            发送位置
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          <LocMapArt className="mx-4 mt-3 h-[170px] rounded-[10px]" pinSize={34} />
          <div className="mt-3 bg-white dark:bg-[#1A1A1A]">
            {WX_LOCATIONS.map((l, i) => (
              <button
                key={l.name}
                type="button"
                data-testid={`wx-loc-item-${i}`}
                onClick={() => onSend(l.name, l.address, { lat: l.lat, lng: l.lng })}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                  i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.07]' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px]">{l.name}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-black/40 dark:text-white/40">{l.address}</span>
                </span>
                <MapPin className="h-[18px] w-[18px] shrink-0 text-[#E64340]" strokeWidth={1.8} />
              </button>
            ))}
          </div>
          <button
            type="button"
            data-testid="wx-loc-custom"
            onClick={() => setCustom(true)}
            className="mt-3 flex w-full items-center justify-between bg-white px-4 py-3.5 text-left text-[16px] active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
          >
            自定义位置
            <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}

/** 位置详情页（点聊天中的位置卡片进入：大地图 + 名称地址；群聊复用同一套组件） */
export function LocViewLayer({ name, address, onClose }: { name: string; address: string; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-loc-view">
      <div className="flex h-12 shrink-0 items-center px-2 pt-[54px]">
        <button type="button" aria-label="关闭" data-testid="wx-loc-view-close" onClick={onClose} className="active:opacity-60">
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <div className="flex-1 text-center text-[16px] font-medium">位置</div>
        <span className="w-[46px]" />
      </div>
      <div className="min-h-0 flex-1 px-4 pt-3">
        <LocMapArt className="h-[44vh] rounded-[10px]" pinSize={40} />
        <div className="mt-3 rounded-[10px] bg-white px-4 py-3 dark:bg-[#1A1A1A]">
          <p className="text-[17px]">{name}</p>
          <p className="mt-1 text-[13px] text-black/45 dark:text-white/45">{address}</p>
        </div>
      </div>
    </div>
  );
}


/** 亲属卡领取页（图②：好友发我的——对方名 + 赠语 + 每月额度 + 说明 + 黄卡「X送的亲属卡」 + 对方头像 + 领取/退还按钮 + 财付通脚注） */
export function WxFcClaimPage({
  peerName,
  peerAvatar,
  limit,
  message,
  claimed,
  claimedAt,
  rejected,
  onBack,
  onClaim,
  onRefund,
  onToast,
}: {
  peerName: string;
  peerAvatar: string | null;
  limit: number;
  message: string;
  claimed: boolean;
  claimedAt?: number;
  /** 被退还/拒收（终态，显示已退回） */
  rejected?: boolean;
  onBack: () => void;
  onClaim: () => void;
  /** 退还（拒收）该亲属卡 */
  onRefund: () => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-claim">
      <div className="flex h-12 shrink-0 items-center px-2 pt-[54px]">
        <button type="button" aria-label="返回" data-testid="wx-fc-claim-back" onClick={onBack} className="active:opacity-60">
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <div className="flex-1 text-center text-[17px] font-medium">亲属卡</div>
        <span className="w-[46px]" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2">
        <p className="mt-8 text-[26px] font-medium" data-testid="wx-fc-claim-name">
          {peerName}
        </p>
        <p className="mt-7 text-[16px] leading-relaxed">{message}</p>
        <p className="mt-2 text-[16px]" data-testid="wx-fc-claim-limit">
          每月可用额度¥{fmtMoney(limit)}
        </p>
        {rejected ? (
          <p className="mt-3 text-[13px] text-black/45 dark:text-white/45" data-testid="wx-fc-claim-rejected">已退回该亲属卡</p>
        ) : claimed && typeof claimedAt === 'number' ? (
          <p className="mt-3 text-[13px] text-[#06AE56]" data-testid="wx-fc-claim-done">
            已于 {fmtFullDate(claimedAt)} 领取
          </p>
        ) : null}
        <p className="mt-6 text-[13px] leading-relaxed text-black/40 dark:text-white/40">
          领取后优先使用该卡支付，赠送方承担费用并收到通知，1天内未领取则自动作废。
          <button type="button" onClick={() => onToast('使用说明暂未开放')} className="text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
            使用说明
          </button>
        </p>
        <div
          className="relative mt-6 overflow-hidden rounded-[10px] px-4 py-4"
          style={{ background: 'linear-gradient(135deg, #FDF3CE 0%, #FAE7A8 100%)' }}
          data-testid="wx-fc-claim-card"
        >
          <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full bg-[#F7E39A]/70" />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-2 top-6 h-[64px] w-[120px] -rotate-[22deg] rounded-[50%] border-[3px] border-[#EFCE74]/80"
          />
          <div className="relative flex items-center gap-3">
            <FamGlyph size={40} />
            <span className="text-[17px] font-medium text-[#C08A3A]">{peerName}送的亲属卡</span>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2.5 pb-4">
          <WxAvatar src={peerAvatar} alt={peerName} size={44} />
          <span className="text-[15px]">{peerName}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center px-5 pb-7">
        {rejected ? (
          <div className="w-[68%] rounded-[8px] bg-white py-3.5 text-center text-[17px] text-black/30 dark:text-white/30" data-testid="wx-fc-claim-btn">
            已退回
          </div>
        ) : claimed ? (
          <div className="w-[68%] rounded-[8px] bg-white py-3.5 text-center text-[17px] text-black/30 dark:text-white/30" data-testid="wx-fc-claim-btn">
            已领取
          </div>
        ) : (
          <div className="flex w-[68%] flex-col gap-2.5">
            <button
              type="button"
              data-testid="wx-fc-claim-btn"
              onClick={onClaim}
              className="rounded-[8px] bg-white py-3.5 text-center text-[17px] text-[#06AE56] shadow-sm active:bg-black/[0.03]"
            >
              领取
            </button>
            <button
              type="button"
              data-testid="wx-fc-refund-btn"
              onClick={onRefund}
              className="rounded-[8px] bg-white py-3.5 text-center text-[17px] text-black/55 shadow-sm active:bg-black/[0.03] dark:text-white/60"
            >
              退还
            </button>
          </div>
        )}
        <p className="mt-8 text-[13px] text-black/30 dark:text-white/30">本服务由财付通提供</p>
      </div>
    </div>
  );
}

/** 亲属卡管理详情页（图③：我送的——对方头像 + 本月已用 + 每月消费上限[修改] + 对方领取时间 + 优先扣款方式 + 消费记录） */
export function WxFcManagePage({
  peerName,
  peerAvatar,
  limit,
  used,
  claimed,
  claimedAt,
  method,
  onBack,
  onEditLimit,
  onPickMethod,
  onToast,
}: {
  peerName: string;
  peerAvatar: string | null;
  limit: number;
  used: number;
  claimed: boolean;
  claimedAt?: number;
  method: string;
  onBack: () => void;
  onEditLimit: (v: number) => void;
  onPickMethod: (m: string) => void;
  onToast: (m: string) => void;
}) {
  const [limitSheet, setLimitSheet] = useState(false);
  const [methodSheet, setMethodSheet] = useState(false);
  const [draft, setDraft] = useState('');
  const cards = loadCards();
  const monthLabel = `${new Date().getMonth() + 1}月`;
  const saveLimit = () => {
    const n = Number(draft);
    if (!draft || Number.isNaN(n) || n <= 0) {
      onToast('请输入正确的金额');
      return;
    }
    onEditLimit(Math.round(n * 100) / 100);
    setLimitSheet(false);
  };
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-detail">
      <div className="flex h-12 shrink-0 items-center px-2 pt-[54px]">
        <button type="button" aria-label="返回" data-testid="wx-fc-detail-back" onClick={onBack} className="active:opacity-60">
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <div className="flex-1" />
        <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')} className="px-3 active:opacity-60">
          <EllipsisGlyph />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center px-8 pt-5">
          <WxAvatar src={peerAvatar} alt={peerName} size={72} />
          <p className="mt-5 text-center text-[16px]" data-testid="wx-fc-detail-title">
            给{peerName}的亲属卡，本月已用额度
          </p>
          <p className="mt-3 font-semibold" data-testid="wx-fc-detail-used">
            <span className="text-[22px]">¥ </span>
            <span className="text-[44px] leading-none">{fmtMoney(used)}</span>
          </p>
          <p className="mt-3 text-[14px] text-black/45 dark:text-white/45">
            每月消费上限 ¥{fmtMoney(limit)}
            <button
              type="button"
              data-testid="wx-fc-edit-limit"
              onClick={() => {
                setDraft(String(limit));
                setLimitSheet(true);
              }}
              className="ml-2 text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
            >
              修改
            </button>
          </p>
        </div>
        <div className="mt-9 border-t border-black/[0.06] px-5 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3 py-4 text-[15px]">
            <span className="shrink-0 text-black/45 dark:text-white/45">对方领取时间</span>
            <span data-testid="wx-fc-detail-claimtime">{claimed && claimedAt ? fmtFullDate(claimedAt) : '待对方领取'}</span>
          </div>
          <button
            type="button"
            data-testid="wx-fc-method"
            onClick={() => setMethodSheet(true)}
            className="flex w-full items-center justify-between gap-3 border-t border-black/[0.06] py-4 text-left text-[15px] active:opacity-70 dark:border-white/[0.08]"
          >
            <span className="shrink-0 text-black/45 dark:text-white/45">优先扣款方式</span>
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                style={{ background: 'linear-gradient(180deg, #FFCE43, #F5B000)' }}
              >
                ¥
              </span>
              <span className="truncate">{method}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        </div>
        <div className="h-[10px] bg-[#EDEDED] dark:bg-[#161616]" />
        <div className="px-5">
          <div className="flex items-center justify-between py-4">
            <span className="text-[17px]">消费记录</span>
            <button
              type="button"
              onClick={() => onToast(used > 0 ? '消费记录详情暂未开放' : '本月暂无消费')}
              className="text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]"
            >
              详情
            </button>
          </div>
          <div className="flex items-center justify-between border-t border-black/[0.06] py-4 text-[15px] dark:border-white/[0.08]">
            <span>{monthLabel}</span>
            <span data-testid="wx-fc-detail-month">¥{fmtMoney(used)}</span>
          </div>
        </div>
      </div>

      {/* 修改每月消费上限弹层 */}
      {limitSheet && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setLimitSheet(false)} data-testid="wx-fc-limit-sheet">
          <div className="rounded-t-[14px] bg-[#EDEDED] px-4 pb-8 pt-4 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
            <p className="pb-3 text-center text-[15px] font-medium">修改每月消费上限</p>
            <div className="flex items-center gap-2 rounded-[10px] bg-white px-4 dark:bg-[#1A1A1A]">
              <span className="text-[18px] font-semibold">¥</span>
              <input
                data-testid="wx-fc-limit-input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(sanitizeAmount(e.target.value))}
                inputMode="decimal"
                placeholder="0.00"
                className="h-[52px] w-full bg-transparent text-[18px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
              />
            </div>
            <button
              type="button"
              data-testid="wx-fc-limit-ok"
              onClick={saveLimit}
              className="mt-4 h-12 w-full rounded-[8px] bg-[#07C160] text-[16px] font-medium text-white active:bg-[#06AD56]"
            >
              确定
            </button>
          </div>
        </div>
      )}

      {/* 优先扣款方式弹层（零钱 / 银行卡） */}
      {methodSheet && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/45" onClick={() => setMethodSheet(false)} data-testid="wx-fc-method-sheet">
          <div className="rounded-t-[14px] bg-[#EDEDED] px-3 pb-8 pt-3 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
            <p className="pb-2 text-center text-[15px] font-medium">优先扣款方式</p>
            <div className="rounded-[10px] bg-white dark:bg-[#1A1A1A]">
              {['零钱', ...cards.map((c) => `${c.bank} 储蓄卡`)].map((m, i) => (
                <button
                  key={m}
                  type="button"
                  data-testid={`wx-fc-method-${i}`}
                  onClick={() => {
                    onPickMethod(m);
                    setMethodSheet(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-[13px] text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                    i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.07]' : ''
                  }`}
                >
                  {i === 0 ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#07C160] text-[14px] font-semibold text-white">¥</span>
                  ) : (
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                      style={{ background: 'linear-gradient(180deg, #FFCE43, #F5B000)' }}
                    >
                      ¥
                    </span>
                  )}
                  <span className="flex-1">{m}</span>
                  {method === m && <Check className="h-5 w-5 shrink-0 text-[#07C160]" strokeWidth={2.4} aria-hidden="true" />}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMethodSheet(false)}
              className="mt-3 h-11 w-full rounded-[10px] bg-white text-[16px] active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 聊天页 ----------------

// ---------------- 聊天加号面板 + 红包/转账（对照用户微信截图 1:1） ----------------

export type PlusAction = 'camera' | 'image' | 'voicecall' | 'videocall' | 'redpacket' | 'transfer' | 'location' | 'offline' | 'textcard' | 'together' | 'gift';

/**
 * 「文字图片」弹层（加号面板「文字图片」入口；Task 13 卡片版，无生图依赖）。
 * 输入可空——留空时 AI 按人设+最近聊天记录代笔（/api/textcard）；输入非空 = 用户代笔直接上卡。
 * 生成中状态 + 失败错误（留在弹层可重试）。
 */
export function WxTextCardSheet({
  charName,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  charName: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    if (busy) return;
    onSubmit(text.trim());
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45" data-testid="wx-textcard-sheet">
      <div className="w-full max-w-[420px] rounded-t-[16px] bg-white px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-4 dark:bg-[#1C1C1E]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-semibold">写一张文字图片发给{charName}</p>
          <button
            type="button"
            aria-label="关闭文字图片"
            data-testid="wx-textcard-close"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-black/50 disabled:opacity-40 dark:bg-white/[0.08] dark:text-white/60"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          rows={3}
          maxLength={160}
          data-testid="wx-textcard-input"
          placeholder="写点想印在卡片上的字（留空 = AI 结合 TA 的人设和你们的聊天记录帮你写）"
          className="w-full resize-none rounded-[12px] border border-black/[0.08] bg-black/[0.02] p-3 text-[15px] leading-[1.6] outline-none placeholder:text-black/30 focus:border-[#07C160]/60 disabled:opacity-60 dark:border-white/[0.1] dark:bg-white/[0.05] dark:placeholder:text-white/30"
        />
        {error ? (
          <p data-testid="wx-textcard-error" className="mt-2 text-[13px] leading-[1.5] text-red-500">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="wx-textcard-submit"
          onClick={submit}
          disabled={busy}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#07C160] text-[16px] font-medium text-white active:opacity-80 disabled:opacity-40"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
              正在写文字图片…
            </>
          ) : (
            '生成并发送'
          )}
        </button>
        <p className="mt-2 text-center text-[11px] text-black/35 dark:text-white/35">
          文字图片以我的身份发出，{charName}会看到卡片上的字
        </p>
      </div>
    </div>
  );
}

/** 红包图标（线描红信封：矩形 + 封口弧 + 圆形封印，替换与「礼物」撞形的 Gift 图标） */
export function RedPacketIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M4 6.5 C7.5 9.5, 16.5 9.5, 20 6.5" />
      <circle cx="12" cy="13.5" r="2.6" />
    </svg>
  );
}

/** 加号面板（输入栏下方弹出，输入框跟随保留在面板上方）。
 *  液态玻璃主题（用户指定）：竖向乳白玻璃列表（图标左 + 文字右，lg-menu-row）。
 *  古早主题（第五十五轮，图1 同款）：白底平铺灰色图标（无彩色瓷贴）。
 *  第五十八轮（用户指定「视频聊天变成和其他一样」）：视频通话从底部深色宽按钮
 *  移回宫格，与其他项同一布局同一图标语言（RtPlusVideo）。
 *  面板保持原生全部功能（用户指定「加号面板里面的功能不要动」）；自定义只影响输入框上方快捷条 */
export function PlusPanel({ onAction, liquid, retro }: { onAction: (a: PlusAction) => void; liquid?: boolean; retro?: boolean }) {
  // 第五十六轮（参考图2 同款）：古早加号面板用深灰实心剪影图标（白镂空细节）——
  // 相机实心机身白镜头 / 图片描边山形太阳 / 实心地图针白环 / 实心圆白 ¥ 等老微信 5.0 语言；
  // 默认/液态面板继续用彩色瓷贴 + lucide 线稿（功能与项集不变，用户指定「面板功能不要动」）
  const all: Array<{ key: PlusAction; label: string; icon: React.ReactNode; retroIcon: React.ReactNode }> = [
    { key: 'camera', label: '相机', icon: <Camera className="h-[26px] w-[26px]" strokeWidth={1.6} />, retroIcon: <RtPlusCamera /> },
    { key: 'image', label: '图片', icon: <ImageIcon className="h-[26px] w-[26px]" strokeWidth={1.6} />, retroIcon: <RtPlusImage /> },
    { key: 'voicecall', label: '语音通话', icon: <Phone className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusVoice /> },
    { key: 'videocall', label: '视频通话', icon: <Video className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusVideo /> },
    { key: 'redpacket', label: '红包', icon: <RedPacketIcon />, retroIcon: <RtPlusRedPacket /> },
    { key: 'transfer', label: '转账', icon: <ArrowLeftRight className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusTransfer /> },
    { key: 'location', label: '位置', icon: <MapPin className="h-[26px] w-[26px]" strokeWidth={1.6} />, retroIcon: <RtPlusLocation /> },
    { key: 'offline', label: '线下', icon: <Star className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusOffline /> },
    { key: 'textcard', label: '文字图片', icon: <Sparkles className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusTextCard /> },
    { key: 'together', label: '一起听', icon: <Headphones className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusTogether /> },
    { key: 'gift', label: '礼物', icon: <Gift className="h-[25px] w-[25px]" strokeWidth={1.6} />, retroIcon: <RtPlusGift /> },
  ];
  return (
    <div
      className={`shrink-0 ${
        liquid
          ? /* 液态玻璃（第四十六轮变小：行 44/字 14.5/图标 20/圆角 20；第四十七轮删 mx 横向外边距——
             宽度由外层包裹容器右锚定 248px 控制）竖向乳白玻璃列表 */
            'lg-sheet mb-2.5 rounded-[20px] py-[4px]'
          : retro
          ? /* 古早（图1）：白底 + 硬边顶线，无彩色瓷贴 */
            'border-t border-[#C9CBD2] bg-[#F5F5F7] px-2 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] dark:border-[#3A3A44] dark:bg-[#232329]'
          : 'px-2 pt-4 border-t border-black/[0.05] bg-[#F7F7F7] pb-[max(16px,env(safe-area-inset-bottom))] dark:border-white/[0.06] dark:bg-[#161616]'
      }`}
      data-testid="wx-plus-panel"
    >
      {liquid ? (
        <div className="flex flex-col">
          {all.map((it) => (
            <button
              key={it.key}
              type="button"
              data-testid={`wx-plus-${it.key}`}
              onClick={() => onAction(it.key)}
              className="lg-menu-row flex h-[44px] w-full items-center gap-3.5 px-5 text-left text-[14.5px] font-semibold text-[#1C1C1E] dark:text-white/90"
            >
              <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center text-black/80 dark:text-white/85 [&_svg]:h-[20px] [&_svg]:w-[20px]">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      ) : retro ? (
        <div className="grid grid-cols-4">
          {all.map((it) => (
            <button
              key={it.key}
              type="button"
              data-testid={`wx-plus-${it.key}`}
              onClick={() => onAction(it.key)}
              className="flex flex-col items-center gap-[9px] py-2.5 active:bg-black/[0.05] dark:active:bg-white/[0.06]"
            >
              {/* 图2 同款：无瓷贴的深灰实心剪影图标（白镂空细节）+ 深灰小字；
                  视频通话同在宫格（第五十八轮用户指定「变成和其他一样」） */}
              <span className="flex h-[42px] w-[42px] items-center justify-center">{it.retroIcon}</span>
              <span className="text-[12px] text-[#6A6E78] dark:text-white/60">{it.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4">
          {all.map((it) => (
            <button
              key={it.key}
              type="button"
              data-testid={`wx-plus-${it.key}`}
              onClick={() => onAction(it.key)}
              className="flex flex-col items-center gap-[7px] py-2 active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span className="flex h-[57px] w-[57px] items-center justify-center rounded-[14px] bg-white text-black/70 shadow-[0_1px_5px_rgba(0,0,0,0.05)] dark:bg-[#242428] dark:text-white/75">
                {it.icon}
              </span>
              <span className="text-[12px] text-black/60 dark:text-white/60">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 输入框上方快捷功能条的图标/文案（与加号面板同源同文案；点击直接走 handlePlusAction，
 *  与点加号面板里那一项完全等效；面板本身不动）。
 *  第五十八轮（用户指定「输入框上面的功能图标变成古早主题图标」）：每项携带三主题图标——
 *  icon = 默认/液态玻璃共用现代线稿（液态在玻璃胶囊内），retroIcon = 古早实心剪影
 *  （与加号面板同语言，颜色走 --rt-ic-* 深浅自适应）；快捷条按主题选用 */
export const WX_QUICK_META: Record<string, { label: string; icon: React.ReactNode; retroIcon: React.ReactNode }> = {
  camera: { label: '相机', icon: <Camera className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusCamera /> },
  image: { label: '图片', icon: <ImageIcon className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusImage /> },
  voicecall: { label: '语音通话', icon: <Phone className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusVoice /> },
  videocall: { label: '视频通话', icon: <Video className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusVideo /> },
  redpacket: { label: '红包', icon: <RedPacketIcon />, retroIcon: <RtPlusRedPacket /> },
  transfer: { label: '转账', icon: <ArrowLeftRight className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTransfer /> },
  location: { label: '位置', icon: <MapPin className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusLocation /> },
  offline: { label: '线下', icon: <Star className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusOffline /> },
  textcard: { label: '文字图片', icon: <Sparkles className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTextCard /> },
  together: { label: '一起听', icon: <Headphones className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusTogether /> },
  gift: { label: '礼物', icon: <Gift className="h-[14px] w-[14px]" strokeWidth={2.2} />, retroIcon: <RtPlusGift /> },
};

/** 支付方式选择底部弹层（零钱 / 银行卡 / 我收到的亲属卡；发红包/转账页用；单聊/群聊共用） */
export function WxPayMethodSheet({
  cards,
  familyIn,
  selectedId,
  onClose,
  onPick,
}: {
  cards: WxCard[];
  familyIn: WxFamilyCardIn[];
  selectedId: string;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const rows: Array<{ id: string; name: string; sub: string; icon: React.ReactNode }> = [
    {
      id: 'balance',
      name: '零钱',
      sub: `可用 ${fmtMoney(wxLoadBalance())} 元`,
      icon: (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#07C160] text-[16px] font-semibold text-white" aria-hidden="true">
          ¥
        </span>
      ),
    },
    ...cards.map((c) => ({
      id: c.id,
      name: `${c.bank} 储蓄卡`,
      sub: `尾号${c.tail} · 可用 ${fmtMoney(c.balance)} 元`,
      icon: <BankDot bank={c.bank} size={36} />,
    })),
    // #22：同一赠卡人名下多张收到的亲属卡聚合为一行（行 id 取组内第一张卡，额度求和）；旧数据无 friendId 各自成行
    ...[...wxFcGroups(familyIn).values()].map((g) => ({
      id: g[0].id,
      name: `${g[0].fromName}的亲属卡${g.length > 1 ? `×${g.length}` : ''}`,
      sub: `${g[0].relation} · 本月可用 ${fmtMoney(g.reduce((s, f) => s + Math.max(0, f.monthlyLimit - f.used), 0))} 元`,
      icon: (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F7B500] to-[#F79C00] text-white" aria-hidden="true">
          <Heart className="h-[17px] w-[17px]" strokeWidth={2} />
        </span>
      ),
    })),
  ];
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" role="dialog" aria-label="选择支付方式" onClick={onClose} data-testid="wx-pay-method-sheet">
      <div className="rounded-t-[14px] bg-[#EDEDED] px-3 pb-8 pt-3 dark:bg-[#1C1C1C]" onClick={(e) => e.stopPropagation()}>
        <p className="pb-2 text-center text-[15px] font-medium">选择支付方式</p>
        <div className="max-h-[340px] overflow-y-auto rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          {rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              data-testid={`wx-pay-method-${r.id === 'balance' ? 'balance' : r.id.startsWith('fcin-') ? 'fc' : cards.find((c) => c.id === r.id)?.tail ?? r.id}`}
              onClick={() => onPick(r.id)}
              className={`relative flex w-full items-center gap-3 px-4 py-[13px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.07]' : ''
              }`}
            >
              {r.icon}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px]">{r.name}</span>
                <span className="block text-[12px] text-black/40 dark:text-white/40">{r.sub}</span>
              </span>
              {selectedId === r.id ? <Check className="h-5 w-5 shrink-0 text-[#07C160]" strokeWidth={2.4} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 h-11 w-full rounded-[10px] bg-white text-[16px] active:bg-black/[0.04] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
        >
          取消
        </button>
      </div>
    </div>
  );
}

/** 发红包页：金额/祝福语输入 + 支付方式行 + 底部「塞钱进红包」发送按钮（无数字键盘） */
export function RedPacketCompose({
  onBack,
  onSubmit,
  onToast,
}: {
  onBack: () => void;
  onSubmit: (amount: number, blessing: string, methodId: string) => void;
  onToast: (m: string) => void;
}) {
  const [val, setVal] = useState('');
  const [blessing, setBlessing] = useState('');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const cards = loadCards();
  const familyIn = resetFamilyCardsInMonth(); // 审计 #6：进入发送页先做跨月惰性重置，支付方式行「本月可用」即本月真实额度
  const num = parseFloat(val || '0');
  const ok = num >= 0.01;
  const denyToast = () => {
    if (methodId === 'balance') onToast('零钱不足，请先充值');
    else if (methodId.startsWith('fcin-')) onToast('亲属卡本月额度不足');
    else onToast('卡内余额不足，请更换支付方式');
  };
  const submit = () => {
    if (!ok) {
      onToast('请输入金额');
      return;
    }
    if (num > 200) {
      onToast('单个红包金额不可超过 200 元');
      return;
    }
    if (!wxCanPay(methodId, num)) {
      denyToast();
      return;
    }
    onSubmit(num, blessing.trim() || '恭喜发财，大吉大利', methodId);
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-rp-compose">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-rp-compose-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">发红包</div>
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="absolute right-4">
            <EllipsisGlyph />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        <div className="flex items-center justify-between rounded-[10px] bg-white px-4 py-[13px] dark:bg-[#1A1A1A]">
          <span className="text-[16px]">金额</span>
          <span className="flex items-center gap-1 text-[15px]">
            <span className="text-black/50 dark:text-white/50">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder="0.00"
              aria-label="红包金额"
              data-testid="wx-rp-amount-input"
              className="w-[96px] bg-transparent text-right text-[15px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
            />
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-white px-4 py-[14px] dark:bg-[#1A1A1A]">
          <input
            value={blessing}
            onChange={(e) => setBlessing(e.target.value.slice(0, 25))}
            placeholder="恭喜发财，大吉大利"
            data-testid="wx-rp-blessing"
            className="h-8 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
          />
          <button type="button" aria-label="表情" onClick={() => onToast('表情暂未开放')} className="shrink-0 active:opacity-60">
            <Smile className="h-[22px] w-[22px] text-black/35 dark:text-white/35" strokeWidth={1.7} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onToast('红包封面暂未开放')}
          className="mt-3 flex w-full items-center justify-between rounded-[10px] bg-white px-4 py-[18px] active:bg-black/[0.03] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
        >
          <span className="text-[16px]">红包封面</span>
          <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
        </button>
        {/* 支付方式 */}
        <div className="mt-3 overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-rp-method"
            onClick={() => setMethodOpen(true)}
            className="flex w-full items-center px-4 py-[14px] text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
          >
            <span className="flex-1 text-[16px]">支付方式</span>
            <span className="mr-1 max-w-[58%] truncate text-[14px] text-black/45 dark:text-white/45">{wxMethodLabel(methodId)}</span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        <div className="mt-10 text-center">
          <p className="font-semibold" data-testid="wx-rp-big">
            <span className="text-[28px]">¥</span>
            <span className="ml-2 text-[48px] leading-none">{val || '0.00'}</span>
          </p>
          <button
            type="button"
            data-testid="wx-rp-send"
            onClick={submit}
            className={`mt-8 h-[46px] w-[230px] rounded-[8px] text-[17px] font-medium text-white active:brightness-95 ${
              ok ? 'bg-[#F04A3A]' : 'bg-[#F04A3A]/45'
            }`}
          >
            塞钱进红包
          </button>
        </div>
      </div>
      {methodOpen ? (
        <WxPayMethodSheet
          cards={cards}
          familyIn={familyIn}
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

/** 转账页：转账给 xx + 金额输入卡 + 转账说明 + 支付方式行 + 底部「转账」发送按钮（无数字键盘）。
 *  单聊/群聊共用（群聊传入被选中的群成员） */
export function TransferCompose({
  peer,
  onBack,
  onSubmit,
  onToast,
}: {
  peer: ContactRecord;
  onBack: () => void;
  onSubmit: (amount: number, note: string, methodId: string) => void;
  onToast: (m: string) => void;
}) {
  const [val, setVal] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const cards = loadCards();
  const familyIn = resetFamilyCardsInMonth(); // 审计 #6：进入发送页先做跨月惰性重置，支付方式行「本月可用」即本月真实额度
  const num = parseFloat(val || '0');
  const ok = num >= 0.01;
  const submit = () => {
    if (!ok) {
      onToast('请输入转账金额');
      return;
    }
    if (!wxCanPay(methodId, num)) {
      if (methodId === 'balance') onToast('零钱不足，请先充值');
      else if (methodId.startsWith('fcin-')) onToast('亲属卡本月额度不足');
      else onToast('卡内余额不足，请更换支付方式');
      return;
    }
    onSubmit(num, note.trim(), methodId);
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-tr-compose">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-tr-compose-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
        <div className="flex items-center gap-3 px-1">
          <div className="min-w-0 flex-1">
            <p className="text-[21px] font-semibold" data-testid="wx-tr-peer-name">
              转账给 {peer.name}
            </p>
            <p className="mt-1 truncate text-[14px] text-black/40 dark:text-white/40">微信号：{peer.wechatId || '未设置'}</p>
          </div>
          <WxAvatar src={peer.avatar} alt={peer.name} size={54} />
        </div>
        <div className="mt-5 rounded-[14px] bg-white px-5 pb-5 pt-5 dark:bg-[#1A1A1A]">
          <p className="text-[15px] text-black/70 dark:text-white/70">转账金额</p>
          <div className="mt-3 flex items-center gap-2 border-b border-black/[0.06] pb-4 dark:border-white/[0.08]" data-testid="wx-tr-amount-big">
            <span className="text-[30px] font-semibold leading-none">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder="0.00"
              aria-label="转账金额"
              data-testid="wx-tr-amount-input"
              className="min-w-0 flex-1 bg-transparent text-[38px] font-semibold leading-none outline-none placeholder:text-black/20 dark:placeholder:text-white/20"
            />
          </div>
          <div className="mt-4">
            {noteOpen ? (
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 10))}
                placeholder="转账说明（10 字以内）"
                data-testid="wx-tr-note"
                className="w-full bg-transparent text-[15px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
              />
            ) : (
              <button type="button" data-testid="wx-tr-note-add" onClick={() => setNoteOpen(true)} className="text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
                添加转账说明
              </button>
            )}
          </div>
        </div>
        {/* 支付方式 */}
        <div className="mt-3 overflow-hidden rounded-[14px] bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-tr-method"
            onClick={() => setMethodOpen(true)}
            className="flex w-full items-center px-4 py-[14px] text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
          >
            <span className="flex-1 text-[16px]">支付方式</span>
            <span className="mr-1 max-w-[58%] truncate text-[14px] text-black/45 dark:text-white/45">{wxMethodLabel(methodId)}</span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          data-testid="wx-tr-send"
          onClick={submit}
          disabled={!ok}
          className={`mx-auto mt-9 block h-[46px] w-[230px] rounded-[8px] text-[17px] font-medium text-white ${
            ok ? 'bg-[#07C160] active:brightness-95' : 'bg-[#07C160]/45'
          }`}
        >
          转账
        </button>
        <p className="pb-6 pt-4 text-center text-[12px] text-black/35 dark:text-white/35">请确认好收款人，谨防电信诈骗</p>
      </div>
      {methodOpen ? (
        <WxPayMethodSheet
          cards={cards}
          familyIn={familyIn}
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

/** 红包聊天卡片（红橙渐变，底部「红包」条；与转账卡同宽 206px；未领取点击弹「開」，已领取进详情）。
 *  单聊/群聊共用同一套卡片组件（群聊传入群红包的祝福语/进度文案） */
export function RpBubble({ blessing, sub, settled, fromMe, onClick }: { blessing: string; sub: string; settled: boolean; fromMe?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="wx-rp-bubble"
      onClick={onClick}
      className="chat-card chat-card-rp relative block w-[206px] text-left shadow-sm transition-all duration-300 active:brightness-95"
      style={{
        // 领取/退还/拒收后卡片颜色变灰（对照真实微信：已领取的红包封面褪色）
        filter: settled ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`红包 ${blessing}（${sub}）`}
    >
      {/* 小尾巴：菱形凸出卡外（不被裁剪，与转账卡同款双层结构），尖角处带一点圆弧，颜色取卡身右上同段渐变 */}
      <span
        aria-hidden="true"
        className={`chat-card-tail absolute top-[11px] h-[13px] w-[13px] rotate-45 bg-[#EC5A42] ${fromMe === false ? '-left-[3px]' : '-right-[3px]'}`}
        style={{ borderRadius: fromMe === false ? '2px 2px 2px 3px' : '2px 3px 2px 2px' }}
      />
      {/* 卡身：圆角 + overflow-hidden 只裁内容层（渐变/高光/底部标签），不再裁掉尾巴 */}
      <span className="chat-card-body relative block overflow-hidden rounded-[4px]" style={{ background: 'linear-gradient(135deg, #F2694C, #E94E38)' }}>
        <span aria-hidden="true" className="pointer-events-none absolute -right-6 -top-10 h-24 w-24 rounded-full bg-white/10" />
        <span className="relative flex items-center gap-2.5 px-3 pb-2.5 pt-3">
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border-2 border-white/90 bg-white/15" aria-hidden="true">
            <span className="text-[20px] font-semibold leading-none text-white">¥</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] leading-snug text-white">{blessing}</span>
            <span className="mt-0.5 block text-[11px] text-white/85">{sub}</span>
          </span>
        </span>
        {/* 「红包」标签：背景与卡身同色（去掉黑蒙层，仅保留文字，与转账卡同轮处理） */}
        <span className="chat-card-label relative block px-3 py-[5px] text-[12px] text-white/90">红包</span>
      </span>
    </button>
  );
}

/** 转账聊天卡片（橙色渐变 + 白描边圆⇆/对勾/退还↩ + 金额 + 状态文案 + 左下「转账」+ 朝向角标；紧凑尺寸；自己也作为「已收款/已退还」接收凭据卡复用）。
 *  状态文案按角色与收款状态区分：接收完成后才显示「已转入零钱」，之前是「待对方收款」；
 *  待收款中：有转账留言时状态行优先显示留言（没写留言才显示状态文案）；
 *  终态（已收款/已退还/已拒收）：不再显示留言，改回显示原状态文案（用户需求：退还接收以后不要显示留言）；
 *  收款/退还/拒收后卡片颜色变灰（对照真实微信：终态卡褪色），退还卡圆图标换成↩。
 *  单聊/群聊共用同一套卡片组件（群聊传入群转账的状态文案）
 *  第 22 轮（用户反馈）：①**小尾巴真正露出来**——旧版尾巴画在 overflow-hidden 容器内被整片裁掉，
 *  现改为「外层无裁剪 + 内层内容圆角裁剪」双层结构，菱形尾巴凸出卡外（真机同款）；
 *  ②尾巴尖尖**不要那么尖**——尖角那颗圆角 3px（rotate(45deg) 后 TR=右侧尖 / BL=左侧尖）；
 *  ③底部「转账」标签背景改**与卡身同色**（去掉黑色蒙层） */
export function TrBubble({ amount, status, received, refunded, fromMe, note, settled, onClick }: { amount: number; status: string; received: boolean; refunded: boolean; fromMe: boolean; note?: string; settled?: boolean; onClick: () => void }) {
  // 终态（已收款/已退还/已拒收）→ 显示原状态文案；待收款中 → 有留言显示留言、没写留言显示状态文案
  const line = !settled && note && note.trim() ? note : status;
  return (
    <button
      type="button"
      data-testid="wx-tr-bubble"
      onClick={onClick}
      className="chat-card chat-card-tr relative block w-[206px] text-left shadow-sm transition-all duration-300 active:brightness-95"
      style={{
        // 收款/退还/拒收后卡片颜色变灰（对照真实微信：已收款与已退还的转账卡都褪色）
        filter: received || refunded ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`转账 ¥${fmtMoney(amount)}${received ? '（已收款）' : refunded ? '（已退还）' : ''}`}
    >
      {/* 小尾巴：菱形凸出卡外（不被裁剪），尖角处带一点点圆弧（3px），颜色取卡身右上同段渐变 */}
      <span
        aria-hidden="true"
        className={`chat-card-tail absolute top-[11px] h-[13px] w-[13px] rotate-45 bg-[#F2A233] ${fromMe ? '-right-[3px]' : '-left-[3px]'}`}
        style={{ borderRadius: fromMe ? '2px 3px 2px 2px' : '2px 2px 2px 3px' }}
      />
      {/* 卡身：圆角 + overflow-hidden 只裁内容层（渐变/高光/底部标签），不再裁掉尾巴 */}
      <span className="chat-card-body relative block overflow-hidden rounded-[4px]" style={{ background: 'linear-gradient(135deg, #F6AC3D, #EF9A2E)' }}>
        <span className="relative flex items-center gap-2.5 px-3 pb-2.5 pt-3">
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border-2 border-white/90" aria-hidden="true">
            {refunded ? <Undo2 className="h-5 w-5 text-white" strokeWidth={2.2} /> : received ? <Check className="h-5 w-5 text-white" strokeWidth={2.4} /> : <ArrowLeftRight className="h-5 w-5 text-white" strokeWidth={2} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold leading-tight text-white">¥{fmtMoney(amount)}</span>
            <span className="mt-0.5 block truncate text-[13px] text-white/95" data-testid="wx-tr-bubble-status">
              {line}
            </span>
          </span>
        </span>
        {/* 「转账」标签：背景与卡身同色（第 22 轮去掉黑蒙层，仅保留文字） */}
        <span className="chat-card-label relative block px-3 py-[4px] text-[12px] text-white/90">转账</span>
      </span>
    </button>
  );
}

/**
 * 群聊邀请卡片（AI 主动建群/拉人时发出；对照真微信「邀请你加入群聊」卡片）：
 * pending = 副文案 + 接受/拒绝按钮（点「接受邀请」才进群）；accepted/rejected = 状态行（卡片本体不可点，不进群）。
 */
export function WxGroupCardBubble({
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
      data-testid="wx-group-card"
      className={`w-[248px] select-none overflow-hidden rounded-[8px] bg-white shadow-sm dark:bg-[#1E1E1E] ${rejected ? 'opacity-60' : ''}`}
    >
      {/* 卡片本体不可点击进群（需求：点卡片不进群，点「接受邀请」才算进群）；进群入口只有接受按钮 */}
      <div className="flex w-full items-center gap-2.5 px-3 pb-2.5 pt-3 text-left">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[6px] bg-[#07C160]/10 dark:bg-[#07C160]/15"
        >
          <Users className="h-5 w-5 text-[#07C160]" strokeWidth={1.8} />
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
            data-testid="wx-group-card-reject"
            onClick={onReject}
            className="flex-1 py-2 text-[13.5px] text-black/55 active:bg-black/[0.04] dark:text-white/55 dark:active:bg-white/[0.06]"
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid="wx-group-card-accept"
            onClick={onAccept}
            className="flex-1 border-l border-black/[0.06] py-2 text-[13.5px] font-medium text-[#07C160] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
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

/** 聊天系统通知行（截图参考：居中小图标 + 灰字 + 金色尾词，如「xx领取了你的红包」；单聊/群聊共用）。
 *  第七轮反馈新增 gift 图标（蓝金礼物盒）：「XX收下了你的礼物 / 你收下了XX送的礼物」 */
export function WxNoticeRow({ icon, pre, accent }: { icon: 'rp' | 'tr' | 'fam' | 'gift'; pre: string; accent: string }) {
  return (
    <div className="flex justify-center py-1.5" data-testid="wx-notice-row">
      <span className="flex max-w-[86%] items-center gap-1.5 text-[13px] text-black/45 dark:text-white/45">
        {icon === 'rp' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(180deg, #F2694C, #E94E38)' }}
          >
            <span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-[#F9DCA8]" />
          </span>
        ) : icon === 'tr' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #F6AC3D, #EF9A2E)' }}
          >
            <ArrowLeftRight className="h-[10px] w-[10px] text-white" strokeWidth={2.6} />
          </span>
        ) : icon === 'gift' ? (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #4467B4, #2C4E92)' }}
          >
            <Gift className="h-[10px] w-[10px] text-[#F2D9A6]" strokeWidth={2.4} />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px]"
            style={{ background: 'linear-gradient(135deg, #FDF3CE, #FAE7A8)' }}
          >
            <Heart className="h-[10px] w-[10px] text-[#E0A94C]" strokeWidth={2.4} />
          </span>
        )}
        <span className="truncate">{pre}</span>
        <span className="shrink-0 text-[#D8A244]">{accent}</span>
      </span>
    </div>
  );
}

/**
 * 开红包弹窗（对照真实微信：半透明黑底遮罩透出聊天，居中一张圆角红包封面卡，
 * 金色描边 + 头像/「XX的红包」/祝福语 + 底部亮红大弧上金色呼吸光晕「開」钮，卡片下方金色 X 关闭）；
 * 单聊/群聊共用（群聊里成员发的红包同样先开箱）
 */
export function RpOpenLayer({
  senderName,
  senderAvatar,
  blessing,
  onOpen,
  onClose,
  onRefund,
}: {
  senderName: string;
  senderAvatar: string | null;
  blessing: string;
  onOpen: () => void;
  onClose: () => void;
  /** 退还该红包（仅对方发来的未领取红包传入） */
  onRefund?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/70 px-7 pb-12" role="dialog" aria-label="打开红包" data-testid="wx-rp-open">
      <style>{
        '@keyframes wxrp-in{from{transform:scale(.86);opacity:0}to{transform:scale(1);opacity:1}}' +
        '@keyframes wxrp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}' +
        '@keyframes wxrp-glow{0%,100%{box-shadow:0 12px 30px rgba(0,0,0,.25),0 0 0 0 rgba(249,208,120,.5)}70%{box-shadow:0 12px 30px rgba(0,0,0,.25),0 0 0 18px rgba(249,208,120,0)}}'
      }</style>
      <div className="relative w-full max-w-[330px]" style={{ animation: 'wxrp-in 0.26s ease-out' }}>
        {/* 红包封面卡 */}
        <div
          className="relative h-[420px] overflow-hidden rounded-[20px] shadow-[0_24px_60px_rgba(0,0,0,0.4)]"
          style={{ background: 'linear-gradient(170deg, #F8755C 0%, #EF5340 55%, #E84434 100%)' }}
        >
          {/* 封面装饰：卡内光斑 + 浮动金点 + 卡顶金色饰线（红包封面专属设计元素，非毛玻璃氛围层，Task 38 误删后还原） */}
          <span aria-hidden="true" className="pointer-events-none absolute -left-14 -top-16 h-44 w-44 rounded-full bg-white/[0.07]" />
          <span aria-hidden="true" className="pointer-events-none absolute -right-16 top-1/3 h-52 w-52 rounded-full bg-white/[0.05]" />
          {[
            { left: '16%', top: '20%', s: 6, d: '0s' },
            { left: '80%', top: '28%', s: 5, d: '.6s' },
            { left: '22%', top: '58%', s: 5, d: '1.1s' },
            { left: '78%', top: '62%', s: 6, d: '.3s' },
          ].map((p, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full bg-[#F9D08A]/70"
              style={{ left: p.left, top: p.top, width: p.s, height: p.s, animation: `wxrp-float 3.2s ease-in-out ${p.d} infinite` }}
            />
          ))}
          <span aria-hidden="true" className="absolute inset-x-9 top-0 h-[3px] rounded-b bg-gradient-to-r from-transparent via-[#F0C87E]/75 to-transparent" />

          <div className="relative flex h-full flex-col items-center">
            <div className="h-[21%] shrink-0" aria-hidden="true" />
            <span className="rounded-full border-2 border-[#F0C87E]/85 p-[3px] shadow-[0_4px_14px_rgba(0,0,0,0.18)]">
              <WxAvatar src={senderAvatar} alt={senderName} size={46} />
            </span>
            <p className="mt-3.5 text-[18px] font-medium tracking-wide text-[#F9DCA8]" data-testid="wx-rp-open-sender">
              {senderName}的红包
            </p>
            <p className="mt-7 max-w-[86%] text-center text-[24px] font-medium leading-relaxed text-[#FFF3D6] [text-shadow:0_2px_4px_rgba(170,30,25,0.3)]" data-testid="wx-rp-open-blessing">
              {blessing}
            </p>
            <div className="flex-1" aria-hidden="true" />
            {/* 底部亮红大弧 + 開 */}
            <div className="relative h-[150px] w-full shrink-0">
              <span className="absolute left-1/2 top-[46px] h-[240px] w-[480px] -translate-x-1/2 rounded-[50%]" style={{ backgroundColor: '#FF7A5F' }} aria-hidden="true" />
              <button
                type="button"
                data-testid="wx-rp-open-btn"
                onClick={onOpen}
                className="absolute left-1/2 top-[22px] grid h-[92px] w-[92px] -translate-x-1/2 place-items-center rounded-full text-[40px] font-semibold text-[#A8671F] transition-transform active:scale-95"
                style={{
                  fontFamily: 'Georgia, serif',
                  background: 'linear-gradient(180deg, #FCEBC0 0%, #F3CB72 55%, #E0A94C 100%)',
                  animation: 'wxrp-glow 1.9s ease-out infinite',
                }}
                aria-label="开红包"
              >
                <span aria-hidden="true" className="pointer-events-none absolute inset-[5px] rounded-full border-[1.5px] border-[#C08A3A]/60" />
                開
              </button>
            </div>
          </div>
        </div>

        {/* 卡片下方：退还 + 金色 X 关闭（退还可把对方发的红包原路退回） */}
        <div className="absolute -bottom-[68px] left-1/2 flex -translate-x-1/2 items-center gap-5">
          {onRefund ? (
            <button
              type="button"
              data-testid="wx-rp-refund"
              onClick={onRefund}
              className="flex h-[50px] items-center rounded-full border-2 border-[#EFC266]/90 bg-black/25 px-6 text-[16px] font-medium text-[#EFC266] active:opacity-70"
            >
              退还
            </button>
          ) : null}
          <button
            type="button"
            aria-label="关闭"
            data-testid="wx-rp-open-close"
            onClick={onClose}
            className="flex h-[50px] w-[50px] items-center justify-center rounded-full border-2 border-[#EFC266]/90 text-[#EFC266] active:opacity-70"
          >
            <X className="h-6 w-6" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 红包详情页（红色弧形头 + 头像/名字 + 祝福语 + 金色金额 + 领取详情[谁领取的] + 回复表情） */
export function RpDetailPage({
  senderName,
  senderAvatar,
  blessing,
  amount,
  opened,
  statusLabel,
  claimerName,
  claimerAvatar,
  claimedAt,
  onBack,
  onToast,
}: {
  senderName: string;
  senderAvatar: string | null;
  blessing: string;
  amount: number;
  opened: boolean;
  /** 退还/拒收状态文案（未终态时不传） */
  statusLabel?: string;
  claimerName: string;
  claimerAvatar: string | null;
  claimedAt?: number;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-rp-detail">
      <div className="relative shrink-0 bg-[#F25844] pt-[54px]">
        <div className="relative flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-rp-detail-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7 text-[#F6CE93]" strokeWidth={2.2} />
          </button>
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto px-2 active:opacity-60">
            <EllipsisGlyph />
          </button>
        </div>
        {/* 弧形底（金色描边） */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-full h-[30px] w-[140%] -translate-x-1/2 rounded-[50%] bg-white dark:bg-[#111111]"
          style={{ boxShadow: '0 -3px 0 #E9C880' }}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-[8vh]">
        <div className="flex items-center gap-2.5">
          <WxAvatar src={senderAvatar} alt={senderName} size={36} />
          <span className="text-[20px] font-medium" data-testid="wx-rp-detail-title">
            {senderName}的红包
          </span>
        </div>
        <p className="mt-2.5 text-[15px] text-black/40 dark:text-white/40">{blessing}</p>
        {statusLabel ? (
          <p className="mt-2 text-[13px] text-[#D8A244]" data-testid="wx-rp-detail-status">{statusLabel}</p>
        ) : null}
        <p className="mt-8 font-semibold text-[#D8A244]" data-testid="wx-rp-detail-amount">
          <span className="text-[46px] leading-none">{fmtMoney(amount)}</span>
          <span className="ml-1.5 text-[20px]">元</span>
        </p>

        {/* 领取详情（谁领取的） */}
        <div className="mt-9 w-[87%] max-w-[350px]" data-testid="wx-rp-claim">
          <p className="text-[12px] text-black/35 dark:text-white/35" data-testid="wx-rp-claim-caption">
            1个红包共{fmtMoney(amount)}元，已领取{opened ? 1 : 0}/1
          </p>
          {opened ? (
            <div className="mt-1.5 flex items-center gap-3 border-t border-black/[0.06] py-3.5 dark:border-white/[0.08]">
              <WxAvatar src={claimerAvatar} alt={claimerName} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]" data-testid="wx-rp-claim-name">
                  {claimerName}
                </span>
                <span className="mt-0.5 block text-[11px] text-black/35 dark:text-white/35" data-testid="wx-rp-claim-time">
                  {fmtFullTime(claimedAt ?? Date.now())}
                </span>
              </span>
              <span className="shrink-0 text-[15px] font-medium text-[#D8A244]" data-testid="wx-rp-claim-amount">
                ¥{fmtMoney(amount)}
              </span>
            </div>
          ) : (
            <p className="mt-7 text-center text-[13px] text-black/30 dark:text-white/30">等待领取…</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => onToast('表情暂未开放')}
          className="mt-11 flex items-center gap-2 rounded-[10px] bg-black/[0.04] px-7 py-3.5 text-[16px] text-black/50 active:bg-black/[0.08] dark:bg-white/[0.08] dark:text-white/50"
        >
          <Smile className="h-5 w-5" strokeWidth={1.8} />
          回复表情到聊天
        </button>
      </div>
    </div>
  );
}

/** 收款页（点对方发来的未收款转账进入，对照截图：蓝圈时钟 + 待你收款 + 金额 + 转账时间 + 绿色收款按钮 + 退还提示） */
export function WxTrReceivePage({
  peerName,
  amount,
  note,
  payTime,
  onBack,
  onAccept,
  onRefund,
}: {
  peerName: string;
  amount: number;
  note: string;
  payTime: number;
  onBack: () => void;
  onAccept: () => void;
  onRefund: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-tr-receive">
      <div className="shrink-0 bg-white pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-tr-receive-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8">
        <div className="mt-[9vh] flex flex-col items-center">
          <Clock className="h-[74px] w-[74px] text-[#4D9CF8]" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-7 text-[19px]" data-testid="wx-tr-receive-status">
            {peerName}向你转账，待你收款
          </p>
          <p className="mt-4 font-semibold" data-testid="wx-tr-receive-amount">
            <span className="text-[30px]">¥ </span>
            <span className="text-[46px] leading-none">{fmtMoney(amount)}</span>
          </p>
        </div>
        <div className="mt-14 w-full border-t border-black/[0.06] pt-5 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
            <span className="shrink-0 text-black/45 dark:text-white/45">转账时间</span>
            <span className="text-right">{fmtFullTime(payTime)}</span>
          </div>
          {note ? (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">转账说明</span>
              <span className="min-w-0 truncate text-right">{note}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 px-14 pb-9">
        <button
          type="button"
          data-testid="wx-tr-receive-accept"
          onClick={onAccept}
          className="mx-auto block h-12 w-full rounded-[10px] text-[17px] font-medium text-white active:brightness-95"
          style={{ backgroundColor: '#07C160' }}
        >
          收款
        </button>
        <p className="mt-4 text-center text-[13.5px] text-black/45 dark:text-white/45">
          1天内未确认，将退还给对方。{' '}
          <button type="button" onClick={onRefund} className="text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]" data-testid="wx-tr-receive-refund">
            退还
          </button>
        </p>
      </div>
    </div>
  );
}

/** 转账详情页（截图⑥：绿勾大圆 + 已收款 + 金额 + 转账/收款时间 + 账单详情）。
 *  退还态（截图⑦）：黄圈↩ + 「你已退还/对方已退还」+ 金额 + 转账时间/退款时间 */
export function TrDetailPage({
  peerName,
  amount,
  note,
  payTime,
  received,
  receivedAt,
  receiverIsMe,
  returned,
  refundedBy,
  refundedAt,
  originTime,
  onBack,
  onToast,
}: {
  peerName: string;
  amount: number;
  note: string;
  payTime: number;
  received: boolean;
  receivedAt?: number;
  /** 收款人是否为「我」（原卡按消息角色判断 + 凭据卡按 receiptOf 判断）：文案区分「你已收款 / XX已收款」 */
  receiverIsMe: boolean;
  /** 退还终态（status==='returned' 时 true）：整页切换为退还详情 */
  returned?: boolean;
  /** 退还人（'me'=我退的→「你已退还」；'peer'=对方退的→「对方已退还」） */
  refundedBy?: 'me' | 'peer';
  /** 退款时间（详情页「退款时间」行） */
  refundedAt?: number;
  /** 原转账时间（退还凭据卡专用；缺省回退 payTime） */
  originTime?: number;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  const isReturned = returned === true;
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-tr-detail">
      <div className="shrink-0 bg-white pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-tr-detail-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto px-2 active:opacity-60">
            <EllipsisGlyph />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 pt-[9vh]">
        <span
          className={`flex h-[74px] w-[74px] items-center justify-center rounded-full ${isReturned ? 'bg-[#F6AC3D]' : received ? 'bg-[#07C160]' : 'bg-[#F6AC3D]'}`}
          aria-hidden="true"
        >
          {isReturned ? <Undo2 className="h-11 w-11 text-white" strokeWidth={2.6} /> : <Check className="h-11 w-11 text-white" strokeWidth={3} />}
        </span>
        <p className="mt-7 text-[19px]" data-testid="wx-tr-status">
          {isReturned
            ? refundedBy === 'peer'
              ? '对方已退还'
              : '你已退还'
            : received
              ? receiverIsMe
                ? '你已收款，资金已存入零钱'
                : `${peerName}已收款`
              : '对方确认后到账'}
        </p>
        <p className="mt-4 font-semibold" data-testid="wx-tr-detail-amount">
          <span className="text-[30px]">¥ </span>
          <span className="text-[46px] leading-none">{fmtMoney(amount)}</span>
        </p>
        <div className="mt-14 w-full border-t border-black/[0.06] pt-5 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
            <span className="shrink-0 text-black/45 dark:text-white/45">转账时间</span>
            <span className="text-right">{fmtFullTime(isReturned ? (originTime ?? payTime) : payTime)}</span>
          </div>
          {isReturned && typeof refundedAt === 'number' && (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">退款时间</span>
              <span className="text-right" data-testid="wx-tr-refund-time">
                {fmtFullTime(refundedAt)}
              </span>
            </div>
          )}
          {!isReturned && received && typeof receivedAt === 'number' && (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">收款时间</span>
              <span className="text-right" data-testid="wx-tr-received-time">
                {fmtFullTime(receivedAt)}
              </span>
            </div>
          )}
          {note && (
            <div className="flex items-center justify-between gap-3 py-1.5 text-[15px]">
              <span className="shrink-0 text-black/45 dark:text-white/45">转账说明</span>
              <span className="min-w-0 truncate text-right">{note}</span>
            </div>
          )}
        </div>
      </div>
      <button type="button" onClick={() => onToast('账单详情暂未开放')} className="shrink-0 pb-10 pt-4 text-center text-[15px] text-[#576B95] active:opacity-60 dark:text-[#8FA5C9]">
        账单详情
      </button>
    </div>
  );
}

/** 申请解除拉黑卡片（40-a 双向：from='char' 角色发起（用户点同意/拒绝）；from='user' 用户发起（角色 AI 决策，仅展示状态）；iOS 黑白灰风） */
export function WxBlockReqCard({
  name,
  avatar,
  reason,
  status,
  from = 'char',
  onAccept,
  onReject,
}: {
  name: string;
  avatar: string | null;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
  from?: 'char' | 'user';
  onAccept: () => void;
  onReject: () => void;
}) {
  const mine = from === 'user';
  return (
    <div
      data-testid={mine ? 'wx-blockreq-card-mine' : 'wx-blockreq-card'}
      className="w-fit max-w-[calc(100%-40px)] rounded-[5px] bg-white px-3 py-2.5 shadow-sm dark:bg-[#1E1E1E]"
      aria-label={`${name}申请解除拉黑`}
    >
      <div className="flex items-center gap-2">
        <WxAvatar src={avatar} alt={name} size={34} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium leading-tight text-black dark:text-white">{name}</p>
          <p className="mt-0.5 text-[12px] leading-tight text-black/45 dark:text-white/45">申请解除拉黑</p>
        </div>
      </div>
      {reason && (
        <p className="mt-2 rounded-[4px] bg-black/[0.04] px-2 py-1.5 text-[13px] leading-[1.5] text-black/70 dark:bg-white/[0.08] dark:text-white/70">「{reason}」</p>
      )}
      {mine ? (
        /* 40-a：用户发起的申请——决策方是角色（AI 标记），这里只展示状态 */
        <p className="mt-2 text-[12px] text-black/35 dark:text-white/35">
          {status === 'pending' ? '等待对方处理' : status === 'accepted' ? '对方已同意，拉黑已解除' : '对方已拒绝'}
        </p>
      ) : status === 'pending' ? (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            data-testid="wx-blockreq-reject"
            aria-label={`拒绝${name}的解除拉黑申请`}
            onClick={onReject}
            className="h-8 flex-1 rounded-[4px] bg-black/[0.05] text-[13px] text-black/70 transition active:opacity-70 dark:bg-white/10 dark:text-white/70"
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid="wx-blockreq-accept"
            aria-label={`同意${name}的解除拉黑申请`}
            onClick={onAccept}
            className="h-8 flex-1 rounded-[4px] bg-[#07C160] text-[13px] font-medium text-white transition active:opacity-80"
          >
            同意
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-black/35 dark:text-white/35">{status === 'accepted' ? '已同意，拉黑已解除' : '已拒绝'}</p>
      )}
    </div>
  );
}
