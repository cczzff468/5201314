'use client';

/**
 * Cove 开屏动画（第三十二轮：删除重建——借鉴机主三张参考图）。
 *
 * 参考意象转译（星盘罗盘 / 雨窗水纹 Alcove / 魔法阵 → 灰白韩系）：
 *  - 冷灰白渐变底 + 极淡噪点颗粒（雾面质感）；
 *  - 两团浅灰「雾」缓慢漂移（雨窗氛围）；
 *  - 中央细线同心轨道环 ×3 缓慢正/反向旋转（星盘+魔法阵的轨道意象，
 *    带刻度短线，低调到「几乎看不见但存在」）；
 *  - 中央周期扩散的涟漪细环（水面涟漪）；
 *  - 顶部宽字距英文小字「LET THE WORLD WAIT.」→ 中央衬线 wordmark「Cove」
 *    → 下方宽字距中文诗行「喧嚣之外，静水一湾。」（参考图 EN+CN 混排）；
 *  - 底部左侧 LOCAL 实时时钟（星盘图 LOCAL STAR TIME 的转译）、
 *    右侧 ENTER 呼吸圆环按钮（参考图右下 ENTER 意象）；
 *  - 2.6s 后整层淡出（0.6s + 轻放大），完全卸载；点按任意处立即进入。
 *
 * 挂载在 page.tsx 顶层（fixed 全屏 z-[9999]），每会话只播一次。
 * 纯 CSS 动画（无 JS 定时器驱动动画，只有一个退场 setTimeout，卸载时清理）。
 */
import { useEffect, useState } from 'react';

/** 开屏节奏：2.6s 起淡出（0.6s）→ 3.2s 完全卸载 */
const HOLD_MS = 2600;
const FADE_MS = 600;

/** 极淡噪点颗粒（SVG feTurbulence data URI，覆盖灰白底做雾面） */
const GRAIN_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

function localTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function BootSplash() {
  const [phase, setPhase] = useState<'hold' | 'fade' | 'gone'>('hold');
  const [clock, setClock] = useState('');

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
      {/* 灰白渐变底 */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(168deg, #F6F6F4 0%, #EDEDEB 52%, #E7E7E4 100%)' }}
      />
      {/* 雾面噪点颗粒（极淡） */}
      <div
        className="absolute inset-0 opacity-[0.16] mix-blend-multiply"
        style={{ backgroundImage: GRAIN_URI, backgroundSize: '160px 160px' }}
      />
      {/* 两团浅灰雾缓慢漂移（雨窗氛围） */}
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

      {/* 中央轨道环组（星盘/魔法阵意象：细线+刻度，正反旋转） */}
      <div className="absolute inset-0 grid place-items-center">
        <svg
          viewBox="0 0 400 400"
          className="h-[300px] w-[300px] opacity-[0.5]"
          style={{ animation: 'cove2-ring-a 900ms ease-out 60ms both, cove2-spin 46s linear infinite 960ms' }}
          aria-hidden="true"
        >
          <circle cx="200" cy="200" r="178" fill="none" stroke="#8A8A86" strokeWidth="0.7" strokeDasharray="1 5" />
          {/* 刻度坐标全部 toFixed(2) 归一：防 Node/浏览器浮点尾数差异引发 hydration mismatch */}
          {Array.from({ length: 36 }).map((_, i) => {
            const a = (i * Math.PI) / 18;
            const x1 = +(200 + Math.cos(a) * 166).toFixed(2);
            const y1 = +(200 + Math.sin(a) * 166).toFixed(2);
            const x2 = +(200 + Math.cos(a) * 172).toFixed(2);
            const y2 = +(200 + Math.sin(a) * 172).toFixed(2);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#8A8A86" strokeWidth={i % 9 === 0 ? 1.1 : 0.6} />;
          })}
        </svg>
        <svg
          viewBox="0 0 400 400"
          className="absolute h-[218px] w-[218px] opacity-[0.42]"
          style={{ animation: 'cove2-ring-b 900ms ease-out 160ms both, cove2-spin-rev 64s linear infinite 1060ms' }}
          aria-hidden="true"
        >
          <circle cx="200" cy="200" r="176" fill="none" stroke="#9A9A95" strokeWidth="0.7" />
          <circle cx="200" cy="200" r="150" fill="none" stroke="#9A9A95" strokeWidth="0.6" strokeDasharray="2 7" />
          {/* 四方位小节点（魔法阵符文位的极简转译；同样 toFixed 归一） */}
          {[0, 90, 180, 270].map((deg) => {
            const a = (deg * Math.PI) / 180;
            const cx = +(200 + Math.cos(a) * 176).toFixed(2);
            const cy = +(200 + Math.sin(a) * 176).toFixed(2);
            return <circle key={deg} cx={cx} cy={cy} r="2.4" fill="#8A8A86" />;
          })}
        </svg>
        {/* 涟漪：从中心周期扩散（雨窗水纹） */}
        {[0, 1300].map((delay) => (
          <span
            key={delay}
            className="absolute rounded-full border border-[#9A9A95]"
            style={{
              width: 128,
              height: 128,
              animation: `cove2-ripple 2.8s cubic-bezier(0.22,0.61,0.36,1) ${delay}ms infinite`,
            }}
          />
        ))}
      </div>

      {/* 右侧竖排微字（星盘图侧边坐标的转译） */}
      <span
        className="absolute right-[16px] top-1/2 origin-center translate-y-[-50%] rotate-90 text-[8.5px] font-medium uppercase tracking-[0.5em] text-[#8A8A86]/70"
        style={rise(1100)}
      >
        Cove · Quiet Harbor
      </span>

      {/* 中央文字组 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[13px]">
        {/* 顶部英文宽字距小字 */}
        <p
          className="font-serif text-[10.5px] font-medium uppercase tracking-[0.52em] text-[#7C7C78]"
          style={{ ...rise(180), textIndent: '0.52em' }}
        >
          Let the world wait
        </p>
        {/* wordmark：衬线大字（参考图手写 logo 的衬线转译） */}
        <h1
          className="font-serif text-[46px] font-medium leading-none tracking-[0.2em] text-[#3A3A38]"
          style={{ ...rise(400), textIndent: '0.2em' }}
        >
          Cove
        </h1>
        {/* 细分隔线 */}
        <span className="block h-[0.5px] w-[64px] bg-[#B9B9B4]" style={rise(560)} />
        {/* 中文诗行（宽字距） */}
        <p
          className="font-serif text-[12.5px] tracking-[0.34em] text-[#6E6E6A]"
          style={{ ...rise(680), textIndent: '0.34em' }}
        >
          喧嚣之外，静水一湾。
        </p>
      </div>

      {/* 底部左：LOCAL 实时时钟（星盘 LOCAL STAR TIME 转译） */}
      <div
        className="absolute bottom-[30px] left-[26px] flex items-baseline gap-[7px] font-serif tabular-nums text-[#7C7C78]"
        style={rise(980)}
      >
        <span className="text-[8.5px] uppercase tracking-[0.3em]">Local</span>
        <span className="text-[15px] font-medium tracking-[0.12em]">{clock || '--:--'}</span>
      </div>

      {/* 底部右：ENTER 呼吸圆环按钮（参考图右下 ENTER；自动进入、点按跳过） */}
      <div className="absolute bottom-[26px] right-[26px]" style={rise(1080)}>
        <span className="relative grid h-[52px] w-[52px] place-items-center rounded-full">
          {/* 呼吸脉冲环 */}
          <span
            className="absolute inset-0 rounded-full border border-[#8A8A86]/50"
            style={{ animation: 'cove2-pulse 2.2s cubic-bezier(0.4,0,0.6,1) infinite' }}
          />
          <span className="absolute inset-0 rounded-full border border-[#8A8A86]/70" />
          <span className="font-serif text-[9.5px] font-medium uppercase tracking-[0.24em] text-[#6E6E6A]">Enter</span>
        </span>
      </div>

      {/* 底部中央：微光进度条（保留第三十一轮的微光扫过意象） */}
      <div className="absolute bottom-[34px] left-1/2 h-[2px] w-[92px] -translate-x-1/2 overflow-hidden rounded-full bg-[#000000]/[0.07]" style={rise(880)}>
        <span
          className="absolute inset-y-0 left-0 w-[36%] rounded-full"
          style={{
            background: 'linear-gradient(90deg, rgba(150,150,145,0) 0%, #A6A6A0 45%, #8A8A86 60%, rgba(150,150,145,0) 100%)',
            animation: 'cove2-sweep 1.35s cubic-bezier(0.4,0,0.6,1) infinite',
          }}
        />
      </div>
    </div>
  );
}
