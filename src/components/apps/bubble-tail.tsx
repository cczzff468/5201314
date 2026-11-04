/**
 * 弯钩小尾巴（第十八轮）——聊天气泡装扮「参考图同款」尾巴
 * ---------------------------------------------------------------------------
 * 形状：水滴弯钩 —— 尖端在头像一侧偏上，外缘凸弧向下掠入气泡本体，
 * 内缘与气泡圆角之间留出月牙缺口（BUBBLE_TAIL_PATH 贝塞尔，已在设计时数值验证）。
 *
 * 定位：横向与气泡本体重叠 2px 保证无缝（左/右 -8px，SVG 宽 10px）；
 * 我方（mine）自动水平镜像，尖端指向右侧自己的头像。
 * 尾巴固定尺寸（不随气泡行数缩放），与主流 IM 实现一致。
 *
 * 垂直定位（第十九轮）：top 支持 number（距顶 px）或 string（CSS calc/max）——
 * QQ 聊天行头像底对齐（items-end），弯钩尾巴要与**头像顶端**平行（第二十轮，用户指定）：
 * top = max(4px, calc(100% - 46.5px)) → 尾巴中心落在气泡底部上方 40px = 40px 头像的顶端线
 * （46.5 = 头像高 40 + SVG 半高 6.5）；短气泡算出负值时 max 收在气泡顶部（≈头像顶端）。
 */
import { BUBBLE_TAIL_PATH } from '@/lib/ios/bubble-style';

export function BubbleTail({
  side,
  color,
  top = 3,
}: {
  /** mine=我的气泡（右侧，尾巴朝右）/ theirs=TA的气泡（左侧，尾巴朝左） */
  side: 'mine' | 'theirs';
  /** 尾巴填充色（与气泡本体同色） */
  color: string;
  /** 距气泡顶部偏移：number=px；string=原样 CSS（如 'max(4px, calc(100% - 46.5px))' 头像顶端平行定位） */
  top?: number | string;
}) {
  const theirs = side === 'theirs';
  /* 第五十轮（用户指定「小尾巴再细一点」）：同一弯钩几何横向压扁到 78%——
     弯钩整体变细、尖端突出量同步缩短（0.78×），根部与气泡的搭接仍保持 ~2px 无缝
     （偏移由 -8 收到 -6.6：缩后根缘 10×0.78=7.8px，-6.6+7.8=1.2≈原 2px 搭接量级）。
     我方镜像合成 scaleX(-0.78)（翻转 + 压扁一步完成）。高度（纵向）不变。 */
  const SLIM = 0.78;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute"
      width="10"
      height="13"
      viewBox="0 0 11 14"
      style={
        theirs
          ? { left: -6.6, top, transform: 'none' }
          : { right: -6.6, top, transform: `scaleX(-${SLIM})` }
      }
    >
      <path d={BUBBLE_TAIL_PATH} fill={color} transform={`scale(${SLIM} 1)`} />
    </svg>
  );
}
