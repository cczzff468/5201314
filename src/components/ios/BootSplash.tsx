'use client';

/**
 * Cove 开屏动画（第三十三轮：三主题可选——星空月夜 / 雾中远山 / 静月港湾）。
 *
 * 机主反馈「灰白雾面渐变底变成星空月球什么的，做三个吧，可以让他选择」：
 * - star（默认·星空月夜）：深夜炭蓝黑渐变 + 26 颗星点闪烁（位置固定数组防 hydration
 *   浮点差）+ 周期流星 + 奶白新月呼吸光晕 + 缓浮，EN/CN 衬线诗行柔白；
 * - mist（雾中远山）：灰白雾面渐变 + 噪点 + 双雾团缓漂 + 三层远山剪影极慢横漂
 *   （呼应 App 图标 2 号），文字深灰；
 * - moon（静月港湾）：上夜空下静水 + 新月 + 水面月影光柱横纹微闪 + 地平线微波
 *   （呼应 App 图标 3 号），文字柔白。
 *
 * 共用骨架：顶部 EN 宽字距小字 → 中央衬线 wordmark「Cove」→ 细分隔线 → 中文诗行
 * （三主题各一句）→ 右侧竖排微字 → 底部 LOCAL 实时时钟 + ENTER 呼吸圆环 + 微光进度条；
 * 2.6s 后整层淡出（0.6s + 轻放大），完全卸载；点按任意处立即进入。
 *
 * 主题持久化：localStorage('cove-splash-theme') 同步可读（首帧 useLayoutEffect 换主题，
 * 首次绘制即正确、无闪无 hydration mismatch）+ settings store（设置页选择器同源）。
 * 挂载在 page.tsx 顶层（fixed 全屏 z-[9999]），每会话只播一次。
 * 纯 CSS 动画（无 JS 定时器驱动动画，只有退场 setTimeout，卸载时清理）。
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { readSplashTheme, type CoveSplashTheme } from '@/lib/ios/splash-theme';

/** 开屏节奏：2.6s 起淡出（0.6s）→ 3.2s 完全卸载 */
const HOLD_MS = 2600;
const FADE_MS = 600;

/** 极淡噪点颗粒（SVG feTurbulence data URI，覆盖底做雾面；mist 主题用） */
const GRAIN_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

/** 三主题文案与配色（EN 小字 / 中文诗行 / 文字色系） */
const THEME_META: Record<
  CoveSplashTheme,
  { en: string; cn: string; ink: string; sub: string; side: string; bar: string }
> = {
  star: {
    en: 'Stars keep the night',
    cn: '长夜，自有一颗安静的月亮。',
    ink: '#E9E9E4',
    sub: '#C7C7C1',
    side: 'Cove · Starry Night',
    bar: 'rgba(233,233,228,0.10)',
  },
  mist: {
    en: 'Let the world wait',
    cn: '喧嚣之外，静水一湾。',
    ink: '#3A3A38',
    sub: '#6E6E6A',
    side: 'Cove · Quiet Harbor',
    bar: 'rgba(0,0,0,0.07)',
  },
  moon: {
    en: 'Moonlight on still water',
    cn: '一轮月，泊进安静的港湾。',
    ink: '#EDEDE8',
    sub: '#C4C4BE',
    side: 'Cove · Moon Harbor',
    bar: 'rgba(237,237,232,0.12)',
  },
};

/** 星点固定位置数组（%·确定性：SSR/Client 逐字节一致，防 hydration 浮点差） */
const STARS: Array<[number, number, number, number]> = [
  // [left%, top%, size px, twinkle 周期 ms]
  [6, 12, 2, 2600], [13, 7, 1.5, 3400], [19, 19, 1.2, 4200], [27, 9, 2, 3000],
  [33, 26, 1.4, 3800], [41, 5, 1.8, 4600], [47, 16, 1.1, 3200], [55, 11, 2.2, 2800],
  [62, 6, 1.5, 4000], [68, 21, 1.3, 3600], [74, 13, 1.8, 3000], [81, 8, 1.2, 4400],
  [87, 24, 1.6, 3200], [92, 17, 1.3, 3800], [10, 34, 1.2, 4800], [24, 42, 1.5, 3400],
  [38, 37, 1.1, 4200], [52, 33, 1.7, 2800], [66, 39, 1.2, 4000], [79, 35, 1.4, 3200],
  [90, 44, 1.1, 4600], [8, 55, 1.3, 3600], [30, 60, 1.1, 4400], [58, 52, 1.4, 3000],
  [84, 58, 1.2, 3800], [16, 70, 1.1, 4200],
];

function localTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function BootSplash() {
  const [phase, setPhase] = useState<'hold' | 'fade' | 'gone'>('hold');
  const [clock, setClock] = useState('');
  // 首帧恒 star（SSR/Client 一致防 hydration mismatch）；useLayoutEffect 在浏览器
  // 首次绘制前同步换成本地持久化主题——用户看到的第一帧已是所选主题，零闪烁。
  const [theme, setTheme] = useState<CoveSplashTheme>('star');

  useLayoutEffect(() => {
    setTheme(readSplashTheme());
  }, []);

  useEffect(() => {
    setClock(localTime());
    const t1 = window.setTimeout(() => setPhase('fade'), HOLD_MS);
    const t2 = window.setTimeout(() => setPhase('gone'), HOLD_MS + FADE_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  /** 点按任意处：立即进入淡出（幂等） */
  const skip = () => setPhase((p) => (p === 'hold' ? 'fade' : p));

  if (phase === 'gone') return null;

  const meta = THEME_META[theme];
  const rise = (delay: number): React.CSSProperties => ({
    animation: `cove2-rise 900ms cubic-bezier(0.22,0.9,0.3,1) ${delay}ms both`,
  });

  return (
    <div
      aria-hidden="true"
      data-testid="cove-boot-splash"
      onClick={skip}
      className="fixed inset-0 z-[9999] select-none overflow-hidden"
      style={
        phase === 'fade'
          ? { animation: `cove2-exit ${FADE_MS}ms cubic-bezier(0.4,0,0.2,1) forwards`, cursor: 'pointer' }
          : { cursor: 'pointer' }
      }
    >
      {/* ---------- 主题 A：星空月夜（默认） ---------- */}
      {theme === 'star' && (
        <>
          {/* 深夜炭色渐变底（去饱和夜空，非亮蓝） */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(172deg, #15161B 0%, #1C1E26 46%, #23252F 78%, #1A1B22 100%)' }}
          />
          {/* 地平线微光（底部极淡的夜雾亮带） */}
          <div
            className="absolute inset-x-0 bottom-0 h-[26%]"
            style={{ background: 'linear-gradient(to top, rgba(120,124,138,0.16) 0%, rgba(120,124,138,0) 100%)' }}
          />
          {/* 星点：固定位置闪烁 */}
          {STARS.map(([l, t, s, dur], i) => (
            <span
              key={i}
              aria-hidden="true"
              className="absolute rounded-full bg-[#E9E9E4]"
              style={{
                left: `${l}%`,
                top: `${t}%`,
                width: s,
                height: s,
                animation: `cove3-twinkle ${dur}ms ease-in-out ${(i % 7) * 240}ms infinite`,
              }}
            />
          ))}
          {/* 周期流星（细长渐隐光痕） */}
          <span
            aria-hidden="true"
            className="absolute left-[16%] top-[14%] block h-[1.5px] w-[76px] origin-left rounded-full"
            style={{
              background: 'linear-gradient(90deg, rgba(233,233,228,0) 0%, rgba(233,233,228,0.9) 100%)',
              animation: 'cove3-shoot 3.4s ease-out 700ms infinite',
            }}
          />
          {/* 新月：奶白渐亏月 + 呼吸光晕 + 缓浮（中央偏上，衬线下方） */}
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-[19%] h-[56px] w-[56px] -translate-x-1/2"
            style={{ animation: 'cove3-float 6.5s ease-in-out infinite' }}
          >
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle at 38% 34%, #F4F4EF 0%, #E4E4DE 62%, #D4D4CE 100%)',
                animation: 'cove3-moon-glow 4.2s ease-in-out infinite',
              }}
            />
            {/* 渐亏缺口：偏移深色圆叠出月牙 */}
            <span
              className="absolute rounded-full"
              style={{
                left: 17, top: -6, width: 52, height: 52,
                background: 'radial-gradient(circle at 60% 60%, #23252E 0%, #23252E 55%, rgba(35,37,46,0.92) 100%)',
              }}
            />
          </div>
        </>
      )}

      {/* ---------- 主题 B：雾中远山 ---------- */}
      {theme === 'mist' && (
        <>
          {/* 灰白渐变底 + 噪点雾面 */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(168deg, #F6F6F4 0%, #EDEDEB 52%, #E7E7E4 100%)' }}
          />
          <div
            className="absolute inset-0 opacity-[0.16] mix-blend-multiply"
            style={{ backgroundImage: GRAIN_URI, backgroundSize: '160px 160px' }}
          />
          {/* 双雾团缓漂 */}
          <div
            className="absolute left-[-22%] top-[-14%] h-[58%] w-[88%] rounded-full opacity-80 blur-[80px]"
            style={{
              background: 'radial-gradient(closest-side, rgba(255,255,255,0.9) 0%, rgba(241,241,238,0.5) 55%, rgba(237,237,234,0) 100%)',
              animation: 'cove2-mist-a 9s ease-in-out infinite',
            }}
          />
          <div
            className="absolute bottom-[-18%] right-[-24%] h-[54%] w-[82%] rounded-full opacity-70 blur-[80px]"
            style={{
              background: 'radial-gradient(closest-side, rgba(222,222,218,0.55) 0%, rgba(228,228,224,0.3) 55%, rgba(237,237,234,0) 100%)',
              animation: 'cove2-mist-b 11s ease-in-out infinite',
            }}
          />
          {/* 三层远山剪影（极慢横漂；呼应 App 图标 2 号雾中远山） */}
          <svg
            viewBox="0 0 390 200"
            preserveAspectRatio="none"
            className="absolute inset-x-[-6%] bottom-0 h-[30%] w-[112%]"
            style={{ animation: 'cove3-mtn-a 26s ease-in-out infinite' }}
            aria-hidden="true"
          >
            <path d="M0 200 L0 96 Q 46 34 92 78 Q 130 112 168 66 Q 214 8 262 70 Q 312 130 348 92 Q 372 68 390 88 L390 200 Z" fill="#D8D8D3" opacity="0.72" />
          </svg>
          <svg
            viewBox="0 0 390 200"
            preserveAspectRatio="none"
            className="absolute inset-x-[-6%] bottom-0 h-[24%] w-[112%]"
            style={{ animation: 'cove3-mtn-b 32s ease-in-out infinite' }}
            aria-hidden="true"
          >
            <path d="M0 200 L0 128 Q 40 74 88 108 Q 136 142 178 96 Q 224 46 276 104 Q 324 156 360 118 Q 378 100 390 112 L390 200 Z" fill="#AFAFaa" opacity="0.55" />
          </svg>
          <svg
            viewBox="0 0 390 200"
            preserveAspectRatio="none"
            className="absolute inset-x-[-6%] bottom-0 h-[17%] w-[112%]"
            style={{ animation: 'cove3-mtn-c 38s ease-in-out infinite' }}
            aria-hidden="true"
          >
            <path d="M0 200 L0 152 Q 52 108 104 138 Q 156 166 210 128 Q 262 92 316 136 Q 356 168 390 142 L390 200 Z" fill="#8A8A86" opacity="0.5" />
          </svg>
          {/* 淡日盘（远山后一抹浅色圆） */}
          <span
            aria-hidden="true"
            className="absolute right-[24%] top-[16%] h-[42px] w-[42px] rounded-full opacity-70 blur-[1px]"
            style={{ background: 'radial-gradient(circle, rgba(255,255,252,0.95) 0%, rgba(236,236,231,0.55) 70%, rgba(236,236,231,0) 100%)' }}
          />
        </>
      )}

      {/* ---------- 主题 C：静月港湾 ---------- */}
      {theme === 'moon' && (
        <>
          {/* 上夜空 + 下静水（地平线在 64%） */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(178deg, #191A20 0%, #20222B 62%, #23252E 64%, #131419 100%)' }}
          />
          {/* 地平线光缝 */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-[63.6%] h-[1.5px]"
            style={{ background: 'linear-gradient(90deg, rgba(226,226,220,0) 0%, rgba(226,226,220,0.4) 50%, rgba(226,226,220,0) 100%)' }}
          />
          {/* 新月：中轴偏上（与水面月影光柱同轴） */}
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-[15%] h-[52px] w-[52px] -translate-x-1/2"
            style={{ animation: 'cove3-float 7.5s ease-in-out infinite' }}
          >
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle at 40% 36%, #F2F2ED 0%, #E2E2DC 60%, #D0D0CA 100%)',
                animation: 'cove3-moon-glow 4.6s ease-in-out infinite',
              }}
            />
            <span
              className="absolute rounded-full"
              style={{
                left: 15, top: -6, width: 49, height: 49,
                background: 'radial-gradient(circle at 60% 60%, #20222B 0%, #20222B 55%, rgba(32,34,43,0.94) 100%)',
              }}
            />
          </div>
          {/* 水面月影：光柱横纹微闪（自上而下渐窄渐淡） */}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span
              key={i}
              aria-hidden="true"
              className="absolute left-1/2 block h-[2px] rounded-full bg-[#E6E6E0]"
              style={{
                top: `calc(64% + ${14 + i * 24}px)`,
                width: 76 - i * 8,
                transform: 'translateX(-50%)',
                opacity: 0.5 - i * 0.055,
                animation: `cove3-shimmer ${2600 + i * 320}ms ease-in-out ${i * 200}ms infinite`,
              }}
            />
          ))}
          {/* 地平线微波（两道极慢平移的细纹） */}
          <span
            aria-hidden="true"
            className="absolute left-[12%] top-[68%] block h-[1px] w-[120px] bg-[#8E8E8A]/40"
            style={{ animation: 'cove3-wave 5.2s ease-in-out infinite' }}
          />
          <span
            aria-hidden="true"
            className="absolute right-[14%] top-[78%] block h-[1px] w-[96px] bg-[#8E8E8A]/30"
            style={{ animation: 'cove3-wave 6.4s ease-in-out 600ms infinite' }}
          />
        </>
      )}

      {/* ---------- 共用文字组（三主题配色随 THEME_META） ---------- */}
      {/* 右侧竖排微字 */}
      <span
        className="absolute right-[16px] top-1/2 origin-center translate-y-[-50%] rotate-90 text-[8.5px] font-medium uppercase tracking-[0.5em]"
        style={{ ...rise(1100), color: meta.sub, opacity: 0.75 }}
      >
        {meta.side}
      </span>

      {/* 中央文字组：偏上（夜空主题把中央让给月/星） */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[13px] pt-[8%]">
        {/* 顶部英文宽字距小字 */}
        <p
          className="font-serif text-[10.5px] font-medium uppercase tracking-[0.52em]"
          style={{ ...rise(180), color: meta.sub, textIndent: '0.52em' }}
        >
          {meta.en}
        </p>
        {/* wordmark：衬线大字 */}
        <h1
          className="font-serif text-[46px] font-medium leading-none tracking-[0.2em]"
          style={{ ...rise(400), color: meta.ink, textIndent: '0.2em' }}
        >
          Cove
        </h1>
        {/* 细分隔线 */}
        <span className="block h-[0.5px] w-[64px]" style={{ ...rise(560), background: meta.sub, opacity: 0.55 }} />
        {/* 中文诗行（宽字距） */}
        <p
          className="font-serif text-[12.5px] tracking-[0.34em]"
          style={{ ...rise(680), color: meta.sub, textIndent: '0.34em' }}
        >
          {meta.cn}
        </p>
      </div>

      {/* 底部左：LOCAL 实时时钟 */}
      <div
        className="absolute bottom-[30px] left-[26px] flex items-baseline gap-[7px] font-serif tabular-nums"
        style={{ ...rise(980), color: meta.sub }}
      >
        <span className="text-[8.5px] uppercase tracking-[0.3em]">Local</span>
        <span className="text-[15px] font-medium tracking-[0.12em]">{clock || '--:--'}</span>
      </div>

      {/* 底部右：ENTER 呼吸圆环按钮（自动进入、点按跳过） */}
      <div className="absolute bottom-[26px] right-[26px]" style={rise(1080)}>
        <span className="relative grid h-[52px] w-[52px] place-items-center rounded-full">
          <span
            className="absolute inset-0 rounded-full border"
            style={{ borderColor: meta.sub, opacity: 0.5, animation: 'cove2-pulse 2.2s cubic-bezier(0.4,0,0.6,1) infinite' }}
          />
          <span className="absolute inset-0 rounded-full border" style={{ borderColor: meta.sub, opacity: 0.7 }} />
          <span className="font-serif text-[9.5px] font-medium uppercase tracking-[0.24em]" style={{ color: meta.sub }}>
            Enter
          </span>
        </span>
      </div>

      {/* 底部中央：微光进度条 */}
      <div className="absolute bottom-[34px] left-1/2 h-[2px] w-[92px] -translate-x-1/2 overflow-hidden rounded-full" style={{ ...rise(880), background: meta.bar }}>
        <span
          className="absolute inset-y-0 left-0 w-[36%] rounded-full"
          style={{
            background: `linear-gradient(90deg, ${meta.sub}00 0%, ${meta.sub}CC 45%, ${meta.sub} 60%, ${meta.sub}00 100%)`,
            animation: 'cove2-sweep 1.35s cubic-bezier(0.4,0,0.6,1) infinite',
          }}
        />
      </div>
    </div>
  );
}
