'use client';

import { memo } from 'react';

/**
 * 默认头像：机主上传的浅灰人形剪影图（public/default-avatar.png，
 * 联系人 App / 信息 App / 电话 / 通话 / 朋友圈等全系统通用）。
 * 注意：X 论坛（forum/*）不共用本组件，仍直接引用旧图 /default-profile.png（机主指定论坛除外）。
 * shape='square' 时不内置圆角（微信 App 风格：方形圆角头像由调用方按尺寸传入 rounded-[Xpx]），
 * 避免与内置 rounded-full 产生同类工具类冲突。
 * memo：props 全为原始值（size/className/shape），聊天页/联系人列表/群头像高频重渲染时
 * 浅比较恒稳定即可命中，收敛子树 reconcile 开销（行为零变化）。
 */
export const DefaultAvatar = memo(function DefaultAvatar({
  size = 44,
  className = '',
  shape = 'circle',
}: {
  size?: number;
  className?: string;
  shape?: 'circle' | 'square';
}) {
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden ${shape === 'circle' ? 'rounded-full' : ''} bg-[#C7C7CC] ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/default-avatar.png"
        alt=""
        draggable={false}
        className="h-full w-full select-none object-cover"
      />
    </div>
  );
});
