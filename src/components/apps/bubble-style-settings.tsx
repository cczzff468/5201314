'use client';

/**
 * 聊天装扮设置（第十七轮建立 · 本轮：顶部三 Tab + 主题界面简约美化）
 * ---------------------------------------------------------------------------
 * 入口：QQ 个人抽屉 / 设置 › 个性装扮；微信「发现」页 › 主题；
 *       信息 App › 聊天设置 › 主题。
 *
 * 本轮（用户指定：主题界面顶部再加「自定义CSS」Tab + 主题界面美化）：
 *  1. 顶部 iOS 分段胶囊扩为三 Tab：主题 / 气泡 / 自定义CSS ——
 *     全局自定义 CSS 编辑器从主题 Tab 底部独立成页；
 *  2. 「主题」Tab 简约美化：主题选择卡选中态改细 accent 描边 + 轻光晕，
 *     名字随 accent 上色，未选中 hover 轻浮起；
 *  3. 「气泡」Tab：实时预览 + 四格样式 + HSL 颜色 + 收藏夹（不变）；
 *  4. 主题切换仍联动气泡（液态玻璃 ↔ 原生默认，setBubbleTheme 内实现）；
 *     气泡界面单独换样式不动主题（patchAppStyle 只写 kind）。
 */
import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Palette, RotateCcw, Trash2 } from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { LiquidSkinPanel } from './liquid-skin-settings';
import { ChatDecorPanel } from './chat-decor-settings';
import { CustomCssEditor } from './custom-css-editor';
import { globalCssTemplates } from '@/lib/ios/custom-css';
import type { LiquidSkinSettings } from '@/lib/ios/liquid-skin';
import { useSettings } from '@/lib/ios/store';
import {
  BUBBLE_KIND_LABEL,
  BUBBLE_THEME_LABEL,
  THEMES_OF_APP,
  NATIVE_BUBBLE,
  PRESET_SWATCHES,
  TAIL_CLIP_LEFT,
  TAIL_CLIP_RIGHT,
  bubbleVisual,
  hexToHsl,
  hslToHex,
  withAlpha,
  yiqTextOn,
  type BubbleAppId,
  type BubbleAppStyle,
  type BubbleScheme,
  type BubbleStyleConfig,
  type BubbleStyleKind,
  type BubbleTheme,
} from '@/lib/ios/bubble-style';

const PLATFORM_META: Record<BubbleAppId, { name: string; accent: string }> = {
  wx: { name: '微信', accent: '#07C160' },
  qq: { name: 'QQ', accent: '#0099FF' },
  sms: { name: '信息', accent: '#007AFF' },
};

/** 样式副标题（简短说明各自质感，帮助区分毛玻璃/液态） */
const KIND_CAPTIONS: Record<BubbleStyleKind, string> = {
  default: '纯色 · 可自选颜色',
  rainbow: '九色 · 按消息循环',
  frosted: '奶白磨砂 · 隐约透底',
  liquid: '清透水膜 · 透底',
  retro: '小圆角描边 · 古早味',
};

/** 玻璃卡（统一材质；圆角 22px） */
const GLASS_CARD =
  'rounded-[22px] bg-white/60 backdrop-blur-xl ring-1 ring-white/70 dark:bg-white/[0.06] dark:ring-white/[0.14]';

/** 弱文字小标题（区块标签，非装饰；accent 色点 + 文字） */
function SectionLabel({ accent, children }: { accent?: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-2 text-[12.5px] font-semibold tracking-wide text-black/40 dark:text-white/40">
      {accent && (
        <span
          aria-hidden="true"
          className="h-[5px] w-[5px] rounded-full"
          style={{ backgroundColor: accent, boxShadow: `0 0 0 2.5px ${withAlpha(accent, 0.18)}` }}
        />
      )}
      {children}
    </p>
  );
}

/** 区块入场动画（轻微错峰淡入上浮） */
function FadeInSection({
  index,
  className,
  role,
  ariaLabel,
  children,
}: {
  index: number;
  className?: string;
  role?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className={className}
      role={role}
      aria-label={ariaLabel}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index, duration: 0.32 }}
    >
      {children}
    </motion.div>
  );
}

// ---------------- 迷你预览气泡（与聊天页同一渲染引擎，所见即所得） ----------------

/** 彩色光斑层：垫在毛玻璃/液态泡下面，让 backdrop-filter 的模糊效果肉眼可见（功能性，非装饰） */
function AuraLayer() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="absolute -left-4 top-2 h-16 w-16 rounded-full bg-[#FF9500]/35 blur-2xl" />
      <span className="absolute right-6 top-6 h-14 w-14 rounded-full bg-[#34C759]/35 blur-2xl" />
      <span className="absolute bottom-0 left-1/3 h-16 w-16 rounded-full bg-[#AF52DE]/30 blur-2xl" />
      <span className="absolute -right-2 bottom-2 h-14 w-14 rounded-full bg-[#3D9BFF]/30 blur-2xl" />
    </div>
  );
}

/** 单条迷你预览气泡：override 时用装扮样式，否则 App 原生配色
 *  （尾巴跟随 bubbleVisual：QQ 纯色/七彩 = 信息 App 同款底部弯钩剪影（第五十一轮，迷你版随色）；
 *   微信/信息 = 原生小方块随色（第五十八轮：古早微信同款小三角，tailClass 深浅自适应）；胶囊无尾巴；
 *   第六十三轮：QQ 古早 = 同款迷你底部弯钩（颜色走 .rt-beak-* 类，与聊天页同款造型语言）） */
function PreviewBubble({
  app,
  cfg,
  side,
  index,
  children,
  className = '',
}: {
  app: BubbleAppId;
  cfg: BubbleStyleConfig;
  side: 'mine' | 'theirs';
  index: number;
  children: React.ReactNode;
  className?: string;
}) {
  const vis = bubbleVisual(side, cfg, index, app);
  const native = side === 'mine' ? NATIVE_BUBBLE[app].mine : NATIVE_BUBBLE[app].theirs;
  const nativeText = side === 'mine' && app !== 'wx' ? 'text-white' : 'text-black';
  // 原生圆角与各端文本气泡同规格：微信 5px / QQ 10px / 信息 18px（iMessage 大圆角）
  const nativeRadius = app === 'sms' ? 'rounded-[18px]' : app === 'qq' ? 'rounded-[10px]' : 'rounded-[5px]';
  return (
    <div
      className={`relative w-fit max-w-full whitespace-pre-wrap break-words ${nativeRadius} px-2.5 py-[7px] text-[12.5px] leading-[1.45] ${
        vis.override ? vis.className : nativeText
      } ${className}`}
      style={vis.override ? vis.style : { backgroundColor: native }}
    >
      {vis.tail === 'im' && (
        /* QQ 装扮纯色/七彩（第五十一轮）：信息 App 同款底部弯钩剪影尾巴（迷你版，随 tailColor 上色） */
        <span
          aria-hidden="true"
          className={`absolute bottom-0 ${side === 'mine' ? '-right-[4px]' : '-left-[4px]'} h-[13px] w-[10px]`}
          style={{ clipPath: side === 'mine' ? TAIL_CLIP_RIGHT : TAIL_CLIP_LEFT, backgroundColor: vis.tailColor || native }}
        />
      )}
      {vis.tail === 'native' && app !== 'qq' && (() => {
        /* 古早（含自定义色）都带 1px 描边：迷你尾巴外移/上移 1px 补偿 + 颜色走 .rt-tail-* 类 */
        const retro = vis.override && vis.className.includes('bub-retro');
        return (
          <span
            aria-hidden="true"
            className={`absolute h-[6px] w-[6px] rotate-45 ${
              retro
                ? `top-[6px] ${side === 'mine' ? '-right-[3px]' : '-left-[3px]'}${vis.tailClass ? ` ${vis.tailClass}` : ''}`
                : `top-[7px] ${side === 'mine' ? '-right-[2px]' : '-left-[2px]'}`
            }`}
            style={vis.tailClass ? undefined : { backgroundColor: vis.tailColor || native }}
          />
        );
      })()}
      {vis.tail === 'retro' && (
        /* QQ 古早（第六十三轮）：迷你版底部弯钩尾巴——与七彩 im 预览同款几何，
           颜色走 .rt-beak-* 类（深色自适应；自定义色时 tailColor 平色） */
        <span
          aria-hidden="true"
          className={`absolute bottom-0 ${side === 'mine' ? '-right-[4px]' : '-left-[4px]'} h-[13px] w-[10px] ${
            vis.tailColor ? '' : side === 'mine' ? 'rt-beak-mine' : 'rt-beak-theirs'
          }`}
          style={{
            clipPath: side === 'mine' ? TAIL_CLIP_RIGHT : TAIL_CLIP_LEFT,
            ...(vis.tailColor ? { background: vis.tailColor } : {}),
          }}
        />
      )}
      {children}
    </div>
  );
}

/** 预览卡里的一行消息（带头像圆点） */
function PreviewRow({
  app,
  cfg,
  side,
  index,
  text,
}: {
  app: BubbleAppId;
  cfg: BubbleStyleConfig;
  side: 'mine' | 'theirs';
  index: number;
  text: string;
}) {
  const meta = PLATFORM_META[app];
  return (
    <div className={`flex items-end gap-1.5 ${side === 'mine' ? 'flex-row-reverse' : ''}`}>
      <span
        aria-hidden="true"
        className={`z-[1] flex h-[26px] w-[26px] shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold text-white ${
          side === 'mine' ? '' : 'bg-gradient-to-br from-[#F0A0B8] to-[#C86DD7]'
        }`}
        style={side === 'mine' ? { background: meta.accent } : undefined}
      >
        {side === 'mine' ? '我' : 'TA'}
      </span>
      <PreviewBubble app={app} cfg={cfg} side={side} index={index}>
        {text}
      </PreviewBubble>
    </div>
  );
}

/** 预览消息序列：序号 0-3 递增（七彩样式下能看到 亮黄→青柠→杏色→青色 依次切换） */
const PREVIEW_MESSAGES: { side: 'mine' | 'theirs'; text: string }[] = [
  { side: 'theirs', text: '早安呀，今天也要开心' },
  { side: 'mine', text: '早安！窗外云超好看' },
  { side: 'theirs', text: '哈哈快拍给我看看' },
];

// ---------------- 顶部实时大预览（本轮：预览卡放最上面，选哪个主题显示哪个样式） ----------------

/** 大预览里的消息序列（真实装扮泡渲染，气泡装扮同步联动） */
const LIVE_MESSAGES: { side: 'mine' | 'theirs'; text: string }[] = [
  { side: 'theirs', text: '早安呀，今天也要开心' },
  { side: 'mine', text: '早安！窗外云超好看' },
  { side: 'theirs', text: '哈哈快拍给我看看' },
];

/** 液态主题顶栏名字区（实时跟随「液态玻璃设置」的名字模式/中间文字/显示名字，所见即所得） */
function LiveLiquidHeader({ skin, accent }: { skin: LiquidSkinSettings; accent: string }) {
  const name = '安吉丽娜';
  const mid = skin.headerMiddleText;
  const peerAva = 'h-[20px] w-[20px] shrink-0 rounded-full bg-gradient-to-br from-[#F0A0B8] to-[#C86DD7]';
  const mineAva = 'h-[20px] w-[20px] shrink-0 rounded-full';

  if (skin.headerMode === 'avatarName') {
    return (
      <span className="lg-title flex items-center gap-[6px] rounded-[15px] py-[5px] pl-[6px] pr-[12px]">
        <span aria-hidden className={peerAva} />
        {skin.headerShowName && (
          <span className="max-w-[120px] truncate text-[11.5px] font-semibold text-black/85 dark:text-white/90">{name}</span>
        )}
      </span>
    );
  }
  if (skin.headerMode === 'dual') {
    return (
      <span className="lg-title flex items-center gap-[6px] rounded-[15px] py-[5px] pl-[6px] pr-[8px]">
        <span aria-hidden className={peerAva} />
        {mid && <span className="max-w-[90px] truncate text-[10px] font-semibold text-black/70 dark:text-white/80">{mid}</span>}
        <span aria-hidden className={mineAva} style={{ background: accent }} />
      </span>
    );
  }
  if (skin.headerMode === 'dualName') {
    return (
      <span className="lg-title flex items-center gap-[5px] rounded-[15px] py-[5px] pl-[8px] pr-[10px]">
        <span className="flex w-[38px] flex-col items-center gap-[2px]">
          <span aria-hidden className="h-[17px] w-[17px] rounded-full bg-gradient-to-br from-[#F0A0B8] to-[#C86DD7]" />
          <span className="max-w-[38px] truncate text-[7.5px] font-medium leading-none text-black/60 dark:text-white/65">{name}</span>
        </span>
        {mid && <span className="max-w-[90px] truncate text-[9.5px] font-semibold text-black/70 dark:text-white/80">{mid}</span>}
        <span className="flex w-[38px] flex-col items-center gap-[2px]">
          <span aria-hidden className="h-[17px] w-[17px] rounded-full" style={{ background: accent }} />
          <span className="text-[7.5px] font-medium leading-none text-black/60 dark:text-white/65">我</span>
        </span>
      </span>
    );
  }
  return (
    <span className="lg-title rounded-[15px] px-[13px] py-[6px] text-[11.5px] font-semibold text-black/85 dark:text-white/90">{name}</span>
  );
}

/** 顶部实时大预览卡：选哪个主题就实时渲染哪个主题的整页样式——
 *  状态栏 + 顶栏（液态 = 玻璃圆钮 + 名字胶囊，联动液态设置；默认 = 白实底条；
 *  古早 = 银灰拟物导航条 + 复古气泡）+ 日期胶囊 + 三条真实装扮消息 + 输入条发送键 +
 *  TabBar（液态 = 悬浮玻璃胶囊；古早 = 银灰拟物硬边条）。
 *  切换主题时整卡淡入淡出过渡。 */
function ThemeLivePreview({
  app,
  cfg,
  theme,
  accent,
  skin,
}: {
  app: BubbleAppId;
  cfg: BubbleStyleConfig;
  theme: BubbleTheme;
  accent: string;
  skin: LiquidSkinSettings;
}) {
  const liquid = theme === 'liquid';
  const retro = theme === 'retro';
  const solid = 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.07)] dark:bg-[#2A2B30] dark:shadow-none';
  return (
    <div
      className="relative overflow-hidden rounded-[22px] ring-1 ring-black/[0.06] dark:ring-white/[0.10]"
      style={{ boxShadow: liquid ? '0 16px 40px rgba(31,38,135,0.16)' : '0 14px 36px rgba(17,24,39,0.09)' }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={theme}
          initial={{ opacity: 0, scale: 1.015 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className={`relative flex h-[310px] flex-col ${
            liquid ? 'lg-root' : retro ? 'rt-root' : 'bg-gradient-to-b from-[#F6F7FA] to-[#EBEDF2] dark:from-[#191B20] dark:to-[#141519]'
          }`}
        >
          {liquid && <AuraLayer />}
          {/* 状态栏：时间 + 信号/Wi-Fi/电池（古早 = 深灰安卓风） */}
          <div className="relative flex shrink-0 items-center justify-between px-[16px] pt-[9px]">
            <span className={`text-[11px] font-semibold tabular-nums leading-none ${retro ? 'text-[#2B2B30]' : 'text-black/45 dark:text-white/50'}`}>9:41</span>
            <span aria-hidden className="flex items-center gap-[4px]">
              <span className="flex items-end gap-[1.5px]">
                {[4, 6, 8, 10].map((h) => (
                  <i key={h} className={`w-[2.5px] rounded-[1px] ${retro ? 'bg-[#3A3A40]' : 'bg-black/40 dark:bg-white/50'}`} style={{ height: h }} />
                ))}
              </span>
              <i className={`h-[7px] w-[7px] rounded-full border-[1.5px] ${retro ? 'border-[#3A3A40]' : 'border-black/40 dark:border-white/50'}`} />
              <span className={`flex h-[10px] w-[17px] items-center rounded-[3px] border p-[1.5px] ${retro ? 'border-[#3A3A40]' : 'border-black/30 dark:border-white/40'}`}>
                <i className={`h-full w-[68%] rounded-[1px] ${retro ? 'bg-[#3A3A40]' : 'bg-black/45 dark:bg-white/55'}`} />
              </span>
            </span>
          </div>
          {/* 顶栏：液态 = 玻璃圆钮 + 名字胶囊（联动液态设置名字模式）；默认 = 白实底条；古早 = 银灰拟物导航条 */}
          {liquid ? (
            <div className="relative mx-3 mt-[7px] flex h-[34px] shrink-0 items-center justify-between">
              <span aria-hidden className="lg-chip flex h-[28px] w-[28px] items-center justify-center rounded-full">
                <span className="h-[8px] w-[8px] -rotate-45 border-b-[1.8px] border-l-[1.8px] border-black/45 dark:border-white/55" />
              </span>
              <LiveLiquidHeader skin={skin} accent={accent} />
              <span aria-hidden className="lg-chip flex h-[28px] w-[28px] items-center justify-center rounded-full">
                <span className="flex items-center gap-[2.5px]">
                  {[0, 1, 2].map((d) => (
                    <i key={d} className="h-[2.5px] w-[2.5px] rounded-full bg-black/40 dark:bg-white/50" />
                  ))}
                </span>
              </span>
            </div>
          ) : retro ? (
            <div className="rt-bar relative mx-2 mt-[7px] flex h-[34px] shrink-0 items-center justify-between rounded-t-[8px] px-[12px]">
              <span aria-hidden className="h-[9px] w-[9px] -rotate-45 border-b-[2px] border-l-[2px] border-[#3E4250]" />
              <span className="text-[12px] font-bold text-[#3A3E4C]">安吉丽娜</span>
              <span aria-hidden className="flex items-center gap-[3px]">
                {[0, 1, 2].map((d) => (
                  <i key={d} className="h-[2.5px] w-[2.5px] rounded-full bg-[#4A4E5C]" />
                ))}
              </span>
            </div>
          ) : (
            <div className={`relative mx-3 mt-[7px] flex h-[34px] shrink-0 items-center justify-between rounded-[14px] px-[14px] ${solid}`}>
              <span aria-hidden className="h-[9px] w-[9px] -rotate-45 border-b-[1.8px] border-l-[1.8px] border-black/40 dark:border-white/50" />
              <span className="text-[12px] font-semibold text-black/75 dark:text-white/85">安吉丽娜</span>
              <span aria-hidden className="flex items-center gap-[3px]">
                {[0, 1, 2].map((d) => (
                  <i key={d} className="h-[2.5px] w-[2.5px] rounded-full bg-black/35 dark:bg-white/45" />
                ))}
              </span>
            </div>
          )}
          {/* 日期胶囊（真聊天页的时间行样式；古早 = 白底硬边小方角） */}
          <div className="relative mb-[2px] mt-[12px] flex shrink-0 justify-center">
            <span className={retro ? 'rt-time rounded-[4px] px-2.5 py-[3px] text-[9px] font-medium leading-none' : 'rounded-full bg-black/[0.06] px-2.5 py-[3px] text-[9px] font-medium leading-none text-black/40 dark:bg-white/[0.08] dark:text-white/40'}>
              今天 14:32
            </span>
          </div>
          {/* 消息（带头像的真实装扮泡） */}
          <div className="relative flex flex-1 flex-col gap-[10px] px-4 pt-[10px]">
            {LIVE_MESSAGES.map((m, i) => (
              <div key={i} className={`flex items-end gap-[6px] ${m.side === 'mine' ? 'flex-row-reverse self-end' : 'self-start'}`}>
                <span
                  aria-hidden
                  className={`h-[24px] w-[24px] shrink-0 ${retro ? 'rounded-[5px]' : 'rounded-full'} ${m.side === 'theirs' ? 'bg-gradient-to-br from-[#F0A0B8] to-[#C86DD7]' : ''}`}
                  style={m.side === 'mine' ? { background: accent } : undefined}
                />
                <PreviewBubble app={app} cfg={cfg} side={m.side} index={i} className="!px-3 !py-[6px] !text-[11.5px]">
                  {m.text}
                </PreviewBubble>
              </div>
            ))}
          </div>
          {/* 输入条 + 发送键（液态底部留出悬浮 TabBar 的位置；古早 = 银灰拟物输入条） */}
          <div
            className={`relative mx-3 flex h-[32px] shrink-0 items-center rounded-full pl-[14px] pr-[5px] ${
              liquid ? 'lg-input mb-[50px]' : retro ? 'rt-inputbar mb-[10px] rounded-[6px]' : `${solid} mb-[10px]`
            }`}
          >
            <span aria-hidden className={`h-[5px] w-[46%] rounded-full ${retro ? 'bg-black/[0.12]' : 'bg-black/[0.10] dark:bg-white/20'}`} />
            <span
              aria-hidden
              className={`ml-auto flex h-[23px] w-[23px] shrink-0 items-center justify-center ${retro ? 'rounded-[4px]' : 'rounded-full'}`}
              style={{ backgroundColor: retro ? (app === 'wx' ? '#9EE75A' : '#7EA3D8') : accent }}
            >
              <span className={`h-[8px] w-[8px] rotate-45 border-l-[2px] border-t-[2px] ${retro ? (app === 'wx' ? 'border-[#1E3A0E]' : 'border-[#152A42]') : 'border-white/95'}`} />
            </span>
          </div>
          {/* TabBar：液态 = 悬浮玻璃胶囊；古早 = 银灰拟物硬边条；默认 = 贴底实底条 */}
          {liquid ? (
            <div className="lg-tabbar absolute inset-x-[14px] bottom-[10px] flex h-[34px] items-center justify-around">
              {[0, 1, 2, 3].map((d) => (
                <span key={d} className="flex h-[18px] w-[28px] flex-col items-center justify-center gap-[2.5px]">
                  <i className="h-[7px] w-[7px] rounded-[2.5px]" style={{ backgroundColor: d === 0 ? accent : 'rgba(0,0,0,0.26)' }} />
                  <i className="h-[2px] w-[9px] rounded-full" style={{ backgroundColor: d === 0 ? accent : 'rgba(0,0,0,0.16)' }} />
                </span>
              ))}
            </div>
          ) : retro ? (
            <div className="rt-tabbar relative flex h-[34px] shrink-0 items-center justify-around">
              {[0, 1, 2, 3].map((d) => (
                <span key={d} className="flex h-[18px] w-[28px] flex-col items-center justify-center gap-[2.5px]">
                  <i className="h-[7px] w-[7px] rounded-[2px]" style={{ backgroundColor: d === 0 ? '#3D6DB5' : 'rgba(50,54,66,0.55)' }} />
                  <i className="h-[2px] w-[9px]" style={{ backgroundColor: d === 0 ? '#3D6DB5' : 'rgba(50,54,66,0.45)' }} />
                </span>
              ))}
            </div>
          ) : (
            <div className="relative flex h-[34px] shrink-0 items-center justify-around border-t border-black/[0.06] bg-[#FBFBFD] dark:border-white/[0.08] dark:bg-[#1D1E23]">
              {[0, 1, 2, 3].map((d) => (
                <span key={d} className="flex h-[18px] w-[28px] flex-col items-center justify-center gap-[2.5px]">
                  <i className="h-[7px] w-[7px] rounded-[2.5px]" style={{ backgroundColor: d === 0 ? accent : 'rgba(0,0,0,0.22)' }} />
                  <i className="h-[2px] w-[9px] rounded-full" style={{ backgroundColor: d === 0 ? accent : 'rgba(0,0,0,0.14)' }} />
                </span>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** 紧凑主题卡的材质缩影（~92px）：mini 顶栏条 + 两条迷你气泡 + TabBar——
 *  液态 = 玻璃材质（lg-* + 光斑）；古早 = 淡青底 + 银灰拟物件 + 描边方角气泡；
 *  默认 = 白实底。一眼区分各主题材质。 */
function ThemeMiniThumb({ theme, accent, app }: { theme: BubbleTheme; accent: string; app?: BubbleAppId }) {
  const liquid = theme === 'liquid';
  const retro = theme === 'retro';
  // 古早迷你泡：微信 = 亮绿/纯白；QQ = 灰渐变/浅蓝渐变（第五十六轮新色板）
  const retroMine =
    app === 'qq' ? 'bg-[#C4C4C4]' : 'bg-[#9EE75A]';
  const retroTheirs = app === 'qq' ? 'bg-[#B4CDE7]' : 'bg-white';
  const solid = 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] dark:bg-[#2A2B30] dark:shadow-none';
  return (
    <div
      aria-hidden
      className={`relative h-[78px] overflow-hidden rounded-[14px] ${
        liquid ? 'lg-root' : retro ? 'rt-root' : 'bg-gradient-to-b from-[#F6F7FA] to-[#EBEDF2] dark:from-[#191B20] dark:to-[#141519]'
      }`}
    >
      {liquid && (
        <span className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="absolute -left-2 top-1 h-7 w-7 rounded-full bg-[#FF9500]/35 blur-lg" />
          <span className="absolute right-2 top-3 h-6 w-6 rounded-full bg-[#34C759]/35 blur-lg" />
          <span className="absolute bottom-0 left-1/3 h-7 w-7 rounded-full bg-[#AF52DE]/30 blur-lg" />
        </span>
      )}
      {/* mini 顶栏条 */}
      <div
        className={`relative mx-2 mt-[6px] flex h-[12px] items-center justify-between rounded-full px-[6px] ${
          liquid ? 'lg-search' : retro ? 'rt-bar rounded-[4px]' : solid
        }`}
      >
        <span className={`h-[4px] w-[4px] -rotate-45 border-b border-l ${retro ? 'border-[#3E4250]' : 'border-black/40 dark:border-white/50'}`} />
        <span className={`text-[6.5px] font-semibold leading-none ${retro ? 'font-bold text-[#3A3E4C]' : 'text-black/60 dark:text-white/70'}`}>安吉丽娜</span>
        <span className="flex gap-[1.5px]">
          {[0, 1, 2].map((d) => (
            <i key={d} className={`h-[1.5px] w-[1.5px] rounded-full ${retro ? 'bg-[#4A4E5C]' : 'bg-black/35 dark:bg-white/45'}`} />
          ))}
        </span>
      </div>
      {/* 两条迷你气泡（古早 = 小圆角描边：我方深草绿/对方白） */}
      <div className="relative mt-[7px] flex flex-col gap-[5px] px-2.5">
        <div className="flex items-end gap-[4px]">
          <span className={`h-[11px] w-[11px] shrink-0 ${retro ? 'rounded-[3px]' : 'rounded-full'} bg-gradient-to-br from-[#F0A0B8] to-[#C86DD7]`} />
          <span
            className={
              retro
                ? `h-[12px] w-[46px] rounded-[3px] ${retroTheirs}`
                : 'h-[12px] w-[46px] rounded-[4px] rounded-bl-[2px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-[#2A2B30]'
            }
          />
        </div>
        <div className="flex items-end justify-end gap-[4px]">
          <span
            className={
              retro
                ? `h-[12px] w-[54px] rounded-[3px] ${retroMine}`
                : 'h-[12px] w-[54px] rounded-[4px] rounded-br-[2px]'
            }
            style={retro ? undefined : { backgroundColor: accent }}
          />
          <span className={`h-[11px] w-[11px] shrink-0 ${retro ? 'rounded-[3px]' : 'rounded-full'}`} style={{ backgroundColor: accent }} />
        </div>
      </div>
      {/* TabBar */}
      {liquid ? (
        <div className="lg-tabbar absolute inset-x-[7px] bottom-[6px] flex h-[9px] items-center justify-around">
          {[0, 1, 2, 3].map((d) => (
            <i key={d} className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: d === 0 ? accent : 'rgba(0,0,0,0.30)' }} />
          ))}
        </div>
      ) : retro ? (
        <div className="rt-tabbar absolute inset-x-0 bottom-0 flex h-[11px] items-center justify-around">
          {[0, 1, 2, 3].map((d) => (
            <i key={d} className="h-[3px] w-[3px] rounded-[1px]" style={{ backgroundColor: d === 0 ? '#3D6DB5' : 'rgba(50,54,66,0.5)' }} />
          ))}
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex h-[11px] items-center justify-around border-t border-black/[0.06] bg-[#FBFBFD] dark:border-white/[0.08] dark:bg-[#1D1E23]">
          {[0, 1, 2, 3].map((d) => (
            <i
              key={d}
              className="h-[3px] w-[3px] rounded-full bg-black/[0.18] dark:bg-white/40"
              style={d === 0 ? { backgroundColor: accent } : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- HSL 滑条（胶囊轨道） ----------------

let hslSliderSeq = 0;

function HslSlider({
  value,
  max,
  trackBackground,
  thumbColor,
  label,
  onChange,
}: {
  value: number;
  max: number;
  trackBackground: string;
  thumbColor: string;
  label: string;
  onChange: (v: number) => void;
}) {
  const [id] = useState(() => `hsl-slider-${++hslSliderSeq}`);
  return (
    <div className="relative h-6">
      {/* 滑杆手柄底色随当前色变化：内联样式选不中伪元素，挂一段组件级动态样式 */}
      <style>{`#${id}::-webkit-slider-thumb{background-color:${thumbColor}} #${id}::-moz-range-thumb{background-color:${thumbColor}}`}</style>
      {/* 胶囊轨道：渐变底 + 发丝白描边 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full ring-1 ring-white/60 dark:ring-white/[0.14]"
        style={{ background: trackBackground }}
      />
      <input
        id={id}
        type="range"
        aria-label={label}
        value={Math.round(value)}
        min={0}
        max={max}
        step={1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-6 w-full cursor-pointer appearance-none bg-transparent
          [&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.22)]
          [&::-moz-range-thumb]:h-[22px] [&::-moz-range-thumb]:w-[22px] [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.22)]"
      />
    </div>
  );
}

export interface ThemeStylePageProps {
  /** 宿主 App（装扮完全隔离：本页所有修改只写入 cfg[app]） */
  app: BubbleAppId;
  /** 返回上一级 */
  onBack: () => void;
  /** 弹一条本地提示 */
  onToast: (m: string) => void;
  /** 页面标题（微信/信息 = 主题（默认）；QQ = 个性装扮） */
  title?: string;
  /** （仅微信）当前登录账号的头像/昵称——液态玻璃设置里网易云小组件预览用 */
  wxMe?: { name: string; avatar: string | null };
}

/** 装扮页（顶部三 Tab 一页直切）：导航栏下方一枚 iOS 分段胶囊（主题 / 气泡 / 自定义CSS），
 *  滑动小白丸指示，点选即切、轻淡入过渡；返回键直接回宿主 App；三个 App 入口 API 不变。 */
export function ThemeStylePage({ app, onBack, onToast, title = '主题', wxMe }: ThemeStylePageProps) {
  /** 顶部三 Tab：theme = 主题（默认）；bubble = 气泡；css = 自定义 CSS（全局作用域） */
  const [tab, setTab] = useState<'theme' | 'bubble' | 'css'>('theme');
  /** 共用滚动容器：切 Tab 回到顶部（设置页习惯） */
  const scrollRef = useRef<HTMLDivElement>(null);
  const bg = 'bg-[#F4F5F7] dark:bg-[#0E1014]';
  const navCls = 'bg-[#F4F5F7]/75! dark:bg-[#0E1014]/75!';

  const switchTab = (k: 'theme' | 'bubble' | 'css') => {
    if (k === tab) return;
    setTab(k);
    navigator.vibrate?.(6);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const tabs: { key: 'theme' | 'bubble' | 'css'; label: string }[] = [
    { key: 'theme', label: '主题' },
    { key: 'bubble', label: '气泡' },
    { key: 'css', label: '自定义CSS' },
  ];

  return (
    <IOSScreen className={`relative ${bg}`}>
      <IOSNavBar title={title} large={false} left={<IOSBackButton onClick={onBack} label="" />} className={navCls} />

      {/* 顶部三 Tab：iOS 分段胶囊（主题 / 气泡 / 自定义CSS），滑动小白丸指示，点选即切 */}
      <div className="relative z-10 flex shrink-0 justify-center px-4 pb-1.5 pt-2">
        <div
          role="tablist"
          aria-label="装扮分类"
          className="flex w-full max-w-[320px] rounded-full bg-black/[0.055] p-[3px] dark:bg-white/[0.08]"
        >
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`dress-tab-${t.key}`}
                onClick={() => switchTab(t.key)}
                className="relative z-10 flex-1 rounded-full py-[6px] text-[13px] font-semibold leading-none"
              >
                {active && (
                  <motion.span
                    layoutId="dress-tab-pill"
                    className="absolute inset-0 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)] dark:bg-white/20 dark:ring-1 dark:ring-white/15"
                    transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                  />
                )}
                <span
                  className={`relative transition-colors ${
                    active ? 'text-black/85 dark:text-white' : 'text-black/40 dark:text-white/45'
                  }`}
                >
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 内容：轻淡入过渡（iOS Tab 切换手感），共用一个滚动容器 */}
      <div ref={scrollRef} className="no-scrollbar flex-1 overflow-y-auto px-4 pb-12 pt-2">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          {tab === 'theme' ? (
            <ThemeContent app={app} onToast={onToast} wxMe={wxMe} />
          ) : tab === 'bubble' ? (
            <BubbleStyleContent app={app} onToast={onToast} />
          ) : (
            <CssContent app={app} onToast={onToast} />
          )}
        </motion.div>
      </div>
    </IOSScreen>
  );
}

/** 主题界面内容：**顶部实时大预览卡**（选哪个主题就显示哪个主题的整页样式，
 *  液态顶栏名字区还联动液态设置实时变化）+ 主题选择卡（材质缩影，点选切换）+
 *  选中液态玻璃时「液态玻璃设置」收缩面板紧跟液态玻璃主题下方（无独立界面）+
 *  「输入框」设置收缩面板（占位文字/输入框上方快捷功能；默认/液态两种主题都可用；信息 App 不接入）。 */
function ThemeContent({
  app,
  onToast,
  wxMe,
}: {
  app: BubbleAppId;
  onToast: (m: string) => void;
  wxMe?: { name: string; avatar: string | null };
}) {
  const meta = PLATFORM_META[app];
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const setBubbleTheme = useSettings((s) => s.setBubbleTheme);
  const skin = useSettings((s) => s.liquidSkin[app]);

  const appStyle: BubbleAppStyle = bubbleStyle[app] ?? { kind: 'default' };
  const curTheme: BubbleTheme = appStyle.theme ?? 'default';
  const liquidOn = curTheme === 'liquid' && THEMES_OF_APP[app].includes('liquid');

  return (
    <>
      {/* 1. 实时大预览（最上面）：选哪个主题，这里就显示哪个主题的样式 */}
      <div role="region" aria-label="主题实时预览">
        <ThemeLivePreview app={app} cfg={bubbleStyle} theme={curTheme} accent={meta.accent} skin={skin} />
        <p className="mt-2 text-center text-[11.5px] font-medium leading-none text-black/40 dark:text-white/40">
          实时预览 · {BUBBLE_THEME_LABEL[curTheme]}
        </p>
      </div>

      {/* 2. 主题选择（材质缩影一眼区分，点选即切换，顶部预览实时跟随；单主题时单列全宽） */}
      <div className="mt-4">
        <SectionLabel accent={meta.accent}>选择主题</SectionLabel>
        <div
          className={`mt-2.5 grid gap-3 ${THEMES_OF_APP[app].length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}
          role="region"
          aria-label="界面主题"
        >
          {THEMES_OF_APP[app].map((theme) => {
            const selected = curTheme === theme;
            return (
              <button
                key={theme}
                type="button"
                data-testid={`bubble-theme-${theme}`}
                aria-pressed={selected}
                onClick={() => {
                  if (!selected) {
                    setBubbleTheme(app, theme);
                    onToast(theme === 'liquid' ? '已切换液态玻璃主题' : theme === 'retro' ? '已切换古早主题' : '已恢复默认主题');
                  }
                }}
                className={`w-full rounded-[18px] bg-white p-2 pb-1.5 text-left ring-1 transition-all duration-200 active:scale-[0.98] dark:bg-[#1C1E23] ${
                  selected
                    ? 'ring-2'
                    : 'ring-black/[0.05] hover:-translate-y-[2px] hover:shadow-[0_6px_18px_rgba(17,24,39,0.07)] hover:ring-black/[0.12] dark:ring-white/[0.08] dark:hover:ring-white/[0.16]'
                }`}
                style={
                  selected
                    ? { ['--tw-ring-color' as string]: meta.accent, boxShadow: `0 6px 18px ${withAlpha(meta.accent, 0.13)}` }
                    : { boxShadow: '0 2px 10px rgba(17,24,39,0.04)' }
                }
              >
                <div className="relative">
                  <ThemeMiniThumb theme={theme} accent={meta.accent} app={app} />
                  {selected && (
                    <span
                      className="absolute right-1.5 top-1.5 flex h-[16px] w-[16px] items-center justify-center rounded-full text-white ring-2 ring-white/95"
                      style={{ backgroundColor: meta.accent, boxShadow: '0 2px 6px rgba(0,0,0,0.20)' }}
                    >
                      <Check className="h-[9px] w-[9px]" strokeWidth={3.4} />
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-center pb-[2px] pt-[7px]">
                  <span
                    className="truncate text-[12.5px] font-semibold leading-none text-black/85 dark:text-white/90"
                    style={selected ? { color: meta.accent } : undefined}
                  >
                    {BUBBLE_THEME_LABEL[theme]}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. 液态玻璃设置（收缩面板）：紧跟液态玻璃主题卡下方，仅选中时出现，无独立界面 */}
      <AnimatePresence initial={false}>
        {liquidOn && (
          <motion.div
            key="liquid-panel"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.26 }}
            className="mt-4"
          >
            <SectionLabel accent={meta.accent}>液态玻璃设置</SectionLabel>
            <div className="mt-2.5">
              <LiquidSkinPanel app={app} onToast={onToast} wxMe={wxMe} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4. 输入框设置（收缩面板）：默认/液态两种主题都可用（用户指定「默认主题也可以添加」）——
          自定义输入框占位灰字 + 输入框上方快捷功能（加号面板保持原样）；信息 App 不接入（用户指定） */}
      {app !== 'sms' && (
        <FadeInSection index={1} className="mt-4" role="region" ariaLabel="输入框设置">
          <SectionLabel accent={meta.accent}>输入框</SectionLabel>
          <div className="mt-2.5">
            <ChatDecorPanel app={app} onToast={onToast} />
          </div>
        </FadeInSection>
      )}

    </>
  );
}

// ================= 自定义 CSS 界面内容（本轮：从主题 Tab 底部独立成顶部第三个 Tab；去掉指路卡只留编辑器） =================

/** 自定义 CSS 内容（全局作用域）：全局 CSS 作用于整台手机（页面/面板/按钮/状态栏，含线下模式）；
 *  编辑器内置示例模板与方案管理（全内联无弹窗）。
 *  第七十六轮（用户指定）：模板按宿主 App 过滤——微信只显示「微信模板 + 手机公共」，
 *  QQ 只显示「QQ模板 + 手机公共」，信息只显示「信息模板 + 手机公共」，不再全部显示。 */
function CssContent({ app, onToast }: { app: BubbleAppId; onToast: (m: string) => void }) {
  const meta = PLATFORM_META[app];
  return (
    <FadeInSection index={0} role="region" ariaLabel="全局自定义 CSS">
      <CustomCssEditor scope="global" templates={globalCssTemplates(app)} accent={meta.accent} onToast={onToast} />
    </FadeInSection>
  );
}

// ================= 气泡界面内容（独立界面：实时预览 + 样式 + 颜色 + 收藏夹） =================

/** 气泡装扮内容（实时预览 + 四格样式 + HSL 颜色 + 收藏夹；气泡独立界面承载） */
function BubbleStyleContent({ app, onToast }: { app: BubbleAppId; onToast: (m: string) => void }) {
  const meta = PLATFORM_META[app];
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const schemes = useSettings((s) => s.bubbleSchemes);
  const setBubbleStyle = useSettings((s) => s.setBubbleStyle);
  const setBubbleSchemes = useSettings((s) => s.setBubbleSchemes);

  /** 自定义颜色编辑目标：both=两侧一起改 / mine=我的 / theirs=TA的（仅颜色分侧；样式对两侧同时生效） */
  const [side, setSide] = useState<'both' | 'mine' | 'theirs'>('mine');
  /** 命名弹窗 */
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  /** 当前 App 的装扮（三 App 隔离：只读写 bubbleStyle[app]） */
  const appStyle: BubbleAppStyle = bubbleStyle[app] ?? { kind: 'default' };
  const kindDisabled = appStyle.kind === 'rainbow';
  /** 当前编辑目标展示色：both 优先取我的（未设时回退 TA 的） */
  const currentColor =
    side === 'both'
      ? appStyle.mineColor ?? appStyle.theirsColor
      : side === 'mine'
        ? appStyle.mineColor
        : appStyle.theirsColor;
  /** 无自定义色时滑条落在 App 原生默认色位置（拖动任意一杆立即生成自定义色落地） */
  const fallbackHex = NATIVE_BUBBLE[app][side === 'theirs' ? 'theirs' : 'mine'];
  const hsl = useMemo(() => hexToHsl(currentColor ?? fallbackHex), [currentColor, fallbackHex]);
  const hasCustomColor = !!(side === 'both' ? appStyle.mineColor || appStyle.theirsColor : currentColor);

  /** 修改当前 App 的装扮（其他 App 原样保留 —— 装扮隔离；只写 kind/颜色，不动主题） */
  const patchAppStyle = (patch: Partial<BubbleAppStyle>) => {
    setBubbleStyle({
      ...bubbleStyle,
      [app]: { ...appStyle, ...patch },
    });
  };

  /** 写入颜色到编辑目标（both = 两侧同步写） */
  const commitColor = (hex: string) => {
    if (side === 'both') patchAppStyle({ mineColor: hex, theirsColor: hex });
    else if (side === 'mine') patchAppStyle({ mineColor: hex });
    else patchAppStyle({ theirsColor: hex });
  };

  /** 滑条拖动：实时合成 hex 写入编辑目标（预览卡/聊天页即时跟随） */
  const commitHsl = (h: number, s: number, l: number) => {
    commitColor(hslToHex(h, s, l));
  };

  const saveScheme = () => {
    const name = nameDraft.trim().slice(0, 16) || `我的气泡 ${schemes.length + 1}`;
    const scheme: BubbleScheme = {
      id: `bs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      app,
      style: { ...appStyle },
      createdAt: Date.now(),
    };
    setBubbleSchemes([scheme, ...schemes]);
    setNaming(false);
    setNameDraft('');
    onToast(`已保存「${name}」`);
  };

  /** 应用方案：只覆盖方案归属的 App（跨 App 应用时提示归属） */
  const applyScheme = (s: BubbleScheme) => {
    setBubbleStyle({
      ...bubbleStyle,
      [s.app]: { ...s.style },
    });
    const target = PLATFORM_META[s.app].name;
    onToast(s.app === app ? `已应用「${s.name}」` : `已将「${s.name}」应用到${target}`);
  };

  const removeScheme = (s: BubbleScheme) => {
    setBubbleSchemes(schemes.filter((x) => x.id !== s.id));
    onToast(`已删除「${s.name}」`);
  };

  /** 当前 App 下与现有装扮完全一致的方案 = 使用中 */
  const activeSchemeId = useMemo(() => {
    const cur = JSON.stringify(appStyle);
    return schemes.find((s) => s.app === app && JSON.stringify(s.style) === cur)?.id ?? null;
  }, [schemes, appStyle]);

  return (
    <div className="relative space-y-6">
      {/* ---------- 1. 实时预览：单层干净浅底幕布（去玻璃相框嵌套） ---------- */}
        <FadeInSection index={0} className="section" role="region" ariaLabel="实时预览">
          <div className="relative overflow-hidden rounded-[20px] ring-1 ring-black/[0.05] dark:ring-white/[0.09]">
            <div className="absolute inset-0 bg-gradient-to-b from-[#F5F7FA] to-[#EAEFF4] dark:from-[#222631] dark:to-[#161A22]" />
            <AuraLayer />
            <div className="relative flex flex-col px-4 py-5">
              {/* 日期胶囊（真聊天页的时间行样式） */}
              <div className="mb-3.5 flex justify-center">
                <span className="rounded-full bg-black/[0.06] px-2.5 py-[3px] text-[10px] font-medium text-black/40 dark:bg-white/[0.08] dark:text-white/40">
                  今天 14:32
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {PREVIEW_MESSAGES.map((m, i) => (
                  <div key={i} className={m.side === 'mine' ? 'self-end' : 'self-start'}>
                    <PreviewRow app={app} cfg={bubbleStyle} side={m.side} index={i} text={m.text} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </FadeInSection>

        {/* ---------- 2. 气泡样式四格（示意胶囊 + 名称，无多余装饰） ---------- */}
        <FadeInSection index={1} className="section" role="region" ariaLabel="气泡样式">
          <SectionLabel accent={meta.accent}>样式</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(Object.keys(BUBBLE_KIND_LABEL) as BubbleStyleKind[]).map((kind) => {
              const selected = appStyle.kind === kind;
              // 每格迷你预览配置：展示「若应用此样式」的效果（样式对两侧同时生效）
              const previewCfg: BubbleStyleConfig = {
                ...bubbleStyle,
                [app]: { kind, mineColor: appStyle.mineColor, theirsColor: appStyle.theirsColor },
              };
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    patchAppStyle({ kind });
                    try {
                      navigator.vibrate?.(6);
                    } catch {
                      /* 震动不可用 */
                    }
                  }}
                  aria-pressed={selected}
                  className={`rounded-[22px] bg-white/60 p-2.5 text-left backdrop-blur-xl ring-1 transition-all active:scale-[0.97] dark:bg-white/[0.06] ${
                    selected
                      ? 'ring-[1.5px]'
                      : 'ring-black/[0.06] hover:ring-black/[0.12] dark:ring-white/[0.10] dark:hover:ring-white/[0.16]'
                  }`}
                  style={
                    selected
                      ? { ['--tw-ring-color' as string]: meta.accent, backgroundColor: withAlpha(meta.accent, 0.05) }
                      : undefined
                  }
                >
                  {/* 示意区：胶囊条 + 左右两颗泡（磨砂/液态需要底光斑才可见） */}
                  <div className="relative mb-2.5 flex h-[54px] items-center justify-between gap-1.5 overflow-hidden rounded-full bg-black/[0.04] px-3 dark:bg-white/[0.05]">
                    <AuraLayer />
                    <PreviewBubble app={app} cfg={previewCfg} side="theirs" index={0} className="!text-[11px]">
                      早呀
                    </PreviewBubble>
                    <PreviewBubble app={app} cfg={previewCfg} side="mine" index={1} className="!text-[11px]">
                      {kind === 'rainbow' ? '变啦' : '你好'}
                    </PreviewBubble>
                  </div>
                  <div className="flex items-center justify-between gap-2 px-1.5 pb-1">
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold leading-tight">{BUBBLE_KIND_LABEL[kind]}</span>
                      <span className="mt-[2px] block truncate text-[11px] leading-tight text-black/40 dark:text-white/40">
                        {KIND_CAPTIONS[kind]}
                      </span>
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0" strokeWidth={2.6} style={{ color: meta.accent }} aria-hidden="true" />}
                  </div>
                </button>
              );
            })}
          </div>
        </FadeInSection>

        {/* ---------- 3. 颜色（分段胶囊 / 滑条 / 色板，同卡三分区） ---------- */}
        <FadeInSection index={2} className="section" role="region" ariaLabel="自定义颜色">
          <SectionLabel accent={meta.accent}>颜色</SectionLabel>
          <div
            className={`mt-3 space-y-4 ${GLASS_CARD} p-4 transition-opacity ${
              kindDisabled ? 'pointer-events-none opacity-40' : ''
            }`}
          >
            {/* 分区一：编辑目标分段胶囊 + 恢复默认 */}
            <div className="flex items-center justify-between gap-2">
              <div className="relative flex rounded-full bg-black/[0.05] p-[3px] dark:bg-white/[0.08]">
                {(['both', 'mine', 'theirs'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSide(k)}
                    aria-pressed={side === k}
                    className={`relative z-10 rounded-full px-3.5 py-[5px] text-[12px] font-semibold transition-colors ${
                      side === k ? 'text-black/80 dark:text-white' : 'text-black/45 dark:text-white/50'
                    }`}
                  >
                    {side === k && (
                      <motion.span
                        layoutId="bubble-color-side-pill"
                        className="absolute inset-0 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)] dark:bg-white/20 dark:ring-1 dark:ring-white/15"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative">{k === 'both' ? '一起' : k === 'mine' ? '我的' : 'TA的'}</span>
                  </button>
                ))}
              </div>
              {hasCustomColor && (
                <button
                  type="button"
                  aria-label="恢复默认色"
                  onClick={() =>
                    patchAppStyle(
                      side === 'both'
                        ? { mineColor: undefined, theirsColor: undefined }
                        : side === 'mine'
                          ? { mineColor: undefined }
                          : { theirsColor: undefined },
                    )
                  }
                  className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-medium text-black/45 transition-colors active:bg-black/[0.06] dark:text-white/50 dark:active:bg-white/10"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  默认
                </button>
              )}
            </div>

            {/* 分区二：当前色（纯色珠 + hex 文字列）+ HSL 三滑条（行内标签） */}
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="h-11 w-11 shrink-0 rounded-full ring-1 ring-black/[0.06] dark:ring-white/15"
                style={{
                  background: currentColor ?? fallbackHex,
                  boxShadow: `inset 0 1px 2px rgba(255,255,255,0.4), 0 2px 6px ${withAlpha(currentColor ?? fallbackHex, 0.3)}`,
                }}
              />
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-tight tabular-nums">
                  {(currentColor ?? fallbackHex).toUpperCase()}
                </p>
                <p className="mt-[2px] text-[11.5px] leading-tight text-black/40 dark:text-white/40">
                  {hasCustomColor ? '自定义颜色' : 'App 默认色'}
                </p>
              </div>
            </div>
            <div className="space-y-2.5">
              {(
                [
                  {
                    label: '色相',
                    value: hsl.h,
                    max: 360,
                    thumbColor: hslToHex(hsl.h, Math.max(hsl.s, 70), 55),
                    track: 'linear-gradient(90deg, #FF0000, #FFFF00 17%, #00FF00 33%, #00FFFF 50%, #0000FF 67%, #FF00FF 83%, #FF0000)',
                    on: (h: number) => commitHsl(h, hsl.s, hsl.l),
                  },
                  {
                    label: '饱和',
                    value: hsl.s,
                    max: 100,
                    thumbColor: currentColor ?? fallbackHex,
                    track: `linear-gradient(90deg, ${hslToHex(hsl.h, 0, hsl.l)}, ${hslToHex(hsl.h, 100, hsl.l)})`,
                    on: (s: number) => commitHsl(hsl.h, s, hsl.l),
                  },
                  {
                    label: '明度',
                    value: hsl.l,
                    max: 100,
                    thumbColor: currentColor ?? fallbackHex,
                    track: `linear-gradient(90deg, #000000, ${hslToHex(hsl.h, hsl.s, 50)} 50%, #FFFFFF)`,
                    on: (l: number) => commitHsl(hsl.h, hsl.s, l),
                  },
                ] as const
              ).map((r) => (
                <div key={r.label} className="flex items-center gap-2.5">
                  <span className="w-[28px] shrink-0 text-right text-[11px] font-medium text-black/35 dark:text-white/40">
                    {r.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <HslSlider
                      label={r.label}
                      value={r.value}
                      max={r.max}
                      thumbColor={r.thumbColor}
                      trackBackground={r.track}
                      onChange={r.on}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* 分区三：预设色板（胶囊色点） */}
            <div className="grid grid-cols-12 gap-[7px]" role="group" aria-label="预设颜色">
              {PRESET_SWATCHES.map((c) => {
                const selected = (currentColor ?? '').toUpperCase() === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={`预设色 ${c}`}
                    aria-pressed={selected}
                    onClick={() => commitColor(c)}
                    className={`flex aspect-square items-center justify-center rounded-full transition-transform active:scale-90 ${
                      selected ? 'ring-2 ring-white/90 dark:ring-white/80' : 'ring-1 ring-black/10 dark:ring-white/15'
                    }`}
                    style={{ backgroundColor: c, ...(selected ? { boxShadow: `0 0 0 2px ${meta.accent}` } : {}) }}
                  >
                    {selected && (
                      <Check
                        className="h-3 w-3"
                        style={{ color: yiqTextOn(c) === '#000000' ? '#111111' : '#FFFFFF' }}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {kindDisabled && (
              <p className="text-[12px] text-black/40 dark:text-white/40">七彩气泡按消息顺序自动循环 9 色，无需选色</p>
            )}
          </div>
        </FadeInSection>

        {/* ---------- 4. 我的气泡（标题行内联「存当前」小按钮，替代全宽大按钮更简约） ---------- */}
        <FadeInSection index={3} className="section" role="region" ariaLabel="我的气泡收藏夹">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel accent={meta.accent}>我的气泡</SectionLabel>
            <button
              type="button"
              onClick={() => {
                setNameDraft('');
                setNaming(true);
              }}
              className="shrink-0 rounded-full px-3 py-[5px] text-[12px] font-semibold active:opacity-60"
              style={{ color: meta.accent, backgroundColor: withAlpha(meta.accent, 0.1) }}
            >
              存当前
            </button>
          </div>
          {schemes.length === 0 ? (
            <div className={`mt-2.5 border border-dashed border-black/[0.14] ${GLASS_CARD} py-6 text-center dark:border-white/[0.14]`}>
              <Palette className="mx-auto mb-1.5 h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
              <p className="text-[13px] text-black/40 dark:text-white/40">还没有收藏的气泡方案</p>
            </div>
          ) : (
            <ul className="mt-2.5 space-y-2.5">
              {schemes.map((s) => {
                const active = s.id === activeSchemeId;
                const sMeta = PLATFORM_META[s.app];
                /** 缩略图预览配置：当前装扮 + 该方案覆盖其归属 App */
                const thumbCfg: BubbleStyleConfig = { ...bubbleStyle, [s.app]: s.style };
                return (
                  <li key={s.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`应用方案 ${s.name}`}
                      onClick={() => applyScheme(s)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          applyScheme(s);
                        }
                      }}
                      className={`flex cursor-pointer items-center gap-3 rounded-full bg-white/60 p-1.5 pr-2 backdrop-blur-xl ring-1 transition-all active:scale-[0.98] dark:bg-white/[0.06] ${
                        active
                          ? 'ring-[1.5px]'
                          : 'ring-black/[0.06] hover:ring-black/[0.12] dark:ring-white/[0.10] dark:hover:ring-white/[0.16]'
                      }`}
                      style={active ? { ['--tw-ring-color' as string]: sMeta.accent } : undefined}
                    >
                      {/* 缩略图：胶囊幕布 + 迷你双泡 */}
                      <div className="relative flex h-[44px] w-[80px] shrink-0 items-center justify-between gap-1 overflow-hidden rounded-full bg-black/[0.04] px-3 dark:bg-white/[0.05]">
                        <AuraLayer />
                        <PreviewBubble app={s.app} cfg={thumbCfg} side="theirs" index={0} className="!text-[10.5px] !px-1.5 !py-[3px]">
                          早
                        </PreviewBubble>
                        <PreviewBubble app={s.app} cfg={thumbCfg} side="mine" index={1} className="!text-[10.5px] !px-1.5 !py-[3px]">
                          呀
                        </PreviewBubble>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[14px] font-semibold leading-tight">{s.name}</p>
                          {active && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold text-white"
                              style={{ backgroundColor: sMeta.accent }}
                            >
                              使用中
                            </span>
                          )}
                        </div>
                        <p className="mt-[2px] truncate text-[11px] text-black/40 dark:text-white/40">
                          {BUBBLE_KIND_LABEL[s.style.kind]}
                          {s.style.mineColor ? ` · 我 ${s.style.mineColor}` : ''}
                          {s.style.theirsColor ? ` · TA ${s.style.theirsColor}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`删除 ${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeScheme(s);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-black/35 transition-colors active:bg-[#FF3B30]/12 active:text-[#FF3B30] dark:text-white/40 dark:active:text-[#FF6B6B]"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </FadeInSection>

        {/* ---------- 命名弹窗（毛玻璃卡 + 胶囊控件） ---------- */}
      <AnimatePresence>
        {naming && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-sm"
            onClick={() => setNaming(false)}
            role="dialog"
            aria-label="命名这套气泡"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="w-full max-w-[300px] rounded-[22px] bg-white/80 p-5 shadow-2xl ring-1 ring-white/70 backdrop-blur-2xl dark:bg-[#1F2126]/85 dark:ring-white/[0.12]"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-center text-[16px] font-bold">给这套气泡起个名字</p>
              {/* 迷你效果预览：胶囊幕布 */}
              <div className="relative mt-3.5 flex items-center justify-center gap-1.5 overflow-hidden rounded-full bg-black/[0.04] px-4 py-2.5 dark:bg-white/[0.05]">
                <AuraLayer />
                <PreviewBubble app={app} cfg={bubbleStyle} side="theirs" index={0}>
                  早安
                </PreviewBubble>
                <PreviewBubble app={app} cfg={bubbleStyle} side="mine" index={1}>
                  你也早安
                </PreviewBubble>
              </div>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveScheme();
                }}
                maxLength={16}
                placeholder="比如：我的天蓝专属"
                aria-label="方案名称"
                className="mt-3.5 w-full rounded-full bg-black/[0.05] px-4 py-2.5 text-center text-[15px] outline-none transition-shadow placeholder:text-black/30 focus:ring-2 dark:bg-white/[0.08] dark:placeholder:text-white/30"
                style={{ ['--tw-ring-color' as string]: meta.accent }}
              />
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setNaming(false)}
                  className="flex-1 rounded-full bg-black/[0.05] py-2.5 text-[15px] font-semibold text-black/60 transition-colors active:bg-black/10 dark:bg-white/[0.08] dark:text-white/70 dark:active:bg-white/15"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveScheme}
                  className="flex-1 rounded-full py-2.5 text-[15px] font-semibold text-white transition-transform active:scale-95"
                  style={{ backgroundColor: meta.accent }}
                >
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>
    </div>
  );
}
