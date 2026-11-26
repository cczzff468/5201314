'use client';

/**
 * Cove 开屏动画（第三十四轮起多主题可选——第三十九轮：机主删除星空对话后剩三主题：
 * 星空月夜 / 雾中远山 / 雨落成诗）。
 *
 * 第三十四轮按机主两张参考图重做两枚：
 * - moon（雨落成诗·重做）：蓝灰雨窗玻璃渐变 + 散落水珠（呼吸/下滑两种）+ 雨丝
 *   斜落 + 中央涟漪扩散 + 四处散落的手写诗行 + 手写体 cove 花体字 +
 *   左上「LET THE WORLD WAIT. / 外面的世界，晚一点再说。」——机主参考图
 *   （雨窗短视频风格）逐元素复刻；文字白色半透明浮在蓝灰玻璃上；
 *
 * 沿用主题：
 * - star（默认·星空月夜）：深夜炭蓝黑渐变 + 26 颗星点闪烁 + 周期流星 + 奶白新月；
 * - mist（雾中远山）：灰白雾面渐变 + 噪点 + 双雾团缓漂 + 三层远山剪影极慢横漂。
 *
 * 共用骨架：底部 LOCAL 实时时钟 + ENTER 呼吸圆环 + 微光进度条 + 右侧竖排微字；
 * star/mist 走居中文字组（EN 小字→衬线 wordmark→细分隔线→中文诗行），
 * moon 有自己的主题布局（雨窗散排）。
 * 2.6s 后整层淡出（0.6s + 轻放大），完全卸载；点按任意处立即进入。
 *
 * 主题持久化三写（第三十五轮）：localStorage('cove-splash-theme') 同步可读
 * （水合后 useLayoutEffect 校准主题，无闪无 hydration mismatch）+ cookie（服务端可读：
 * page.tsx 把 initialTheme 烤进 SSR HTML——修「冷启动先显示另一个开屏几秒后才变
 * 所选的」，APK WebView 水合前的绘制即正确主题）+ settings store（设置页同源）。
 * 挂载在 page.tsx 顶层（fixed 全屏 z-[9999]），每会话只播一次；
 * forceTheme：设置页「立马生效」预览——选完即整屏播放一遍所选主题（组件自卸载）。
 * 纯 CSS 动画（无 JS 定时器驱动动画，只有退场 setTimeout，卸载时清理）。
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import {
  readSplashTheme,
  writeSplashThemeCookie,
  type CoveSplashTheme,
} from '@/lib/ios/splash-theme';

/** 开屏节奏：2.6s 起淡出（0.6s）→ 3.2s 完全卸载 */
const HOLD_MS = 2600;
const FADE_MS = 600;

/** 极淡噪点颗粒（SVG feTurbulence data URI，覆盖底做雾面；mist 主题用） */
const GRAIN_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

/** 手写体（moon 雨窗主题的花体 cove + 散落诗行；zhimangxing 分包按 unicode-range 惰性加载） */
const HAND = "'Zhi Mang Xing', 'Kaiti SC', 'STKaiti', KaiTi, serif";

/** 三主题文案与配色（EN 小字 / 中文诗行 / 文字色系；第三十九轮删 chat） */
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
    en: 'Let the world wait',
    cn: '外面的世界，晚一点再说。',
    ink: '#FBFCFE',
    sub: 'rgba(247,250,253,0.82)',
    side: 'Cove · Rainy Window',
    bar: 'rgba(251,252,254,0.18)',
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

/** 雨窗水珠固定位置（%·px·run=下滑雨珠）：[left%, top%, size px, run] */
const RAIN_DROPS: Array<[number, number, number, boolean]> = [
  [7, 15, 9, false], [16, 9, 5, false], [23, 26, 12, true], [31, 13, 6, false],
  [38, 31, 8, false], [45, 8, 10, true], [52, 24, 5, false], [59, 15, 13, true],
  [66, 28, 7, false], [73, 10, 9, false], [80, 23, 6, true], [87, 16, 11, false],
  [93, 30, 5, false], [12, 42, 7, false], [27, 48, 10, true], [41, 44, 6, false],
  [55, 40, 8, false], [70, 47, 5, true], [84, 55, 9, false], [18, 62, 7, false],
  [33, 68, 11, true], [50, 63, 6, false], [64, 72, 8, false], [78, 66, 10, true],
  [90, 74, 6, false], [25, 82, 9, false], [42, 86, 7, true], [60, 84, 5, false],
];

/** 雨丝（斜落细光痕）：[left%, 起始 delay ms, 周期 ms, 长度 px] */
const RAIN_STREAKS: Array<[number, number, number, number]> = [
  [4, 0, 1500, 64], [14, 500, 1900, 48], [26, 300, 1600, 72],
  [37, 900, 2100, 56], [49, 200, 1700, 64], [61, 700, 2000, 44],
  [72, 400, 1800, 68], [84, 1000, 2200, 52], [94, 600, 1600, 60],
];

/** 雨窗散落诗行（%定位·文案两行·上浮 delay）：机主参考图上的诗逐条复刻 */
const RAIN_POEMS: Array<{ x: number; y: number; delay: number; lines: [string, string] }> = [
  { x: 8, y: 24, delay: 620, lines: ['灰的雨，灰的伞，', '水珠糊满一整块屏。'] },
  { x: 63, y: 30, delay: 840, lines: ['小名字里明明是雨停了，', '雨还养在屏幕上。'] },
  { x: 10, y: 50, delay: 1060, lines: ['在地里埋了一颗种子，', '名字叫等的人会回消息。'] },
  { x: 60, y: 57, delay: 1280, lines: ['雨打在檐上会变成声音，', '下雨的日子屋顶一直在。'] },
];

function localTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function BootSplash({
  /** 第三十五轮：SSR 首屏烤入的主题（page.tsx 服务端读 cookie）——修「刚打开先
   *  显示另一个开屏、几秒后才变所选」：水合前 WebView 绘制的 SSR HTML 就是它；
   *  与 localStorage 持久值同源（选择时双写），undefined = 无 cookie 回默认 star */
  initialTheme,
  /** 设置页「立马生效」预览：直接锁定指定主题播放 */
  forceTheme,
}: {
  initialTheme?: CoveSplashTheme;
  forceTheme?: CoveSplashTheme;
}) {
  const [phase, setPhase] = useState<'hold' | 'fade' | 'gone'>('hold');
  const [clock, setClock] = useState('');
  // 初始主题优先级：forceTheme（设置预览）＞ initialTheme（SSR cookie 烤入，与
  // localStorage 同源）＞ star（默认）。SSR 与 Client 首帧一致（cookie 服务端/
  // 客户端读到的同值），无 hydration mismatch；
  const [theme, setTheme] = useState<CoveSplashTheme>(forceTheme ?? initialTheme ?? 'star');

  useLayoutEffect(() => {
    // 水合后按 localStorage（最权威的同步源）校准：cookie 缺失/过期/被清时以本地为准，
    // 并自愈补写 cookie（老用户升级首启、清 cookie 重选等场景），下次冷启动 SSR 即正确
    const local = readSplashTheme();
    setTheme(forceTheme ?? local);
    writeSplashThemeCookie(local);
  }, [forceTheme]);

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

      {/* ---------- 主题 C：雨落成诗（第三十四轮重做·机主雨窗参考图） ---------- */}
      {theme === 'moon' && (
        <>
          {/* 蓝灰雨窗玻璃渐变底（模糊的雨天窗玻璃观感） */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(166deg, #C4CEDA 0%, #A9B6C5 34%, #93A2B4 62%, #7E8DA1 100%)' }}
          />
          {/* 玻璃深浅雾团（两层大 blur 缓漂，模拟窗上水汽/景深） */}
          <div
            className="absolute left-[-20%] top-[-16%] h-[56%] w-[86%] rounded-full opacity-60 blur-[70px]"
            style={{
              background: 'radial-gradient(closest-side, rgba(233,240,248,0.75) 0%, rgba(210,220,232,0.35) 55%, rgba(210,220,232,0) 100%)',
              animation: 'cove2-mist-a 10s ease-in-out infinite',
            }}
          />
          <div
            className="absolute bottom-[-20%] right-[-22%] h-[54%] w-[80%] rounded-full opacity-50 blur-[70px]"
            style={{
              background: 'radial-gradient(closest-side, rgba(96,110,130,0.5) 0%, rgba(120,133,152,0.25) 55%, rgba(120,133,152,0) 100%)',
              animation: 'cove2-mist-b 12s ease-in-out infinite',
            }}
          />
          {/* 雨丝：斜落细光痕（各自周期/延迟） */}
          {RAIN_STREAKS.map(([l, delay, dur, len], i) => (
            <span
              key={i}
              aria-hidden="true"
              className="absolute w-[1.5px] rounded-full"
              style={{
                left: `${l}%`,
                top: `-${len}px`,
                height: len,
                background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 55%, rgba(255,255,255,0) 100%)',
                transform: 'rotate(9deg)',
                animation: `cove4-fall ${dur}ms linear ${delay}ms infinite`,
              }}
            />
          ))}
          {/* 散落水珠：静珠呼吸 + 滑珠缓降（高光小圆） */}
          {RAIN_DROPS.map(([l, t, s, run], i) => (
            <span
              key={i}
              aria-hidden="true"
              className="absolute rounded-full"
              style={{
                left: `${l}%`,
                top: `${t}%`,
                width: s,
                height: s,
                background: 'radial-gradient(circle at 34% 28%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.28) 48%, rgba(105,122,142,0.16) 100%)',
                boxShadow: 'inset -0.5px -1px 2px rgba(70,86,106,0.22)',
                animation: run
                  ? `cove4-drop-run ${12000 + (i % 5) * 2600}ms ease-in-out ${i * 620}ms infinite`
                  : `cove4-breathe ${3400 + (i % 6) * 500}ms ease-in-out ${(i % 4) * 300}ms infinite`,
              }}
            />
          ))}
          {/* 中央涟漪：三圈错相扩散（衬在手写 cove 后面） */}
          <div aria-hidden="true" className="absolute left-1/2 top-[44%] h-[120px] w-[120px] -translate-x-1/2 -translate-y-1/2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="absolute inset-0 rounded-full border"
                style={{
                  borderColor: 'rgba(247,250,253,0.55)',
                  animation: `cove4-ripple 3.6s cubic-bezier(0.2,0.6,0.4,1) ${i * 1200}ms infinite`,
                }}
              />
            ))}
          </div>
          {/* 左上主文案：EN 宽字距小字 + 中文一行 */}
          <div className="absolute left-[26px] top-[8%] max-w-[70%]" style={rise(200)}>
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.42em]"
              style={{ color: 'rgba(251,252,254,0.92)' }}
            >
              Let the world wait
            </p>
            <p
              className="mt-[7px] text-[14px] leading-relaxed tracking-[0.16em]"
              style={{ color: 'rgba(251,252,254,0.9)', fontFamily: HAND, textShadow: '0 1px 3px rgba(58,72,92,0.28)' }}
            >
              外面的世界，晚一点再说。
            </p>
          </div>
          {/* 散落诗行（手写体·四处·错峰上浮） */}
          {RAIN_POEMS.map((p, i) => (
            <p
              key={i}
              className="absolute max-w-[46%] text-[12.5px] leading-[1.9] tracking-[0.1em]"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                fontFamily: HAND,
                color: 'rgba(248,251,253,0.85)',
                textShadow: '0 1px 3px rgba(58,72,92,0.3)',
                ...rise(p.delay),
              }}
            >
              {p.lines[0]}
              <br />
              {p.lines[1]}
            </p>
          ))}
          {/* 中央手写体 cove 花体字（白字蓝晕·缓浮） */}
          <div
            className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2"
            style={{ animation: 'cove3-float 7s ease-in-out infinite' }}
          >
            <span
              className="block text-[64px] leading-none"
              style={{
                fontFamily: HAND,
                color: '#FBFCFE',
                textShadow: '0 2px 14px rgba(62,78,100,0.35), 0 0 2px rgba(251,252,254,0.6)',
                ...rise(420),
                animation: `cove2-rise 900ms cubic-bezier(0.22,0.9,0.3,1) 420ms both, cove3-float 7s ease-in-out 900ms infinite`,
              }}
            >
              cove
            </span>
          </div>
        </>
      )}

      {/* ---------- 共用文字组（star/mist：居中版式；moon 自有主题布局） ---------- */}
      {(theme === 'star' || theme === 'mist') && (
        <>
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
        </>
      )}
      {/* moon：右侧竖排微字 */}
      {theme === 'moon' && (
        <span
          className="absolute right-[16px] top-1/2 origin-center translate-y-[-50%] rotate-90 text-[8.5px] font-medium uppercase tracking-[0.5em]"
          style={{ ...rise(1100), color: meta.sub, opacity: 0.75 }}
        >
          {meta.side}
        </span>
      )}

      {/* 底部左：LOCAL 实时时钟 */}
      <div
        className="absolute bottom-[30px] left-[26px] flex items-baseline gap-[7px] font-serif tabular-nums"
        style={{ ...rise(980), color: theme === 'moon' ? meta.ink : meta.sub }}
      >
        <span className="text-[8.5px] uppercase tracking-[0.3em]">Local</span>
        <span className="text-[15px] font-medium tracking-[0.12em]">{clock || '--:--'}</span>
      </div>

      {/* 底部右：ENTER 呼吸圆环按钮（自动进入、点按跳过） */}
      <div className="absolute bottom-[26px] right-[26px]" style={rise(1080)}>
        <span className="relative grid h-[52px] w-[52px] place-items-center rounded-full">
          <span
            className="absolute inset-0 rounded-full border"
            style={{ borderColor: theme === 'moon' ? meta.sub : meta.sub, opacity: 0.5, animation: 'cove2-pulse 2.2s cubic-bezier(0.4,0,0.6,1) infinite' }}
          />
          <span className="absolute inset-0 rounded-full border" style={{ borderColor: theme === 'moon' ? meta.sub : meta.sub, opacity: 0.7 }} />
          <span
            className="font-serif text-[9.5px] font-medium uppercase tracking-[0.24em]"
            style={{ color: theme === 'moon' ? meta.ink : meta.sub }}
          >
            Enter
          </span>
        </span>
      </div>

      {/* 底部中央：微光进度条 */}
      <div className="absolute bottom-[34px] left-1/2 h-[2px] w-[92px] -translate-x-1/2 overflow-hidden rounded-full" style={{ ...rise(880), background: meta.bar }}>
        <span
          className="absolute inset-y-0 left-0 w-[36%] rounded-full"
          style={{
            background:
              theme === 'moon'
                ? 'linear-gradient(90deg, rgba(251,252,254,0) 0%, rgba(251,252,254,0.8) 45%, rgba(251,252,254,1) 60%, rgba(251,252,254,0) 100%)'
                : `linear-gradient(90deg, ${meta.sub}00 0%, ${meta.sub}CC 45%, ${meta.sub} 60%, ${meta.sub}00 100%)`,
            animation: 'cove2-sweep 1.35s cubic-bezier(0.4,0,0.6,1) infinite',
          }}
        />
      </div>
    </div>
  );
}
