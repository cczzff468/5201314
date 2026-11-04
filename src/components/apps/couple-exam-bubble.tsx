'use client';

/**
 * 恋爱水平考试卡片气泡（第十五轮）——微信/QQ 聊天共用。
 *
 * 第二十七轮：邀请卡片和淘宝/美团代付卡片样式一模一样（只换内容）——
 * 结构对齐 TbPayBubble/MtPayBubble：白卡 p-2.5 rounded-[14px] + 指向头像侧的小箭头
 * + 头部（logo 22px + 情侣空间 + ShieldCheck 真爱保障）+ 主标题 + 内容面板 + 胶囊按钮。
 *
 * 第三十轮（用户参考图，只改内容）：主标题改为「恋爱水平考试已开始，请考生作答」；
 * 内容面板由「粉横幅+白面板」改为参考图里的**试卷预览**：米黄卷纸底 + 卷头（爱心徽章 +
 * 恋爱水平考试 + 绝密章）+ 大字「你有一份恋爱水平考试卷 待作答」+「认真作答，测出你们的
 * 恋爱真实水平」+ 装饰题行 +「点击进入作答」按钮；卡片外壳/头部/按钮样式保持家族不变。
 *
 * 用户规格：我可以喊他来答题（发卡片）；他也可以喊我来答题；点击卡片进入试卷页面。
 * 第十七轮·动态状态：答完后卡片自愈显示「已交卷」，点卡片直达结果/答卷页。
 */

import type { CoupleExamCardData } from '@/lib/ios/couple-exam-share';
import { navToExam } from '@/lib/ios/couple-exam-share';
import { kvGet } from '@/lib/ios/idb-kv';
import { useUI } from '@/lib/ios/store';
import { Heart, Play, ShieldCheck } from 'lucide-react';

export interface CoupleExamBubbleProps {
  data: CoupleExamCardData;
  /** 消息是否我发的（msg.role === 'me'） */
  mine: boolean;
  testidPrefix?: string; // 'wx' | 'qq'（E2E 用）
}

export default function CoupleExamBubble({ data, mine, testidPrefix = 'wx' }: CoupleExamBubbleProps) {
  // 动态状态（自愈）：以情侣空间当前状态为准——TA 出的卷我答完 = done；我邀请的卷 TA 交卷 = done
  const done = (() => {
    if (data.status === 'done') return true;
    try {
      const snap = kvGet<{ examTaSheet?: { title?: string } | null; examTaPaper?: { title?: string; answered?: boolean } | null }>('couple-space:state');
      if (data.from === 'me') {
        const sheet = snap?.examTaSheet;
        return !!sheet && (!sheet.title || sheet.title === data.title);
      }
      const paper = snap?.examTaPaper;
      return !!paper?.answered && (!paper.title || paper.title === data.title);
    } catch {
      return false;
    }
  })();

  /** 点击卡片 → 进情侣空间考试页（答完直达结果/答卷页，没答直达答题页；ExamPage 按当前状态自动分流） */
  const openExam = () => {
    const ui = useUI.getState();
    if (ui.locked) return;
    navToExam(data.from, data.title);
    if (ui.activeApp && ui.activeApp !== 'couple') ui.switchToApp('couple');
    else if (!ui.activeApp && ui.phase === 'closed') ui.openApp('couple');
  };

  // 主标题（第三十轮参考图口径：考试已开始，请考生作答；TA 发来的标注出卷人）
  const title = done
    ? '这场考试已经交卷啦~'
    : data.from === 'ta'
      ? `${data.fromName}的恋爱水平考试已开始，请考生作答`
      : '恋爱水平考试已开始，请考生作答';

  return (
    <div
      data-testid={`${testidPrefix}-exam-card`}
      onClick={(e) => {
        e.stopPropagation();
        openExam();
      }}
      className="relative block w-[252px] cursor-pointer select-none rounded-[14px] bg-white p-2.5 text-left shadow-[0_5px_16px_rgba(0,0,0,0.10)] transition-all duration-300 active:brightness-95 dark:bg-zinc-800/95"
      style={{ filter: done ? 'grayscale(0.72) brightness(0.98)' : undefined }}
      role="button"
      aria-label={`恋爱水平考试邀请卡（共 ${data.count} 题，${done ? '已答完' : '待作答'}）`}
    >
      {/* 箭头指向头像侧：我发出（右）/ TA 发来（左），与代付卡一致 */}
      <span aria-hidden="true" className={`absolute top-[13px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white dark:bg-zinc-800/95 ${mine ? '-right-[4px]' : '-left-[4px]'}`} />

      {/* 头部：情侣空间 logo + 真爱保障（外壳保持与代付卡家族一致） */}
      <span className="relative flex items-center gap-1.5">
        <img src="/icons/couple.png" alt="" aria-hidden="true" className="h-[22px] w-[22px] rounded-full object-cover" draggable={false} />
        <span className="text-[13px] font-semibold text-black/85 dark:text-zinc-200">情侣空间</span>
        <span className="ml-auto flex items-center gap-[3px] text-[11px] font-medium text-[#f2536a]">
          <ShieldCheck className="h-[13px] w-[13px]" strokeWidth={2.2} />
          真爱保障
        </span>
      </span>

      {/* 主标题（参考图：大字粗体，可两行） */}
      <span className="relative mt-1.5 block text-[15px] font-bold leading-snug text-black/90 dark:text-zinc-100">{title}</span>

      {/* 试卷预览（第三十轮参考图内容：米黄卷纸 + 卷头 + 大字标题 + 作答按钮） */}
      <span className="relative mt-2 block overflow-hidden rounded-[10px] ring-1 ring-black/[0.06]">
        <span className="relative block bg-[#fbf5e7] px-3 pb-3 pt-2.5">
          {/* 卷头：爱心徽章 + 卷名 + 绝密章 */}
          <span className="relative flex items-center gap-1.5">
            <span aria-hidden="true" className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-[#c2402f]">
              <Heart className="h-[9px] w-[9px] fill-white text-white" />
            </span>
            <span className="text-[11.5px] font-bold tracking-wide text-black/80">恋爱水平考试</span>
            <span aria-hidden="true" className="ml-auto rotate-[10deg] rounded-[3px] border-[1.5px] border-[#c2402f]/60 px-1 py-px text-[8.5px] font-bold leading-none text-[#c2402f]">
              绝密
            </span>
          </span>

          {done ? (
            <>
              {/* 已交卷态：大字换「考试已结束」 */}
              <span className="mt-2.5 block text-[15px] font-black leading-tight tracking-tight text-black/85" data-testid={`${testidPrefix}-exam-card-body`}>
                考试已结束 <span className="text-[12px] font-bold text-[#c2402f]">已交卷</span>
              </span>
              <span className="mt-1 block text-[10px] leading-relaxed text-black/45">
                {data.from === 'me' ? `${data.toName}已交卷 · 点击查看TA的答卷` : '点击查看你的成绩单'}
              </span>
            </>
          ) : (
            <>
              {/* 大字：你有一份恋爱水平考试卷 待作答（卷名红色，参考图） */}
              <span className="mt-2 block text-[12.5px] font-semibold leading-snug text-black/85">
                你有一份
                <span className="text-[16px] font-black tracking-tight text-[#c2402f]" data-testid={`${testidPrefix}-exam-card-body`}>
                  恋爱水平考试卷
                </span>
                待作答
              </span>
              {/* 提示语胶囊（参考图：★ 认真作答，测出你们的恋爱真实水平 ★） */}
              <span aria-hidden="true" className="mt-1.5 inline-block rounded-full border border-[#c2402f]/30 px-2 py-[3px] text-[9px] leading-none text-[#c2402f]/90">
                ★ 认真作答，测出你们的恋爱真实水平 ★
              </span>
              {/* 装饰题行 ×2（呼应参考卷 Q1/Q2 的勾选框+题干版式，纯示意不含假题干） */}
              <span aria-hidden="true" className="mt-2.5 block space-y-[7px]">
                <span className="flex items-center gap-1.5">
                  <span className="h-[9px] w-[9px] shrink-0 rounded-[2px] border border-black/20 bg-white" />
                  <span className="h-[5px] w-3/4 rounded-full bg-black/10" />
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-[9px] w-[9px] shrink-0 rounded-[2px] border border-black/20 bg-white" />
                  <span className="h-[5px] w-2/3 rounded-full bg-black/10" />
                </span>
              </span>
            </>
          )}

          {/* 作答按钮（参考图文案「点击进入作答」；胶囊样式保持家族一致） */}
          <span
            data-testid={`${testidPrefix}-exam-card-go`}
            className="mt-3 flex h-9 items-center justify-center rounded-full bg-gradient-to-r from-[#ff7a9c] to-[#f2536a] text-[14px] font-bold text-white shadow-[0_3px_10px_rgba(242,83,106,0.28)]"
          >
            {done ? (
              '查看结果'
            ) : (
              <>
                <Play className="mr-1.5 h-3.5 w-3.5 fill-white" strokeWidth={0} aria-hidden="true" />
                点击进入作答
              </>
            )}
          </span>
        </span>
      </span>
    </div>
  );
}
