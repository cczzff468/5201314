'use client';

/**
 * 情侣小家 3D —— 咖啡拉花小游戏（v6.1 G10，咖啡机联动）
 *
 * - 俯视一杯咖啡：白瓷杯 + 奶棕咖啡面（CSS 径向渐变）；
 * - timing 轨道：指针 1.4s 左右往返；两端红（miss 40%）/ 黄（ok 40%）/ 中间绿（perfect 20%）；
 * - 点「注入奶泡」停针 → 按落点判定：
 *   perfect = 杯面浮现白色爱心（缩放弹入）+「完美拉花！」；
 *   ok = 奶泡圆斑 +「不错的拉花」；
 *   miss = 奶泡洒出 + 杯身摇晃 +「啊，奶泡倒多了…」；
 * - 0.9s 后自动 onResult(r) + onClose（防连点；提前点 X 关闭则不回调）；
 * - 自包含模态（absolute 遮罩 + 白卡 + AnimatePresence），拉花台只在 open 时挂载，
 *   rAF 驱动指针，卸载即清理。
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Coffee, Heart, Milk, X } from 'lucide-react';

export type LatteResult = 'miss' | 'ok' | 'perfect';

interface LatteArtGameProps {
  open: boolean;
  onClose: () => void;
  onResult: (r: LatteResult) => void;
}

/** timing 轨道分段（from/to 为 0~1 比例） */
const BANDS: { from: number; to: number; cls: string }[] = [
  { from: 0, to: 0.2, cls: '#f2a9a0' },
  { from: 0.2, to: 0.4, cls: '#f5d98f' },
  { from: 0.4, to: 0.6, cls: '#9fd0a8' },
  { from: 0.6, to: 0.8, cls: '#f5d98f' },
  { from: 0.8, to: 1, cls: '#f2a9a0' },
];

/** miss 时奶泡洒落点（杯面内百分比） */
const SPLASH = [
  { x: 14, y: 16, s: 18 },
  { x: 78, y: 24, s: 14 },
  { x: 70, y: 76, s: 16 },
  { x: 24, y: 80, s: 12 },
  { x: 52, y: 6, s: 10 },
];

/** 拉花台（仅在 open 时挂载，天然新一局） */
function LatteBoard({ onClose, onResult }: { onClose: () => void; onResult: (r: LatteResult) => void }) {
  const [phase, setPhase] = useState<'aim' | 'pour'>('aim');
  const [result, setResult] = useState<LatteResult | null>(null);
  const [pos, setPos] = useState(0.5);
  const posRef = useRef(0.5);
  const firedRef = useRef(false);

  // —— 指针往返（1.4s 周期，rAF） ——
  useEffect(() => {
    if (phase !== 'aim') return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      posRef.current = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 1.4 - Math.PI / 2);
      setPos(posRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // —— 出结果：0.9s 后自动回调 + 关闭 ——
  useEffect(() => {
    if (phase !== 'pour' || !result || firedRef.current) return;
    firedRef.current = true;
    const timer = setTimeout(() => {
      onResult(result);
      onClose();
    }, 900);
    return () => clearTimeout(timer);
  }, [phase, result, onResult, onClose]);

  const pour = () => {
    if (phase !== 'aim' || firedRef.current) return; // 防连点
    const p = posRef.current;
    const r: LatteResult = p < 0.2 || p > 0.8 ? 'miss' : p >= 0.4 && p <= 0.6 ? 'perfect' : 'ok';
    setResult(r);
    setPhase('pour');
  };

  return (
    <>
      {/* 头部 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fdeee2]">
            <Coffee className="h-[18px] w-[18px] text-[#c98d5e]" />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-[#3a3a3e]">咖啡拉花</div>
            <div className="text-[11px] text-[#9a9a96]">停针注奶，给 TA 画颗爱心</div>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="关闭拉花"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 咖啡杯（俯视） */}
      <motion.div
        className="relative mx-auto mb-4 h-44 w-44"
        animate={phase === 'pour' && result === 'miss' ? { x: [0, -5, 5, -3, 3, 0] } : { x: 0 }}
        transition={{ duration: 0.45 }}
      >
        {/* 杯把 */}
        <div className="absolute -right-5 top-1/2 h-14 w-14 -translate-y-1/2 rounded-full border-[7px] border-[#efe9dd]" />
        {/* 杯身 */}
        <div className="absolute inset-0 rounded-full bg-[#f6f1e8] shadow-lg ring-1 ring-black/5" />
        {/* 咖啡面 */}
        <div
          className="absolute inset-[10px] overflow-hidden rounded-full"
          style={{ background: 'radial-gradient(circle at 42% 38%, #c99468, #a5754e 62%, #8f6242)' }}
        >
          <AnimatePresence>
            {/* perfect：白色爱心浮现 */}
            {result === 'perfect' && (
              <motion.div
                key="heart"
                initial={{ scale: 0, rotate: -16, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', damping: 11, stiffness: 240 }}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              >
                <Heart className="h-14 w-14 fill-[#fdfbf6] text-[#fdfbf6] drop-shadow" />
              </motion.div>
            )}
            {/* ok：普通奶泡圆斑 */}
            {result === 'ok' && (
              <motion.div
                key="blob"
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', damping: 14, stiffness: 200 }}
                className="absolute left-[38%] top-[42%] h-12 w-16 rounded-[46%] bg-white/85 blur-[0.5px]"
              />
            )}
            {/* miss：奶泡洒到杯缘 */}
            {result === 'miss' &&
              SPLASH.map((sp, i) => (
                <motion.span
                  key={i}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 0.92 }}
                  transition={{ delay: i * 0.05, type: 'spring', damping: 13, stiffness: 260 }}
                  className="absolute rounded-full bg-white/90 blur-[1px]"
                  style={{ left: `${sp.x}%`, top: `${sp.y}%`, width: sp.s, height: sp.s * 0.8 }}
                />
              ))}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* timing 轨道 */}
      <div className="relative mb-4 h-3 rounded-full">
        {BANDS.map((b, i) => (
          <span
            key={i}
            className="absolute top-0 h-full"
            style={{
              left: `${b.from * 100}%`,
              width: `${(b.to - b.from) * 100}%`,
              background: b.cls,
              borderRadius: i === 0 ? '999px 0 0 999px' : i === BANDS.length - 1 ? '0 999px 999px 0' : 0,
            }}
          />
        ))}
        {/* 指针（pour 后停在落点） */}
        <span
          className="absolute top-1/2 h-5 w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#4a4a4e] shadow"
          style={{ left: `${pos * 100}%` }}
        />
      </div>

      {/* 结果文案 / 提示 */}
      <div className="mb-3 text-center">
        {phase === 'pour' && result ? (
          <motion.div key={result} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[15px] font-semibold text-[#3a3a3e]">
            {result === 'perfect' ? '完美拉花！' : result === 'ok' ? '不错的拉花' : '啊，奶泡倒多了…'}
          </motion.div>
        ) : (
          <div className="text-[11.5px] text-[#b8b8b4]">指针滑到中间绿色区再注奶 = 完美爱心</div>
        )}
      </div>

      {/* 注奶按钮 */}
      <div className="flex justify-center">
        <button
          onClick={pour}
          disabled={phase !== 'aim'}
          className="flex h-12 items-center gap-2 rounded-full bg-[#f4b3c2] px-8 text-[14px] font-semibold text-white shadow-lg shadow-[#f4b3c2]/40 transition active:scale-95 disabled:opacity-60"
        >
          <Milk className="h-[18px] w-[18px]" />
          注入奶泡
        </button>
      </div>
    </>
  );
}

export default function LatteArtGame({ open, onClose, onResult }: LatteArtGameProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
        >
          <motion.div
            initial={{ scale: 0.92, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="w-full max-w-[330px] rounded-3xl bg-white/96 p-5 shadow-2xl"
          >
            <LatteBoard onClose={onClose} onResult={onResult} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
