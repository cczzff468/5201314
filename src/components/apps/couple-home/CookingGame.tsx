'use client';

/**
 * 情侣小家 3D —— 做饭小游戏（v5.7 F5）
 *
 * 流程：选菜谱（三选一）→ 切菜（点闪亮的食材块 ×6）→ 翻炒（指针进绿色区点击 ×4）
 *   → 装盘（长按蓄力到目标区）→ 完成 → 饭菜上桌（上层 setMealReady）。
 * 每步都有完美判定：完美次数越多评级越高（上层 toast 文案区分「家常味 / 大厨水准」）。
 * 「先不玩了」= 中途退出，不触发上桌。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChefHat, Flame, Scissors, X } from 'lucide-react';

/** 菜谱（emoji + 名称 + 底色） */
const DISHES = [
  { emoji: '🍅', name: '番茄炒蛋', bg: '#fde8e0' },
  { emoji: '🍗', name: '可乐鸡翅', bg: '#fdf0d8' },
  { emoji: '🌶️', name: '麻婆豆腐', bg: '#fbe3e8' },
] as const;

type Step = 'pick' | 'chop' | 'stir' | 'plate' | 'done';

export default function CookingGame({
  onComplete,
  onClose,
}: {
  onComplete: (dishName: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('pick');
  const [dish, setDish] = useState<(typeof DISHES)[number] | null>(null);
  const [perfect, setPerfect] = useState(0);

  // —— 切菜：闪亮块顺序点亮，点中 +1（快 = 完美计数） ——
  const [chopTotal, setChopTotal] = useState(0);
  const [chopHit, setChopHit] = useState(0);
  const [chopLit, setChopLit] = useState(-1);
  const chopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chopStart = useRef(0);

  useEffect(() => {
    if (step !== 'chop') return;
    chopStart.current = performance.now();
    const next = () => setChopLit(Math.floor(Math.random() * 6));
    next();
    const iv = setInterval(() => {
      setChopLit((cur) => {
        if (cur >= 0 && Math.random() < 0.5) return cur; // 保持一会儿再换
        return Math.floor(Math.random() * 6);
      });
    }, 620);
    return () => clearInterval(iv);
  }, [step]);

  useEffect(() => () => {
    if (chopTimer.current) clearTimeout(chopTimer.current);
  }, []);

  const tapChunk = (i: number) => {
    if (step !== 'chop' || i !== chopLit) return;
    setChopLit(-1);
    const quick = performance.now() - chopStart.current < 99999; // 亮着点中即完美
    if (quick) setPerfect((p) => p + 1);
    setChopHit((h) => {
      const n = h + 1;
      setChopTotal((t) => t + 1);
      if (n >= 6) {
        chopTimer.current = setTimeout(() => setStep('stir'), 620);
      }
      return n;
    });
  };

  // —— 翻炒：指针来回扫，绿区点击 ——
  const [stirPos, setStirPos] = useState(0);
  const [stirHit, setStirHit] = useState(0);
  const stirOkRef = useRef(false);
  useEffect(() => {
    if (step !== 'stir') return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const e = (performance.now() - t0) / 1000;
      const pos = (Math.sin(e * 2.4) + 1) / 2; // 0~1
      setStirPos(pos);
      stirOkRef.current = pos > 0.42 && pos < 0.58;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  const stirTap = () => {
    if (step !== 'stir') return;
    if (stirOkRef.current) {
      setPerfect((p) => p + 1);
      setStirHit((h) => {
        if (h + 1 >= 4) setTimeout(() => setStep('plate'), 500);
        return h + 1;
      });
    }
    // 未踩点：不计数不惩罚（友好向），等下一次指针进区
  };

  // —— 装盘：长按蓄力 ——
  const [fill, setFill] = useState(0);
  const [plateOk, setPlateOk] = useState(false);
  const fillRaf = useRef(0);
  const fillDir = useRef(1);
  const holdingRef = useRef(false);
  useEffect(() => {
    if (step !== 'plate') return;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (holdingRef.current) {
        setFill((f) => {
          let n = f + fillDir.current * dt * 0.9;
          if (n >= 1) {
            n = 1;
            fillDir.current = -1;
          }
          if (n <= 0) {
            n = 0;
            fillDir.current = 1;
          }
          return n;
        });
      }
      fillRaf.current = requestAnimationFrame(tick);
    };
    fillRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(fillRaf.current);
  }, [step]);

  const releasePlate = useCallback(() => {
    holdingRef.current = false;
    if (step !== 'plate') return;
    if (fill > 0.44 && fill < 0.6) {
      setPlateOk(true);
      setPerfect((p) => p + 1);
      setTimeout(() => setStep('done'), 720);
    } else {
      // 没对准：归零重来（无惩罚文案）
      setFill(0);
      fillDir.current = 1;
    }
  }, [step, fill]);

  const finish = () => {
    if (!dish) return;
    onComplete(dish.name);
  };

  const grade = perfect >= 8 ? '大厨水准' : perfect >= 5 ? '有模有样' : '家常味道';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-6 backdrop-blur-[2px]"
    >
      <motion.div
        initial={{ scale: 0.92, y: 14 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="w-full max-w-[330px] rounded-3xl bg-white/96 p-5 shadow-2xl"
      >
        {/* 头部 */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fdeee2]">
              <ChefHat className="h-[18px] w-[18px] text-[#d98d4e]" />
            </span>
            <div>
              <div className="text-[15px] font-semibold text-[#3a3a3e]">今天开小灶</div>
              <div className="text-[11px] text-[#9a9a96]">
                {dish ? `${dish.emoji} ${dish.name} · 完美 ×${perfect}` : '选一道想吃的菜吧'}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭做饭"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 步骤条 */}
        {dish && (
          <div className="mb-4 flex items-center gap-1.5">
            {(
              [
                ['chop', '切菜', Scissors],
                ['stir', '翻炒', Flame],
                ['plate', '装盘', ChefHat],
              ] as const
            ).map(([k, label, Icon]) => {
              const idx = ['pick', 'chop', 'stir', 'plate', 'done'].indexOf(k);
              const cur = ['pick', 'chop', 'stir', 'plate', 'done'].indexOf(step);
              const active = idx === cur;
              const done = idx < cur;
              return (
                <div
                  key={k}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-full py-1.5 text-[11px] font-medium ${
                    active
                      ? 'bg-[#f2b3c2] text-white'
                      : done
                        ? 'bg-[#e8f3ea] text-[#5a9a6a]'
                        : 'bg-[#f3f1ec] text-[#a8a8a4]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </div>
              );
            })}
          </div>
        )}

        {/* 跳过：不想玩小游戏就直接热剩饭上桌（保留旧版自动做饭路径） */}
        {dish && step !== 'done' && (
          <button
            onClick={() => onComplete('家常便饭')}
            className="mx-auto mt-3 block text-[11.5px] text-[#a8a8a4] underline decoration-dotted transition active:scale-95"
          >
            不想玩了，直接热剩饭上桌
          </button>
        )}

        <AnimatePresence mode="wait">
          {/* —— 选菜谱 —— */}
          {step === 'pick' && (
            <motion.div
              key="pick"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="grid grid-cols-3 gap-2.5"
            >
              {DISHES.map((d) => (
                <button
                  key={d.name}
                  onClick={() => {
                    setDish(d);
                    setStep('chop');
                  }}
                  className="flex flex-col items-center gap-1.5 rounded-2xl p-3 shadow-sm ring-1 ring-[#efece2] transition active:scale-95"
                  style={{ background: d.bg }}
                >
                  <span className="text-[30px] leading-none">{d.emoji}</span>
                  <span className="text-[12px] font-semibold text-[#4a4a4e]">{d.name}</span>
                </button>
              ))}
            </motion.div>
          )}

          {/* —— 切菜 —— */}
          {step === 'chop' && (
            <motion.div key="chop" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <p className="mb-3 text-center text-[12.5px] text-[#6a6a6e]">点亮谁就切谁！切满 6 块</p>
              <div className="grid grid-cols-3 gap-2.5">
                {Array.from({ length: 6 }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => tapChunk(i)}
                    className={`flex h-16 items-center justify-center rounded-2xl text-[26px] transition-all duration-150 ${
                      i === chopLit
                        ? 'scale-105 bg-[#fff3d6] shadow-md ring-2 ring-[#f2c86e]'
                        : chopHit > i
                          ? 'bg-[#eef3ec] opacity-50'
                          : 'bg-[#f6f4ef]'
                    }`}
                  >
                    {chopHit > i ? '✅' : dish?.emoji}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* —— 翻炒 —— */}
          {step === 'stir' && (
            <motion.div key="stir" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <p className="mb-3 text-center text-[12.5px] text-[#6a6a6e]">指针滑进粉色区时点「颠勺」，来 4 次</p>
              <div className="relative mb-3 h-3 rounded-full bg-[#f0eee8]">
                <div className="absolute left-[42%] top-0 h-full w-[16%] rounded-full bg-[#f6c1cd]" />
                <div
                  className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#d98d4e] shadow"
                  style={{ left: `${stirPos * 100}%` }}
                />
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={stirTap}
                  className="flex h-12 items-center gap-2 rounded-full bg-[#f2b3c2] px-6 text-[14px] font-semibold text-white shadow-lg transition active:scale-95"
                >
                  <Flame className="h-[18px] w-[18px]" />
                  颠勺！
                </button>
                <span className="text-[13px] font-semibold text-[#8a8a90]">{stirHit}/4</span>
              </div>
            </motion.div>
          )}

          {/* —— 装盘 —— */}
          {step === 'plate' && (
            <motion.div key="plate" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <p className="mb-3 text-center text-[12.5px] text-[#6a6a6e]">长按按钮蓄力，在粉色刻度处松手</p>
              <div className="relative mb-4 h-4 rounded-full bg-[#f0eee8]">
                <div className="absolute left-[44%] top-0 h-full w-[12%] rounded-full bg-[#f6c1cd]" />
                <motion.div
                  className="absolute left-0 top-0 h-full rounded-full bg-[#8fd0a8]"
                  style={{ width: `${fill * 100}%` }}
                />
                <div
                  className="absolute top-1/2 h-6 w-1.5 -translate-y-1/2 rounded-full bg-[#4a4a4e]"
                  style={{ left: `${fill * 100}%` }}
                />
              </div>
              <div className="flex justify-center">
                <button
                  onPointerDown={() => {
                    holdingRef.current = true;
                  }}
                  onPointerUp={releasePlate}
                  onPointerLeave={() => {
                    if (holdingRef.current) releasePlate();
                  }}
                  className={`flex h-12 items-center gap-2 rounded-full px-8 text-[14px] font-semibold text-white shadow-lg transition active:scale-95 ${
                    plateOk ? 'bg-[#7fc792]' : 'bg-[#f2b3c2]'
                  }`}
                >
                  {plateOk ? '装盘完成！' : '按住蓄力'}
                </button>
              </div>
            </motion.div>
          )}

          {/* —— 完成 —— */}
          {step === 'done' && dish && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 py-2"
            >
              <motion.span
                className="text-[52px]"
                animate={{ rotate: [0, -8, 8, 0] }}
                transition={{ repeat: Infinity, duration: 1.6 }}
              >
                {dish.emoji}
              </motion.span>
              <div className="text-center">
                <div className="text-[16px] font-semibold text-[#3a3a3e]">{dish.name}出锅啦！</div>
                <div className="mt-1 text-[12px] text-[#9a9a96]">
                  评级：{grade}（完美 ×{perfect}）
                </div>
              </div>
              <button
                onClick={finish}
                className="flex h-12 items-center gap-2 rounded-full bg-[#f2b3c2] px-7 text-[14px] font-semibold text-white shadow-lg transition active:scale-95"
              >
                上桌开饭 🍚
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
