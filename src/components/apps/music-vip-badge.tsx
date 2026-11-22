'use client';

/**
 * 网易云音乐 VIP/SVIP 徽章统一组件（v59：全 App 统一「我的」页同款黑胶唱片胶囊）。
 *
 * 用户要求：评论区 / 歌单 / 弹窗——只要有 VIP 和 SVIP 的地方，图标一律跟随
 * 「我的」页那枚精抠徽章（第十四轮：双盘重抠 + 按各自参考截图实测微调）：
 * - 唱片：用户截图原像素抠底 —— public/music-vip-disc-{vip,svip}.png：
 *   - VIP 284px 大黑胶（新截图重抠+内缩 0.75px 防边缘污染；盘面整体压暗 ×0.78——用户反馈
 *     深色资料页上原灰盘面像一圈白晕，压暗后黑胶感回归、无白晕）；
 *   - SVIP 92px 金胶（用户新横条参考图重抠：金渐变盘面+黑外环+深金标签+中心孔）。
 * - 布局（按各自参考实测等比换算，胶囊高 13.5px）：
 *   - VIP 参考（Ø285/胶囊222→0.78）：盘 17.3px；SVIP 参考（Ø93.5/胶囊74→0.79）：盘 17px；
 *   - 胶囊左端凹弧（圆心=唱片圆心、半径 10px，与盘缘留 VIP 1.35 / SVIP 1.5px 间隙）；
 *   - 文字 9px：VIP 米白 #EDE6DD / SVIP 金 #F4E8D0（横条实测 244,232,208）；
 *     胶囊底 VIP #302B28 / SVIP #3D3533（横条实测 61,53,51）。
 *   - 第十七轮修复「VIP 显示不全」：凹弧遮罩透明区在胶囊中线上延伸到左缘+17.2px，旧内边距
 *     pl 4.8/5.4 落在透明区内 →「VI」被遮罩吃掉只剩「P·叁」。按横条参考逐像素实测：
 *     文字起点距胶囊左缘 19.7px（凹弧凸点+2.2px）、距右缘 4.0px → pl 19.7 / pr 4.2，
 *     修复后胶囊总宽 ≈54px 与参考 54.2px 一致。
 *
 * 使用方（v59 起全部走这一份）：
 * - music-mine「我的」页昵称旁 / 编辑资料预览（type+level 完整展示）；
 * - music-comments 评论区主楼 + 楼层回复的用户徽章（vipType≥11=SVIP，
 *   等级取 vipRights.redVipLevel）；
 * - music-home / music-shared / music-heart 歌曲列表 fee===1 的 VIP 角标
 *   （type='vip'、level=0 → 只显示「VIP」不带等级）；
 * - music-player 播放页 ⋮ 弹窗音质行（原 VipChip 黑底小胶囊）。
 * level<1 只显示 VIP。
 */

/** 中文数字（VIP 等级展示，跟网易云一样用大写/繁体数字：壹贰叁肆伍陆柒捌玖拾） */
const CN_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const CN_TEN = '拾';

export function cnNum(n: number): string {
  const x = Math.max(1, Math.min(99, Math.floor(n)));
  if (x < 10) return CN_DIGITS[x];
  const t = Math.floor(x / 10);
  const o = x % 10;
  return (t > 1 ? CN_DIGITS[t] : '') + CN_TEN + (o ? CN_DIGITS[o] : '');
}

/** VIP/SVIP 黑胶唱片胶囊徽章（「我的」页同款；全 App 统一图标） */
export function VipBadge({
  type,
  level,
  className = '',
  testId,
}: {
  type: 'vip' | 'svip';
  level: number;
  className?: string;
  testId?: string;
}) {
  const svip = type === 'svip';
  const DISC = svip ? 17 : 17.3; // 唱片直径（各自参考实测比例）
  const ARC = 10; // 胶囊左端凹弧半径，圆心=唱片圆心
  // 胶囊盒左缘 = 唱片半径 - √(ARC²-(H/2)²)=±7.38 → 盒左缘落在唱片盒内 1.12/1.27px
  const pillInset = DISC / 2 - 7.38;
  const pillMl = pillInset - DISC;
  // mask：唱片圆心在胶囊盒左缘右侧 7.38px；圆内透明（挖出凹弧）、圆外不透明
  const maskCss = `radial-gradient(circle ${ARC}px at ${(DISC / 2 + pillMl) * -1}px 50%, transparent ${ARC - 0.15}px, #000 ${ARC}px)`;
  return (
    <span className={`relative flex shrink-0 items-center ${className}`} data-testid={testId}>
      {/* 用户截图原像素唱片（圆形抠底无白边），上下微溢出胶囊 */}
      <img
        src={svip ? '/music-vip-disc-svip.png' : '/music-vip-disc-vip.png'}
        alt=""
        width={DISC}
        height={DISC}
        draggable={false}
        className="shrink-0 select-none"
        style={{ width: DISC, height: DISC }}
      />
      {/* 深色胶囊：左端凹弧（radial-gradient mask 挖空唱片+间隙区域），右端全圆角。
          pl 19.7px：文字必须从凹弧透明区（左缘+17.2px）之后开始，否则「VI」会被遮罩吃掉（参考实测 19.68px） */}
      <span
        className={`flex h-[13.5px] shrink-0 items-center pl-[19.7px] pr-[4.2px]`}
        style={{
          marginLeft: pillMl,
          borderRadius: '0 999px 999px 0',
          background: svip ? '#3D3533' : '#302B28',
          WebkitMaskImage: maskCss,
          maskImage: maskCss,
        }}
      >
        <span
          className={`text-[9px] font-bold leading-none ${svip ? 'text-[#F4E8D0]' : 'text-[#EDE6DD]'}`}
        >
          {svip ? 'SVIP' : 'VIP'}
          {level >= 1 && <span className="font-bold">·{cnNum(level)}</span>}
        </span>
      </span>
    </span>
  );
}

/**
 * 歌曲列表 VIP 角标（fee===1 时展示）：同一枚黑胶唱片胶囊，不带等级数字。
 * 旧版是浅金色渐变小方标（红色描边文字更假）——v59 按用户要求统一跟随「我的」页图标。
 */
export function VipSongBadge({ className = '' }: { className?: string }) {
  return <VipBadge type="vip" level={0} className={className} />;
}
