'use client';

/**
 * 亲密关系卡片气泡（情侣空间邀请卡 / 成功卡）——微信/QQ 聊天共用。
 *
 * 仿 QQ「亲密关系」卡片（用户参考截图1）：
 * - 白底圆角卡：标题黑粗 + 灰色副文案 + 右侧情侣空间图标 + 底部「亲密关系」小字标签
 * - 邀请卡 pending 且对方发来 → 底部「拒绝 / 接受邀请」双按钮（仿群聊邀请卡交互）
 * - 我发的邀请卡 pending → 「等待对方接受」状态行；终态显示「已同意 / 已拒绝」
 * - 成功卡 → 标题「我们已经成功建立情侣关系」+「我已经同意了你的邀请，现在我们是情侣啦」
 * - 图标用粉色双心官方图 couple.png（与主屏/App Store 同源原图）；用原生 <img> 直出——
 *   不走 next/image 优化端点（dev 下 w=44 不在允许宽度列表会 400，且优化缓存可能返回旧图）
 */

import type { CoupleRelCardData } from '@/lib/ios/couple-invite';
import { useUI } from '@/lib/ios/store';

export interface CoupleRelBubbleProps {
  data: CoupleRelCardData;
  /** 消息是否我发的（msg.role === 'me'）：决定标题视角与按钮显隐 */
  mine: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  testidPrefix?: string; // 'wx' | 'qq'（E2E 用）
}

export default function CoupleRelBubble({ data, mine, onAccept, onDecline, testidPrefix = 'wx' }: CoupleRelBubbleProps) {
  const channelName = data.app === 'wx' ? '微信' : 'QQ';
  const isInvite = data.stage === 'invite';
  const declined = data.status === 'declined';

  /** 点击卡片本体进入情侣空间 APP（第七轮用户要求）：在其它 App 内直接切换，主屏则打开 */
  const openCoupleApp = () => {
    const ui = useUI.getState();
    if (ui.locked) return;
    if (ui.activeApp && ui.activeApp !== 'couple') ui.switchToApp('couple');
    else if (!ui.activeApp && ui.phase === 'closed') ui.openApp('couple');
  };

  // 标题/副文案视角（对照截图1：邀请卡与成功卡两种）
  let title: string;
  let desc: string;
  if (isInvite) {
    if (mine) {
      title = `你想和${data.toName}建立情侣关系`;
      desc = `邀请TA成为情侣，让${channelName}帮我们记录每日点滴`;
    } else {
      title = `${data.fromName}想和你建立情侣关系`;
      desc = `和我成为情侣，让${channelName}帮我们记录每日点滴`;
    }
  } else {
    title = '我们已经成功建立情侣关系';
    desc = mine ? '我已经同意了你的邀请，现在我们是情侣啦' : '我已经同意了你的邀请，现在我们是情侣啦';
  }

  // 底部状态行（终态）；pending 时对方邀请卡出双按钮、我的邀请卡出等待文案；
  // 已同意 → 不出 footer，走默认左下角「亲密关系」标签（用户要求：去掉居中「已同意」，与成功卡底部一致）
  let footer: string | null = null;
  if (isInvite) {
    if (data.status === 'accepted') footer = null;
    else if (declined) footer = '已拒绝';
    else if (mine) footer = '等待对方接受';
  }

  return (
    <div
      data-testid={`${testidPrefix}-rel-card`}
      className={`w-[248px] select-none overflow-hidden rounded-[10px] bg-white shadow-sm dark:bg-[#1E1E1E] ${declined ? 'opacity-60' : ''}`}
    >
      {/* 卡片本体：标题 + 副文案 + 图标（点击进入情侣空间 APP；操作按钮仍在下方，不冲突） */}
      <button
        type="button"
        data-testid={`${testidPrefix}-rel-card-body`}
        onClick={(e) => {
          e.stopPropagation();
          openCoupleApp();
        }}
        className="flex w-full cursor-pointer items-center gap-2.5 px-3 pb-2.5 pt-3 text-left transition-opacity active:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-semibold leading-[1.35] text-black dark:text-white">{title}</span>
          <span className="mt-1 block text-[13px] leading-[1.45] text-black/45 dark:text-white/45">{desc}</span>
        </span>
        {/* 情侣空间图标（粉色双心官方原图，圆角方块；原生 img 直出不经优化端点） */}
        <span aria-hidden="true" className="h-11 w-11 shrink-0 overflow-hidden rounded-[9px] shadow-[0_2px_6px_rgba(0,0,0,0.10)]">
          <img src="/icons/couple.png" alt="情侣空间" className="h-full w-full object-cover" draggable={false} />
        </span>
      </button>

      {/* 底部：按钮行 / 状态行 / 「亲密关系」标签 */}
      {isInvite && data.status === 'pending' && !mine ? (
        <div className="flex border-t border-black/[0.06] dark:border-white/[0.08]">
          <button
            type="button"
            data-testid={`${testidPrefix}-rel-card-decline`}
            onClick={onDecline}
            className="flex-1 py-2 text-[13.5px] text-black/55 active:bg-black/[0.04] dark:text-white/55 dark:active:bg-white/[0.06]"
          >
            拒绝
          </button>
          <button
            type="button"
            data-testid={`${testidPrefix}-rel-card-accept`}
            onClick={onAccept}
            className="flex-1 border-l border-black/[0.06] py-2 text-[13.5px] font-medium text-[#45454c] active:bg-black/[0.04] dark:border-white/[0.08] dark:text-white/85 dark:active:bg-white/[0.06]"
          >
            接受邀请
          </button>
        </div>
      ) : footer ? (
        <div className="border-t border-black/[0.06] px-3 py-1.5 text-center text-[12px] text-black/40 dark:border-white/[0.08] dark:text-white/40">
          {footer}
        </div>
      ) : (
        <div className="border-t border-black/[0.06] px-3 py-1.5 text-[12px] text-black/40 dark:border-white/[0.08] dark:text-white/40">亲密关系</div>
      )}
    </div>
  );
}
