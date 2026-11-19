'use client';

/**
 * 情侣小家 3D —— 抓娃娃机小游戏（v6.1 G10）
 *
 * - 俯视 3×2 六格奖池：六只纯 CSS 手绘毛绒头（兔/鸭/熊猫/猪/猫/熊，不用 emoji）；
 * - 爪子在顶部横杆下自动游走（x 快摆 1.8s + y 慢摆 3.4s，覆盖全部六格），
 *   点「落爪」→ 爪子滑到当前格下降合拢 → 落爪瞬间内部掷骰（60% 抓中）：
 *   抓住 = 毛绒升起跟随爪子送往出奖口 → onWin(kind)（上层摆进房间 + 30s 冷却）；
 *   失败 = 爪子晃了晃空手而归 + 遗憾文案，可立刻再来；
 * - disabled = 冷却中（上层 st.lastClaw 30s 内）：整面板半透明锁定，只看不抓；
 * - 自包含模态（与 CookingGame/ChessOverlay 同款：absolute 遮罩 + 白卡 + AnimatePresence）；
 *   奖盘只在 open 时挂载（每次开 = 新一局），rAF 驱动、卸载即清理、防连点。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Grab, Heart, Lock, RotateCcw, X } from 'lucide-react';

export type ClawPlush = 'plushBunny' | 'plushDuck' | 'plushPanda' | 'plushPig' | 'plushCat' | 'bear';

interface ClawMachineGameProps {
  open: boolean;
  onClose: () => void;
  onWin: (plush: ClawPlush) => void;
  disabled?: boolean;
}

/** 六格毛绒配置（顺序 = 奖池格位顺序；patch = 内耳/嘴/耳色） */
const PLUSHIES: { kind: ClawPlush; name: string; body: string; patch: string; ears: 'long' | 'round' | 'pointy' | 'none' }[] = [
  { kind: 'plushBunny', name: '兔兔', body: '#fdf9f4', patch: '#f6c2cf', ears: 'long' },
  { kind: 'plushDuck', name: '鸭鸭', body: '#f7d76a', patch: '#f0a35a', ears: 'none' },
  { kind: 'plushPanda', name: '熊猫', body: '#ffffff', patch: '#3a3a40', ears: 'round' },
  { kind: 'plushPig', name: '猪猪', body: '#f9c9d4', patch: '#f2a9bc', ears: 'round' },
  { kind: 'plushCat', name: '猫猫', body: '#e8e2d8', patch: '#d9d0c2', ears: 'pointy' },
  { kind: 'bear', name: '熊熊', body: '#c99a6a', patch: '#b9885a', ears: 'round' },
];

/** 六格中心（奖池内百分比坐标；列 ~3 等分、行 2 等分） */
const COLS = [0.17, 0.48, 0.79];
const ROWS = [0.28, 0.75];

/** 纯 CSS 小毛绒头：圆头 + 耳朵 + 豆眼 + 腮红（+ 鸭嘴/猪鼻/熊猫眼斑） */
function PlushHead({ kind, size = 44 }: { kind: ClawPlush; size?: number }) {
  const p = PLUSHIES.find((v) => v.kind === kind) ?? PLUSHIES[0];
  const u = size / 44; // 尺寸单位比例
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* 耳朵（垫在头后面） */}
      {p.ears === 'long' &&
        [-1, 1].map((s) => (
          <span
            key={s}
            className="absolute rounded-full"
            style={{
              width: 9 * u,
              height: 22 * u,
              left: `calc(50% + ${s * 8 * u}px)`,
              top: -12 * u,
              transform: 'translateX(-50%)',
              background: p.body,
              boxShadow: `inset 0 0 0 1.5px ${p.patch}`,
            }}
          >
            <span className="absolute rounded-full" style={{ left: '26%', right: '26%', top: '22%', bottom: '22%', background: p.patch }} />
          </span>
        ))}
      {p.ears === 'round' &&
        [-1, 1].map((s) => (
          <span
            key={s}
            className="absolute rounded-full"
            style={{
              width: 14 * u,
              height: 14 * u,
              left: `calc(50% + ${s * 14 * u}px)`,
              top: -3 * u,
              transform: 'translateX(-50%)',
              background: kind === 'plushPanda' ? p.patch : p.body,
              boxShadow: kind === 'plushPanda' ? undefined : `inset 0 0 0 1.5px ${p.patch}`,
            }}
          >
            {kind !== 'plushPanda' && <span className="absolute rounded-full" style={{ inset: '24%', background: p.patch }} />}
          </span>
        ))}
      {p.ears === 'pointy' &&
        [-1, 1].map((s) => (
          <span
            key={s}
            className="absolute"
            style={{
              width: 12 * u,
              height: 12 * u,
              left: `calc(50% + ${s * 13 * u}px)`,
              top: -4 * u,
              transform: 'translateX(-50%) rotate(45deg)',
              background: p.patch,
              borderRadius: 3 * u,
            }}
          />
        ))}
      {/* 头 */}
      <span className="absolute inset-0 rounded-full" style={{ background: p.body, boxShadow: 'inset -2px -3px 0 rgba(90,60,60,0.06)' }} />
      {/* 熊猫眼斑 */}
      {kind === 'plushPanda' &&
        [-1, 1].map((s) => (
          <span
            key={s}
            className="absolute rounded-full"
            style={{
              width: 11 * u,
              height: 13 * u,
              left: `calc(50% + ${s * 7.5 * u}px)`,
              top: 15 * u,
              transform: `translateX(-50%) rotate(${s * 18}deg)`,
              background: p.patch,
            }}
          />
        ))}
      {/* 豆豆眼 */}
      {[-1, 1].map((s) => (
        <span
          key={s}
          className="absolute rounded-full"
          style={{ width: 4 * u, height: 4.5 * u, left: `calc(50% + ${s * 7.5 * u}px)`, top: 19 * u, transform: 'translateX(-50%)', background: '#4a3f3a' }}
        />
      ))}
      {/* 鸭嘴 */}
      {kind === 'plushDuck' && (
        <span className="absolute rounded-full" style={{ width: 16 * u, height: 8 * u, left: '50%', top: 26 * u, transform: 'translateX(-50%)', background: p.patch }}>
          <span className="absolute rounded-full" style={{ left: '32%', right: '32%', top: '32%', bottom: '32%', background: '#e08a3a' }} />
        </span>
      )}
      {/* 猪鼻 */}
      {kind === 'plushPig' && (
        <span className="absolute rounded-full" style={{ width: 14 * u, height: 10 * u, left: '50%', top: 25 * u, transform: 'translateX(-50%)', background: p.patch }}>
          {[-1, 1].map((s) => (
            <span
              key={s}
              className="absolute rounded-full"
              style={{ width: 2.5 * u, height: 4 * u, left: `calc(50% + ${s * 3.5 * u}px)`, top: 3 * u, transform: 'translateX(-50%)', background: '#d98aa0' }}
            />
          ))}
        </span>
      )}
      {/* 腮红 */}
      {kind !== 'plushDuck' &&
        [-1, 1].map((s) => (
          <span
            key={s}
            className="absolute rounded-full"
            style={{ width: 6 * u, height: 4 * u, left: `calc(50% + ${s * 13 * u}px)`, top: 25 * u, transform: 'translateX(-50%)', background: '#f7b8c4', opacity: 0.55 }}
          />
        ))}
    </div>
  );
}

type Phase = 'idle' | 'run' | 'won' | 'lost';
interface ClawResult {
  win: boolean;
  kind: ClawPlush;
  cell: number;
}

/** 奖盘（仅在 open 时挂载，天然新一局） */
function ClawBoard({ onClose, onWin, disabled }: { onClose: () => void; onWin: (plush: ClawPlush) => void; disabled?: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ClawResult | null>(null);
  const clawRef = useRef<HTMLDivElement>(null); // 爪子（含被抓毛绒）
  const cableRef = useRef<HTMLDivElement>(null); // 吊缆
  const prongL = useRef<HTMLSpanElement>(null);
  const prongR = useRef<HTMLSpanElement>(null);
  const carryRef = useRef<HTMLDivElement>(null); // 被抓起的毛绒
  const posRef = useRef({ x: 0.5, y: 0.08 }); // 爪位（奖池内 0~1）
  const closeRef = useRef(0); // 爪子合拢 0~1

  /** 把 posRef/closeRef 状态刷到 DOM（rAF 直写，不经过 React 渲染） */
  const paint = useCallback(() => {
    const { x, y } = posRef.current;
    if (clawRef.current) {
      clawRef.current.style.left = `${x * 100}%`;
      clawRef.current.style.top = `${y * 100}%`;
    }
    if (cableRef.current) {
      cableRef.current.style.left = `${x * 100}%`;
      cableRef.current.style.height = `${Math.max(0, y * 100 - 2)}%`;
    }
    const a = 20 - closeRef.current * 16;
    if (prongL.current) prongL.current.style.transform = `rotate(${-a}deg)`;
    if (prongR.current) prongR.current.style.transform = `rotate(${a}deg)`;
  }, []);

  // —— 空闲游走：x 快摆 1.8s / y 慢摆 3.4s（相位错开，六格全覆盖） ——
  useEffect(() => {
    if (phase !== 'idle') return;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      posRef.current.x = 0.5 + 0.42 * Math.sin((t * Math.PI * 2) / 1.8);
      posRef.current.y = 0.5 + 0.42 * Math.sin((t * Math.PI * 2) / 3.4 + 1.2);
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, paint]);

  // —— 落爪序列（rAF 状态机：寻位 → 降爪合拢 → 抓住升起送往出口 / 落空晃头回杆） ——
  useEffect(() => {
    if (phase !== 'run' || !result) return;
    const { win, kind } = result;
    const start = { ...posRef.current };
    const col = Math.min(2, Math.max(0, Math.round((start.x - 1 / 6) * 3)));
    const row = start.y < 0.5 ? 0 : 1;
    const target = { x: COLS[col], y: ROWS[row] };
    const exit = { x: 0.9, y: 0.85 };
    const SEEK = 0.45;
    const GRAB = 0.25;
    const LIFT = 0.45;
    const CARRY = 0.5;
    const SHAKE = 0.3;
    const BACK = 0.45;
    const t0 = performance.now();
    let raf = 0;
    const ease = (k: number) => 1 - Math.pow(1 - k, 3);
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      let lift = 0; // 毛绒升起量 0~1（跟随缩放）
      let x = posRef.current.x;
      let y = posRef.current.y;
      if (t < SEEK) {
        const k = ease(t / SEEK);
        x = start.x + (target.x - start.x) * k;
        y = start.y + (target.y - start.y) * k;
      } else if (t < SEEK + GRAB) {
        x = target.x;
        y = target.y;
        closeRef.current = Math.min(1, (t - SEEK) / (GRAB * 0.7));
      } else if (win && t < SEEK + GRAB + LIFT) {
        // 抓住了：毛绒跟着爪子升起
        const k = ease((t - SEEK - GRAB) / LIFT);
        closeRef.current = 1;
        lift = k;
        x = target.x;
        y = target.y - 0.2 * k;
      } else if (win && t < SEEK + GRAB + LIFT + CARRY) {
        // 送往出奖口
        const k = ease((t - SEEK - GRAB - LIFT) / CARRY);
        closeRef.current = 1;
        lift = 1 - k * 0.8;
        x = target.x + (exit.x - target.x) * k;
        y = target.y - 0.2 + (exit.y - (target.y - 0.2)) * k;
      } else if (win) {
        // 到达出口：结算
        paint();
        setPhase('won');
        return;
      } else if (t < SEEK + GRAB + SHAKE) {
        // 落空：爪子失望地左右晃
        const k = (t - SEEK - GRAB) / SHAKE;
        closeRef.current = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6;
        x = target.x + Math.sin(k * Math.PI * 5) * 0.016;
        y = target.y;
      } else if (t < SEEK + GRAB + SHAKE + BACK) {
        // 空手回杆
        const k = ease((t - SEEK - GRAB - SHAKE) / BACK);
        closeRef.current = 0;
        x = target.x + (0.5 - target.x) * k;
        y = target.y + (0.08 - target.y) * k;
      } else {
        paint();
        setPhase('lost');
        return;
      }
      posRef.current.x = x;
      posRef.current.y = y;
      // 被抓毛绒：抓住后出现并跟随，送抵后消失
      if (carryRef.current) {
        const show = win && t >= SEEK + GRAB;
        carryRef.current.style.opacity = show ? '1' : '0';
        carryRef.current.style.transform = `translate(-50%, 0) scale(${0.85 + lift * 0.3})`;
      }
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, result, paint]);

  const drop = () => {
    if (disabled || phase !== 'idle') return; // 防连点
    const { x, y } = posRef.current;
    const col = Math.min(2, Math.max(0, Math.round((x - 1 / 6) * 3)));
    const row = y < 0.5 ? 0 : 1;
    const cell = row * 3 + col;
    setResult({ win: Math.random() < 0.6, kind: PLUSHIES[cell].kind, cell });
    setPhase('run');
  };

  const collect = () => {
    if (result?.win) onWin(result.kind);
    onClose();
  };

  const retry = () => {
    setPhase('idle');
    setResult(null);
    closeRef.current = 0;
    posRef.current = { x: 0.5, y: 0.08 };
    paint();
  };

  const winName = result ? (PLUSHIES.find((v) => v.kind === result.kind)?.name ?? '') : '';

  return (
    <>
      {/* 头部 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fdeef1]">
            <Grab className="h-[18px] w-[18px] text-[#e8899a]" />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-[#3a3a3e]">娃娃机 · 一抓定情</div>
            <div className="text-[11px] text-[#9a9a96]">爪子游到喜欢的毛绒上就落爪！</div>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="关闭娃娃机"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 奖池（俯视 3×2 + 游走爪子） */}
      <div className="relative mb-3 h-[172px] overflow-hidden rounded-2xl bg-gradient-to-b from-[#fdf3f0] to-[#fbe9ec] ring-1 ring-[#f2dde2]">
        {/* 顶部横杆 */}
        <div className="absolute inset-x-0 top-0 h-[7px] bg-[#e8b7c2]/80" />
        {/* 出奖口（右下角黑圆洞） */}
        <div className="absolute bottom-2 right-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-[#3a3a40]/90 text-[8px] font-semibold text-white/85 shadow-inner">
          出口
        </div>
        {/* 六格毛绒 */}
        <div className="grid h-full grid-cols-3 grid-rows-2 gap-1.5 p-1.5 pt-3">
          {PLUSHIES.map((pl, i) => {
            const taken = phase === 'run' && result?.cell === i;
            return (
              <div key={pl.kind} className="flex items-center justify-center rounded-xl bg-white/55">
                <div
                  className="transition-opacity duration-300"
                  style={{ opacity: taken && result?.win ? 0 : 1, transform: i === 5 ? 'translate(-8px, 4px)' : undefined }}
                >
                  <PlushHead kind={pl.kind} size={40} />
                </div>
              </div>
            );
          })}
        </div>
        {/* 吊缆 */}
        <div ref={cableRef} className="absolute top-0 w-[2px] bg-[#c9a3ad]" style={{ left: '50%', height: '8%' }} />
        {/* 爪子 */}
        <div ref={clawRef} className="absolute z-10" style={{ left: '50%', top: '8%' }}>
          <div className="relative h-5 w-5 -translate-x-1/2 -translate-y-1/2">
            <span className="absolute left-1/2 top-0 block h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-[#8a6a72] shadow" />
            <span
              ref={prongL}
              className="absolute left-[3px] top-2 h-[13px] w-[3px] rounded-full bg-[#8a6a72]"
              style={{ transform: 'rotate(-20deg)', transformOrigin: 'top center' }}
            />
            <span
              ref={prongR}
              className="absolute right-[3px] top-2 h-[13px] w-[3px] rounded-full bg-[#8a6a72]"
              style={{ transform: 'rotate(20deg)', transformOrigin: 'top center' }}
            />
            {/* 被抓起的毛绒（跟随爪子） */}
            <div ref={carryRef} className="absolute left-1/2 top-4 opacity-0" style={{ transform: 'translate(-50%, 0)' }}>
              <PlushHead kind={result?.kind ?? 'bear'} size={30} />
            </div>
          </div>
        </div>
      </div>

      {/* 控制区 / 结算 */}
      <AnimatePresence mode="wait">
        {phase === 'idle' && !disabled && (
          <motion.div
            key="ctl"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex flex-col items-center gap-1.5"
          >
            <button
              onClick={drop}
              className="flex h-12 items-center gap-2 rounded-full bg-[#f4b3c2] px-8 text-[14px] font-semibold text-white shadow-lg shadow-[#f4b3c2]/40 transition active:scale-95"
            >
              <Grab className="h-[18px] w-[18px]" />
              落爪！
            </button>
            <span className="text-[11px] text-[#b8b8b4]">60% 抓中率 · 抓中的毛绒会摆进小屋</span>
          </motion.div>
        )}
        {phase === 'run' && (
          <motion.div key="run" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-12 items-center justify-center">
            <span className="text-[13px] font-medium text-[#b08a94]">爪子下降中…</span>
          </motion.div>
        )}
        {phase === 'won' && result?.win && (
          <motion.div
            key="win"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-2 py-1"
          >
            <motion.div animate={{ y: [0, -6, 0], rotate: [0, -4, 4, 0] }} transition={{ repeat: Infinity, duration: 1.4 }}>
              <PlushHead kind={result.kind} size={62} />
            </motion.div>
            <div className="text-[16px] font-semibold text-[#3a3a3e]">抓到{winName}啦！</div>
            <button
              onClick={collect}
              className="flex h-11 items-center gap-2 rounded-full bg-[#f4b3c2] px-7 text-[14px] font-semibold text-white shadow-lg transition active:scale-95"
            >
              <Heart className="h-4 w-4" />
              收下 TA
            </button>
          </motion.div>
        )}
        {phase === 'lost' && (
          <motion.div
            key="lost"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-2 py-1"
          >
            <div className="text-[14.5px] font-semibold text-[#6a6a6e]">差一点点…再来一次？</div>
            <div className="flex items-center gap-2.5">
              <button
                onClick={retry}
                className="flex h-11 items-center gap-1.5 rounded-full bg-[#f4b3c2] px-6 text-[13.5px] font-semibold text-white shadow-lg transition active:scale-95"
              >
                <RotateCcw className="h-4 w-4" />
                再来一次
              </button>
              <button
                onClick={onClose}
                className="flex h-11 items-center rounded-full bg-[#f0eff1] px-5 text-[13.5px] font-medium text-[#8a8a90] transition active:scale-95"
              >
                先不玩了
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 冷却遮罩（disabled = 刚抓中 30s 内） */}
      {disabled && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-3xl bg-white/65 backdrop-blur-[3px]">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f4b3c2]/20">
            <Lock className="h-5 w-5 text-[#e8899a]" />
          </span>
          <div className="text-[14px] font-semibold text-[#6a6a6e]">娃娃机充能中…</div>
          <div className="text-[11.5px] text-[#a8a8a4]">刚抓出一只毛绒，稍后再来抓</div>
        </div>
      )}
    </>
  );
}

export default function ClawMachineGame({ open, onClose, onWin, disabled }: ClawMachineGameProps) {
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
            className="relative w-full max-w-[330px] rounded-3xl bg-white/96 p-5 shadow-2xl"
          >
            <ClawBoard onClose={onClose} onWin={onWin} disabled={disabled} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
