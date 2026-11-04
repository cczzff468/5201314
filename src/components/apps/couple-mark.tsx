'use client';

import { useCoupleBadgeOn } from '@/lib/ios/couple-invite';

/**
 * 情侣空间标识（第九/十轮）：联系人名字后面的「徽章 + 钥匙」图标。
 * - 素材为用户提供的原图抠底（public/qq-couple-badge.png / qq-couple-key.png，96px 无白边），
 *   徽章在前、钥匙在后依次挨着（用户指定顺序）；
 * - 显隐 = 与该联系人的情侣空间关系处于「已建立」（useCoupleBadgeOn 订阅 COUPLE_STATE_EVENT：
 *   开通即时出现、解除即时消失，跨页面同步）；
 * - QQ 聊天页标题栏 / QQ 消息列表会话行共用本组件（第十轮：消息列表也要显示）。
 */
export function CoupleMark({
  contactId,
  size = 20,
  className = '',
  testId,
}: {
  contactId: string | null | undefined;
  /** 图标边长（px），徽章与钥匙同尺寸（第十二轮：14→20，用户反馈太小） */
  size?: number;
  className?: string;
  /** 测试锚点（会话列表/聊天页可区分） */
  testId?: string;
}) {
  const on = useCoupleBadgeOn(contactId);
  if (!on) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center align-[-3px] ${className}`}
      {...(testId ? { 'data-testid': testId } : {})}
      role="img"
      aria-label="情侣空间标识"
    >
      {/* 徽章在前（用户图2），钥匙在后（用户图3），相邻 1px 间隙 */}
      <img
        src="/qq-couple-badge.png"
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="select-none object-contain"
      />
      <img
        src="/qq-couple-key.png"
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="ml-[1px] select-none object-contain"
      />
    </span>
  );
}
