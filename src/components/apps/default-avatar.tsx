/**
 * 默认头像：用户上传的灰蓝人形剪影图（public/default-profile.png，
 * 联系人 App / 信息 App / 论坛等全系统通用）。
 * shape='square' 时不内置圆角（微信 App 风格：方形圆角头像由调用方按尺寸传入 rounded-[Xpx]），
 * 避免与内置 rounded-full 产生同类工具类冲突。
 */
export function DefaultAvatar({
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
        src="/default-profile.png"
        alt=""
        draggable={false}
        className="h-full w-full select-none object-cover"
      />
    </div>
  );
}
