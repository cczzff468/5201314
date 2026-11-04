'use client';

/**
 * 恋爱协议卡片气泡（第十二轮）——微信/QQ 聊天共用。
 *
 * 第二十七轮：邀请卡片和淘宝/美团代付卡片样式一模一样（只换内容）——
 * 结构对齐 TbPayBubble/MtPayBubble：白卡 p-2.5 rounded-[14px] + 指向头像侧的小箭头
 * + 头部（logo 22px + 情侣空间 + ShieldCheck 真爱保障）+ 主标题 + 内容面板 + 胶囊按钮。
 *
 * 第三十轮（用户参考图，只改内容）：主标题改为「我写的恋爱协议，等你来签名」；
 * 内容面板由「粉横幅+白面板」改为参考图里的**协议书正文**：居中协议名 + 分隔线 +
 * 前言段落 + 虚线 + 编号条款列表（最多展示 5 条，多出折叠提示）+ 签署按钮；
 * 已签署态右上角盖「已生效」红章；婉拒态整体褪灰（同代付完成卡语义）。
 * 卡片外壳/头部/按钮样式保持家族不变。
 *
 * 第三十一轮（用户反馈）：①整体上下变小（内边距/间距/字号/按钮全压缩一档）；
 * ②内容面板删除黑色描边（ring-black）与米黄底，回归参考图的纯白纸面；
 * ③排版再美化：协议名两侧加短渐变线装饰、分隔线改渐变淡出、条款编号改粉色、
 * 前言与条款行距收紧，整体像一张更精致的小协议书。
 *
 * 点击卡片本体 → 记 pending + 切进情侣空间 App（PactPage 消费后跳对应界面）。
 */

import type { CouplePactCardData } from '@/lib/ios/couple-pact-share';
import { navToPact } from '@/lib/ios/couple-pact-share';
import { kvGet } from '@/lib/ios/idb-kv';
import { useUI } from '@/lib/ios/store';
import { PenLine, ShieldCheck } from 'lucide-react';

export interface CouplePactBubbleProps {
  data: CouplePactCardData;
  /** 消息是否我发的（msg.role === 'me'） */
  mine: boolean;
  testidPrefix?: string; // 'wx' | 'qq'（E2E 用）
}

/** 协议书正文最多展示的条款数（参考图为 5 条；多出的折叠成提示行） */
const MAX_CLAUSES = 5;

export default function CouplePactBubble({ data, mine, testidPrefix = 'wx' }: CouplePactBubbleProps) {
  // 第十七轮·动态状态（自愈）：情侣空间里已有同题的「已签署」存档 → 卡片一律按已签署显示，
  // 修复「签完后卡片还显示去签署/点进去还是未签署」——卡片状态永远跟随情侣空间的存档真相
  const live = (() => {
    try {
      const snap = kvGet<{ pacts?: { id?: string; title?: string; status?: string }[] }>('couple-space:state');
      const pacts = Array.isArray(snap?.pacts) ? snap!.pacts! : [];
      if (data.pactId && data.pactId !== 'ai') {
        const byId = pacts.find((p) => p && p.id === data.pactId);
        if (byId) return { signed: byId.status === 'signed', pactId: byId.id };
      }
      const byTitle = pacts.find((p) => p && p.status === 'signed' && p.title === data.title);
      if (byTitle) return { signed: true, pactId: byTitle.id };
    } catch {
      /* 读不到就按卡片自身状态 */
    }
    return { signed: data.status === 'signed', pactId: data.pactId && data.pactId !== 'ai' ? data.pactId : undefined };
  })();
  const declined = data.status === 'declined' && !live.signed;
  const declinedByMe = declined && data.declinedBy === 'me';
  const signed = live.signed;
  const canSign = data.from === 'ta' && data.status === 'pending' && !signed && !declined;

  /** 点击卡片 → 进情侣空间（携带卡片正文/TA 是否已先签名/是否已签署/卡片消息定位，任何状态都直达对应签署/回看界面） */
  const openPact = () => {
    const ui = useUI.getState();
    if (ui.locked) return;
    navToPact({
      pactId: live.pactId,
      from: data.from,
      title: data.title,
      preamble: data.preamble,
      clauses: data.clauses,
      taSigned: data.taSigned,
      signed,
      msgId: data.msgId,
      channel: data.app,
      contactId: data.contactId,
    });
    if (ui.activeApp && ui.activeApp !== 'couple') ui.switchToApp('couple');
    else if (!ui.activeApp && ui.phase === 'closed') ui.openApp('couple');
  };

  // 主标题（第三十轮参考图口径：我写的恋爱协议，等你来签名；TA 发来的标注写协议的人）
  const title = signed
    ? '我们的恋爱协议生效啦~'
    : declined
      ? declinedByMe
        ? '这份恋爱协议你婉拒啦~'
        : `${data.fromName}婉拒了这份恋爱协议~`
      : data.from === 'ta'
        ? `${data.fromName}写的恋爱协议，等你来签名`
        : '我写的恋爱协议，等你来签名';

  const clauses = (data.clauses ?? []).filter((c) => typeof c === 'string' && c.trim());
  const shown = clauses.slice(0, MAX_CLAUSES);
  const extra = clauses.length - shown.length;

  return (
    <div
      data-testid={`${testidPrefix}-pact-card`}
      onClick={(e) => {
        e.stopPropagation();
        openPact();
      }}
      className="relative block w-[252px] cursor-pointer select-none rounded-[14px] bg-white p-2 text-left shadow-[0_4px_14px_rgba(0,0,0,0.08)] transition-all duration-300 active:brightness-95 dark:bg-zinc-800/95"
      style={{ filter: declined ? 'grayscale(0.72) brightness(0.98)' : undefined }}
      role="button"
      aria-label={`恋爱协议邀请卡（${signed ? '已签署生效' : declined ? '已婉拒' : '待签署'}）`}
    >
      {/* 箭头指向头像侧：我发出（右）/ TA 发来（左），与代付卡一致 */}
      <span aria-hidden="true" className={`absolute top-[13px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white dark:bg-zinc-800/95 ${mine ? '-right-[4px]' : '-left-[4px]'}`} />

      {/* 头部：情侣空间 logo + 真爱保障（外壳保持与代付卡家族一致） */}
      <span className="relative flex items-center gap-1.5">
        <img src="/icons/couple.png" alt="" aria-hidden="true" className="h-[20px] w-[20px] rounded-full object-cover" draggable={false} />
        <span className="text-[12.5px] font-semibold text-black/85 dark:text-zinc-200">情侣空间</span>
        <span className="ml-auto flex items-center gap-[3px] text-[10.5px] font-medium text-[#f2536a]">
          <ShieldCheck className="h-[12px] w-[12px]" strokeWidth={2.2} />
          真爱保障
        </span>
      </span>

      {/* 主标题（参考图：大字粗体） */}
      <span className="relative mt-1 block text-[14px] font-bold leading-snug text-black/90 dark:text-zinc-100">{title}</span>

      {/* 协议书正文（第三十一轮：纯白纸面无描边，居中标题 + 装饰线 + 前言 + 编号条款） */}
      <span className="relative mt-1.5 block overflow-hidden rounded-[10px] bg-[#fffdfa] px-3 pb-2.5 pt-2.5 dark:bg-zinc-900/60">
        {/* 已签署红章（盖章叠在标题右上角） */}
        {signed && (
          <span aria-hidden="true" className="absolute right-2.5 top-2.5 rotate-[12deg] rounded-[4px] border-[1.5px] border-[#c2402f]/55 px-1.5 py-[3px] text-[9.5px] font-bold leading-none text-[#c2402f]/85">
            已生效 ♡
          </span>
        )}

        {/* 协议名（居中加粗 + 两侧短渐变线装饰；自定义协议名照实显示） */}
        <span className="flex items-center justify-center gap-2" data-testid={`${testidPrefix}-pact-card-body`}>
          <span aria-hidden="true" className="h-px w-5 shrink-0 bg-gradient-to-r from-transparent to-black/25 dark:to-white/25" />
          <span className="text-center text-[13.5px] font-black tracking-wider text-black/90 dark:text-zinc-100">{data.title || '恋爱协议书'}</span>
          <span aria-hidden="true" className="h-px w-5 shrink-0 bg-gradient-to-l from-transparent to-black/25 dark:to-white/25" />
        </span>
        <span aria-hidden="true" className="mt-1.5 block h-[1.5px] w-full rounded-full bg-gradient-to-r from-transparent via-black/30 to-transparent dark:via-white/30" />

        {/* 前言（为维护双方的感情与信任…共同遵守：；空前言跳过） */}
        {data.preamble && data.preamble.trim() && (
          <span className="mt-1.5 block text-justify text-[10px] leading-[1.65] text-black/55 line-clamp-3 dark:text-zinc-400">{data.preamble.trim()}</span>
        )}

        {/* 虚线分隔 + 编号条款（1. 2. 3. …竖排列表；最多 5 条，多出折叠；编号粉色点缀） */}
        {shown.length > 0 && (
          <>
            <span aria-hidden="true" className="my-1.5 block border-t border-dashed border-black/10 dark:border-white/10" />
            <span className="block space-y-[3.5px]">
              {shown.map((c, i) => (
                <span key={i} className="flex items-start gap-1.5 text-[10px] leading-[1.55] text-black/75 dark:text-zinc-300">
                  <span className="shrink-0 font-semibold leading-[1.55] text-[#f2536a]/75">{i + 1}.</span>
                  <span className="min-w-0 flex-1 line-clamp-2">{c.trim()}</span>
                </span>
              ))}
            </span>
            {extra > 0 && <span className="mt-1 block text-[9px] text-black/35 dark:text-zinc-500">…还有 {extra} 条，点开查看全部</span>}
          </>
        )}
        {shown.length === 0 && (
          <span className="mt-1.5 block text-center text-[10px] text-black/45 dark:text-zinc-500">甜蜜约定 · 一起遵守的小条款</span>
        )}

        {/* 状态附注行（TA 已先签 / 婉拒理由） */}
        {canSign && data.taSigned && (
          <span className="mt-1.5 block text-center text-[9.5px] text-black/40 dark:text-zinc-500">{data.fromName}已签名，就等你啦</span>
        )}
        {declined && (
          <span className="mt-1.5 block text-center text-[9.5px] text-black/40 dark:text-zinc-500">
            {declinedByMe ? '你已经婉拒，TA 已经知道了' : data.reason ? `TA 想了想：${data.reason}` : '可以再沟通，或换个小约定'}
          </span>
        )}

        {/* 签署按钮（文案随状态；胶囊样式保持家族一致） */}
        <span
          data-testid={canSign ? `${testidPrefix}-pact-card-sign` : undefined}
          className="mt-2 flex h-8 items-center justify-center rounded-full bg-gradient-to-r from-[#ff7a9c] to-[#f2536a] text-[13px] font-bold text-white shadow-[0_2px_8px_rgba(242,83,106,0.24)]"
        >
          {signed ? '查看协议' : declined ? '查看详情' : canSign ? (
            <>
              <PenLine className="mr-1 h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
              去签署
            </>
          ) : '查看详情'}
        </span>
      </span>
    </div>
  );
}
