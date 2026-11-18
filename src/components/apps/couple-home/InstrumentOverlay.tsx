'use client';

/**
 * 情侣小家 —— 乐器弹奏覆盖层（生活模式点击吉他/钢琴 → 镜头推近 + 可弹奏界面）
 *
 * - 吉他：竖版六弦木纹指板（低音弦在左），点弦拨音、按住横扫 = 扫弦；
 *   指板下方独立一条毛玻璃和弦条 C/G/Am/F/Em：按住即「按弦」，此时扫弦弹出和弦把位（闷弦不发声）；
 * - 钢琴（v6.7 紧凑键床版）：墨黑面板 = 顶部工具条（红点 =《小星星》演示开关，蓝色琴标 + 标题，
 *   FX 圆钮 = 音色选择，节拍器圆钮 = 100BPM 打拍，✕ = 结束演奏）+ 琴键床直接相贴
 *   （v6.7 删中部幕布舞台；音符气泡改在键床上方上浮）
 *   （C3→C6 三个完整八度 22 白键 + 15 黑键，2+3 真实排布，象牙白键/亮面黑键）；
 *   多指和弦、滑音（glissando）保留；
 * - 音色：FX 圆钮弹出收缩式选择器（毛玻璃浮层向上弹出、选中打勾、点外部自动收起）；
 * - 吉他不变：木纹指板 + 毛玻璃和弦条；覆盖层下沉（mb-64px）给 3D 小人让视野，面板外区域 pointer 穿透可转视角。
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Check, ChevronDown, Gauge, Music, Piano as PianoIcon, X } from 'lucide-react';
import {
  GUITAR_CHORDS,
  GUITAR_STRINGS,
  PIANO_BLACK,
  PIANO_WHITE,
  TWINKLE,
  chordStringFreq,
  emitNote,
  ensureAudio,
  type GuitarChord,
  type GuitarTimbre,
  onNote,
  pianoNote,
  pluckString,
  type PianoTimbre,
  twinkleTempoMs,
} from './instrument';
import { onSongState } from './ai-song';

/** 音名 → 频率（演示曲排程用） */
const NOTE_FREQ = new Map<string, number>([...PIANO_WHITE, ...PIANO_BLACK].map((k) => [k.name, k.freq]));

const PIANO_TIMBRES: { v: PianoTimbre; label: string }[] = [
  { v: 'grand', label: '钢琴' },
  { v: 'ep', label: '电钢' },
  { v: 'musicbox', label: '八音盒' },
];
const GUITAR_TIMBRES: { v: GuitarTimbre; label: string }[] = [
  { v: 'acoustic', label: '木吉他' },
  { v: 'ukulele', label: '尤克里里' },
];

/** 毛玻璃公共质感（标题条 / 和弦条 / 音色浮层共用） */
const GLASS =
  'border border-white/60 bg-white/70 shadow-[0_8px_24px_rgba(60,40,30,0.18)] backdrop-blur-2xl';

// ---------------- 音色收缩选择器（点开向上弹毛玻璃浮层，点外部自动收起） ----------------

function TimbrePicker({
  options,
  value,
  onChange,
  variant = 'pill',
}: {
  options: { v: PianoTimbre | GuitarTimbre; label: string }[];
  value: PianoTimbre | GuitarTimbre;
  onChange: (v: PianoTimbre | GuitarTimbre) => void;
  /** pill = 深色药丸（毛玻璃标题条用）；chip = 白描边圆形 FX 钮（钢琴深色工具条用） */
  variant?: 'pill' | 'chip';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.v === value);

  // 点外部收起：捕获阶段监听，先于面板内 stopPropagation 生效
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {variant === 'chip' ? (
        <button
          type="button"
          aria-label={`切换音色（当前${current?.label ?? ''}）`}
          onClick={() => setOpen((o) => !o)}
          className={`flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] text-[10.5px] font-black tracking-wide transition active:scale-90 ${
            open
              ? 'border-[#f4b3c2] bg-[#f4b3c2]/20 text-[#f4b3c2]'
              : 'border-white/75 bg-white/5 text-white'
          }`}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          FX
        </button>
      ) : (
        <button
          type="button"
          aria-label="切换音色"
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 items-center gap-1 rounded-full bg-[#453e39]/85 px-3 text-[12px] font-semibold text-white shadow-sm transition active:scale-95"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {current?.label}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}
      {open && (
        <div
          className={`absolute right-0 z-40 min-w-[120px] rounded-2xl p-1 ${GLASS} ${
            // chip（钢琴深色工具条）面板 overflow-hidden → 向下弹进舞台区；pill（吉他毛玻璃条）保持向上弹
            variant === 'chip' ? 'top-[calc(100%+10px)]' : 'bottom-[calc(100%+10px)]'
          }`}
          style={{
            animation: 'instPopUp .16s ease-out both',
            transformOrigin: variant === 'chip' ? 'top right' : 'bottom right',
          }}
        >
          {options.map((o) => {
            const active = o.v === value;
            return (
              <button
                key={o.v}
                type="button"
                onClick={() => {
                  onChange(o.v);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[12.5px] transition active:scale-[0.97] ${
                  active
                    ? 'bg-[#f4b3c2]/30 font-semibold text-[#453e39]'
                    : 'text-[#453e39]/85 hover:bg-black/5'
                }`}
              >
                {o.label}
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-[#d97f95]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- 吉他面板 ----------------

function GuitarPanel({
  timbre,
  heldChord,
  heldChordRef,
}: {
  timbre: GuitarTimbre;
  heldChord: GuitarChord | null;
  heldChordRef: RefObject<GuitarChord | null>;
}) {
  const [vibing, setVibing] = useState<number[]>([]); // 正在抖动的弦
  const vibeTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // 按住滑动扫弦：记录上一根被拨的弦，滑入新弦时再拨（每根弦每次按住只拨一次入列去重）
  const lastStrum = useRef<{ pid: number; idx: number }[]>([]);

  // 弦抖动动效（回放/外部音符事件点亮时只动不发声）——v10 C2：650ms 更明显
  const flashString = useCallback((idx: number) => {
    setVibing((v) => (v.includes(idx) ? v : [...v, idx]));
    const old = vibeTimers.current.get(idx);
    if (old) clearTimeout(old);
    vibeTimers.current.set(
      idx,
      setTimeout(() => {
        setVibing((v) => v.filter((i) => i !== idx));
        vibeTimers.current.delete(idx);
      }, 650),
    );
  }, []);

  const twang = useCallback(
    (idx: number) => {
      const chord = heldChordRef.current;
      const semi = chord ? chord.offsets[idx] : null;
      if (chord && semi === null) return; // 按和弦时该弦被左手闷住，不出声
      const freq = chordStringFreq(GUITAR_STRINGS[idx].freq, semi);
      pluckString(freq, 1, timbre);
      emitNote({
        kind: 'guitar',
        freq,
        name: chord ? `${chord.name}·${GUITAR_STRINGS[idx].name}` : GUITAR_STRINGS[idx].name,
      });
      flashString(idx);
    },
    [flashString, heldChordRef, timbre],
  );

  // 音符事件（外部弹奏等）点亮就近开放弦
  useEffect(() => {
    return onNote((e) => {
      if (e.kind !== 'guitar') return;
      let best = 0;
      let bestD = Infinity;
      GUITAR_STRINGS.forEach((s, i) => {
        const d = Math.abs(Math.log(s.freq / e.freq));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      flashString(best);
    });
  }, [flashString]);

  const idxFromEvent = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width / GUITAR_STRINGS.length;
    return Math.max(0, Math.min(GUITAR_STRINGS.length - 1, Math.floor(x / w)));
  }, []);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-[26px] shadow-2xl">
      {/* 木纹指板 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg,#7a5230 0%,#6b4426 18%,#8a5f38 38%,#6b4426 62%,#5d3a20 82%,#4c2f1a 100%)',
        }}
      />
      {/* 品丝 + 品记 */}
      <div className="absolute inset-0">
        {[12, 28, 44, 60, 76, 90].map((top) => (
          <div
            key={top}
            className="absolute inset-x-0 h-[5px] rounded-full bg-gradient-to-b from-[#cfd4d8] via-[#9aa3ab] to-[#7c848c] shadow"
            style={{ top: `${top}%` }}
          />
        ))}
        {[20, 36, 52].map((top) => (
          <div
            key={top}
            className="absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-[#efe6d4]/90 shadow-inner"
            style={{ top: `${top}%` }}
          />
        ))}
      </div>
      {/* 六根弦（可拨/可扫） */}
      <div
        className="absolute inset-0 flex touch-none"
        style={{ WebkitTapHighlightColor: 'transparent' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          const idx = idxFromEvent(e);
          twang(idx);
          lastStrum.current = [{ pid: e.pointerId, idx }];
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0 && e.pointerType === 'mouse') return;
          if (!lastStrum.current.some((s) => s.pid === e.pointerId)) return;
          const idx = idxFromEvent(e);
          const mine = lastStrum.current.find((s) => s.pid === e.pointerId);
          if (mine && mine.idx !== idx) {
            twang(idx);
            mine.idx = idx;
          }
        }}
        onPointerUp={(e) => {
          lastStrum.current = lastStrum.current.filter((s) => s.pid !== e.pointerId);
        }}
        onPointerCancel={(e) => {
          lastStrum.current = lastStrum.current.filter((s) => s.pid !== e.pointerId);
        }}
      >
        {GUITAR_STRINGS.map((s, i) => {
          const hot = vibing.includes(i);
          return (
          <div key={s.name + i} className="relative flex-1">
            {/* 弦体：低音弦缠丝金色 / 高音弦银亮，拨动时抖动 + 高亮发光（v10 C2） */}
            <div
              className="absolute left-1/2 top-0 h-full w-[3.5px] -translate-x-1/2 rounded-full"
              style={{
                background: hot
                  ? s.wound
                    ? 'linear-gradient(90deg,#ffd76e,#fff3c4 45%,#ffd76e)'
                    : 'linear-gradient(90deg,#e8f0f5,#ffffff 45%,#e8f0f5)'
                  : s.wound
                    ? 'linear-gradient(90deg,#b98f3e,#f3dd9a 45%,#b98f3e)'
                    : 'linear-gradient(90deg,#9fa6ac,#f2f5f7 45%,#9fa6ac)',
                boxShadow: hot
                  ? '0 0 4px rgba(0,0,0,0.45), 0 0 14px rgba(255,215,140,0.95), 0 0 26px rgba(255,200,110,0.5)'
                  : '0 0 4px rgba(0,0,0,0.45)',
                animation: hot ? 'stringVibe 0.5s ease-out' : undefined,
              }}
            />
            {/* 弦枕环 */}
            <div className="absolute left-1/2 top-[3px] h-4 w-5 -translate-x-1/2 rounded-full border border-[#3a2a18]/60 bg-[#2a1d10]/50" />
            {/* 弦名 */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/35 px-2 py-0.5 text-[11px] font-bold text-[#f5e9d2]">
              {s.name}
            </div>
          </div>
          );
        })}
      </div>
      {/* 已按和弦徽标（按住和弦条时显示，扫弦出和弦把位） */}
      {heldChord && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/30 px-3 py-1 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
          已按 {heldChord.name} 和弦
        </div>
      )}
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes stringVibe{0%{transform:translate(-50%,0) scaleX(1)}15%{transform:translate(-46%,0) scaleX(2.6)}30%{transform:translate(-54%,0) scaleX(.7)}45%{transform:translate(-47%,0) scaleX(2.2)}60%{transform:translate(-53%,0) scaleX(.85)}75%{transform:translate(-49%,0) scaleX(1.6)}100%{transform:translate(-50%,0) scaleX(1)}}`,
        }}
      />
    </div>
  );
}

// ---------------- 吉他舞台：琴体 + 独立毛玻璃和弦条 ----------------

function GuitarStage({ timbre }: { timbre: GuitarTimbre }) {
  // 按住的和弦：state 驱动 UI，ref 供扫弦时即时读取（多指：一手按和弦一手扫弦）
  const [heldChord, setHeldChord] = useState<GuitarChord | null>(null);
  const heldChordRef = useRef<GuitarChord | null>(null);

  // 松开和弦：按住后任意位置 pointerup / pointercancel 都释放
  useEffect(() => {
    if (!heldChord) return;
    const release = () => {
      heldChordRef.current = null;
      setHeldChord(null);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [heldChord]);

  return (
    <>
      <GuitarPanel timbre={timbre} heldChord={heldChord} heldChordRef={heldChordRef} />
      {/* 和弦条：独立毛玻璃条，按住 chip =「按弦」，此时扫弦弹和弦把位 */}
      <div
        className={`flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl px-3 ${GLASS}`}
      >
        {GUITAR_CHORDS.map((c) => {
          const held = heldChord?.id === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-label={`按住 ${c.name} 和弦`}
              className={`h-9 min-w-11 touch-none select-none rounded-full text-[13px] font-bold text-white shadow-md transition-all active:scale-95 ${
                held ? '-translate-y-1 ring-2 ring-white/90' : ''
              }`}
              style={{ backgroundColor: c.tint, WebkitTapHighlightColor: 'transparent' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                heldChordRef.current = c;
                setHeldChord(c);
              }}
            >
              {c.name}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---------------- 钢琴舞台（深色舞台风：工具条 + 竖纹幕布 + 音符气泡 + 真实感键床） ----------------

/** 键名 → 键中心横向位置（键床宽度百分比，音符气泡对齐用） */
function keyCenterPct(name: string): number {
  const wi = PIANO_WHITE.findIndex((k) => k.name === name);
  if (wi >= 0) return ((wi + 0.5) / PIANO_WHITE.length) * 100;
  const bk = PIANO_BLACK.find((b) => b.name === name);
  if (bk) return ((bk.after + 1) / PIANO_WHITE.length) * 100;
  return 50;
}

interface NoteBubble {
  id: number;
  label: string;
  x: number;
}

function PianoStage({
  timbre,
  onTimbre,
  onClose,
  aiSongTitle,
}: {
  timbre: PianoTimbre;
  onTimbre: (v: PianoTimbre) => void;
  onClose: () => void;
  /** v10 C2：AI 正在弹的曲名（null = 没在弹）——键床上方曲名字幕 */
  aiSongTitle: string | null;
}) {
  const [pressed, setPressed] = useState<string[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 滑音：按住拖动时经过新键也发声
  const lastKey = useRef<{ pid: number; key: string }[]>([]);
  // 外部音符（小星星演示等）点亮的键
  const [lit, setLit] = useState<string[]>([]);
  const litTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 舞台上浮的音符气泡
  const [bubbles, setBubbles] = useState<NoteBubble[]>([]);
  const bubbleSeq = useRef(0);
  const bubbleTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // 演示/弹奏期间读最新音色（effect 中同步，避免渲染期写 ref）
  const timbreRef = useRef(timbre);
  useEffect(() => {
    timbreRef.current = timbre;
  }, [timbre]);

  const spawnBubble = useCallback((label: string) => {
    const id = ++bubbleSeq.current;
    setBubbles((b) => [...b.slice(-10), { id, label, x: keyCenterPct(label) }]);
    const t = setTimeout(() => {
      setBubbles((b) => b.filter((x) => x.id !== id));
      bubbleTimers.current.delete(id);
    }, 1080);
    bubbleTimers.current.set(id, t);
  }, []);

  const hit = useCallback(
    (name: string, freq: number) => {
      pianoNote(freq, 1, timbreRef.current);
      emitNote({ kind: 'piano', freq, name });
      setPressed((p) => (p.includes(name) ? p : [...p, name]));
      const old = timers.current.get(name);
      if (old) clearTimeout(old);
      timers.current.set(
        name,
        setTimeout(() => {
          setPressed((p) => p.filter((n) => n !== name));
          timers.current.delete(name);
        }, 260),
      );
    },
    [],
  );

  // 音符事件点亮对应琴键 + 上浮气泡（手弹经 emitNote 回路、演示曲同样点亮）
  // v10 C2：点亮时长 300 → 430ms，视觉更跟手
  useEffect(() => {
    return onNote((e) => {
      if (e.kind !== 'piano') return;
      setLit((l) => (l.includes(e.name) ? l : [...l, e.name]));
      const old = litTimers.current.get(e.name);
      if (old) clearTimeout(old);
      litTimers.current.set(
        e.name,
        setTimeout(() => {
          setLit((l) => l.filter((n) => n !== e.name));
          litTimers.current.delete(e.name);
        }, 430),
      );
      spawnBubble(e.name);
    });
  }, [spawnBubble]);

  // —— 《小星星》演示（红点开关） ——
  const [demoOn, setDemoOn] = useState(false);
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stopDemo = useCallback(() => {
    demoTimers.current.forEach(clearTimeout);
    demoTimers.current = [];
    setDemoOn(false);
  }, []);

  const startDemo = useCallback(() => {
    stopDemo();
    setDemoOn(true);
    let t = 0;
    const ts: ReturnType<typeof setTimeout>[] = [];
    for (const n of TWINKLE) {
      const freq = NOTE_FREQ.get(n.name);
      if (freq == null) continue;
      const delay = t;
      ts.push(
        setTimeout(() => {
          pianoNote(freq, 1, timbreRef.current);
          emitNote({ kind: 'piano', freq, name: n.name });
        }, delay),
      );
      t += twinkleTempoMs * n.beats;
    }
    ts.push(
      setTimeout(() => {
        demoTimers.current = [];
        setDemoOn(false);
      }, t + 400),
    );
    demoTimers.current = ts;
  }, [stopDemo]);

  // —— 节拍器（100BPM 短促打拍，WebAudio 合成，无音频文件） ——
  const [metroOn, setMetroOn] = useState(false);
  const metroInt = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!metroOn) return;
    const tick = () => {
      const ctx = ensureAudio();
      if (!ctx) return;
      const o = ctx.createOscillator();
      const gn = ctx.createGain();
      o.type = 'square';
      o.frequency.value = 1500;
      gn.gain.setValueAtTime(0.14, ctx.currentTime);
      gn.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.045);
      o.connect(gn);
      gn.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.05);
    };
    tick();
    metroInt.current = setInterval(tick, 600); // ♩=100
    return () => {
      if (metroInt.current) clearInterval(metroInt.current);
      metroInt.current = null;
    };
  }, [metroOn]);

  // 卸载时清掉全部定时器
  useEffect(
    () => () => {
      litTimers.current.forEach((t) => clearTimeout(t));
      litTimers.current.clear();
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
      bubbleTimers.current.forEach((t) => clearTimeout(t));
      bubbleTimers.current.clear();
      demoTimers.current.forEach(clearTimeout);
      demoTimers.current = [];
    },
    [],
  );

  /** 白键/黑键共用的按压手势（点按 + 按住滑键滑音 + 多指和弦） */
  const pressHandlers = useCallback(
    (name: string, freq: number) => ({
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        hit(name, freq);
        lastKey.current = [
          ...lastKey.current.filter((s) => s.pid !== e.pointerId),
          { pid: e.pointerId, key: name },
        ];
      },
      onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.buttons === 0 && e.pointerType === 'mouse') return;
        const mine = lastKey.current.find((s) => s.pid === e.pointerId);
        if (mine && mine.key !== name) {
          hit(name, freq);
          mine.key = name;
        }
      },
      onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
        lastKey.current = lastKey.current.filter((s) => s.pid !== e.pointerId);
      },
      onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => {
        lastKey.current = lastKey.current.filter((s) => s.pid !== e.pointerId);
      },
    }),
    [hit],
  );

  const unit = 100 / PIANO_WHITE.length; // 单个白键宽度百分比

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] bg-[#0a0a0c] shadow-2xl ring-1 ring-black/60">
      {/* 顶部工具条：红点演示｜蓝色琴标·标题｜FX 音色｜节拍器｜结束 */}
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-white/10 bg-gradient-to-b from-[#232327] to-[#131316] px-3">
        <button
          type="button"
          aria-label={demoOn ? '停止小星星演示' : '播放小星星演示'}
          onClick={() => (demoOn ? stopDemo() : startDemo())}
          className="flex h-7 w-7 shrink-0 items-center justify-center transition active:scale-90"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <span
            className={`block h-4 w-4 rounded-full bg-[#e14b41] shadow-[0_0_10px_rgba(225,75,65,0.55),inset_0_-2px_3px_rgba(0,0,0,0.35)] ${
              demoOn ? 'animate-pulse ring-2 ring-white/70' : ''
            }`}
          />
        </button>
        <div className="flex min-w-0 items-center gap-1.5">
          <PianoIcon className="h-[18px] w-[18px] shrink-0 text-[#4f8ef7]" />
          <span className="truncate text-[12px] font-semibold text-[#9a9aa2]">弹钢琴 · C3–C6</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <TimbrePicker
            variant="chip"
            options={PIANO_TIMBRES}
            value={timbre}
            onChange={(v) => onTimbre(v as PianoTimbre)}
          />
          <button
            type="button"
            aria-label={metroOn ? '关闭节拍器' : '开启节拍器'}
            aria-pressed={metroOn}
            onClick={() => setMetroOn((m) => !m)}
            className={`flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] transition active:scale-90 ${
              metroOn
                ? 'border-[#f4b3c2] bg-[#f4b3c2]/20 text-[#f4b3c2] shadow-[0_0_10px_rgba(244,179,194,0.4)]'
                : 'border-white/75 bg-white/5 text-white'
            }`}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Gauge className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="结束演奏"
            className="flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] border-white/75 bg-white/5 text-white transition active:scale-90"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {/* 键床（v6.7：删中部幕布舞台，工具条与琴键直接相贴）：象牙白键 + 亮面黑键（2+3 真实排布）+ 键上音符气泡 */}
      <div className="relative min-h-0 flex-1 border-t border-white/10 bg-[#050506]">
      {/* 曲名字幕（v10 C2：AI 点歌弹奏时显示；演示字幕共存时上下叠放） */}
      <div className="pointer-events-none absolute left-1/2 top-2 z-20 flex -translate-x-1/2 flex-col items-center gap-1">
        {aiSongTitle && (
          <div className="whitespace-nowrap rounded-full bg-[#f4b3c2]/25 px-3 py-1 text-[10.5px] font-semibold text-[#ffd9e4] ring-1 ring-[#f4b3c2]/50 backdrop-blur-sm">
            ♪ 《{aiSongTitle}》 · TA 弹奏中
          </div>
        )}
        {demoOn && (
          <div className="whitespace-nowrap rounded-full bg-white/10 px-3 py-1 text-[10.5px] font-semibold text-white/85 backdrop-blur-sm">
            ♪ 小星星 演示中 · 点红点停止
          </div>
        )}
      </div>
        {bubbles.map((b) => (
          <span
            key={b.id}
            className="note-bubble pointer-events-none absolute top-[30%] z-10 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/90"
            style={{ left: `${b.x}%` }}
          >
            {b.label}
          </span>
        ))}
        <div className="relative mx-[3px] h-full">
          <div className="absolute inset-0 flex">
            {PIANO_WHITE.map((k) => {
              const on = pressed.includes(k.name) || lit.includes(k.name);
              return (
                <div
                  key={k.name}
                  className="relative flex-1 touch-none border-r border-[#c9c6ba]/80 last:border-r-0"
                  style={{
                    WebkitTapHighlightColor: 'transparent',
                    borderRadius: '0 0 4px 4px',
                    background: on
                      ? 'linear-gradient(180deg,#ffd7e4 0%,#ff9fc2 100%)'
                      : 'linear-gradient(180deg,#ffffff 0%,#f4f3ee 62%,#e7e5dc 100%)',
                    boxShadow: on
                      ? 'inset 0 2px 4px rgba(180,90,110,0.28), inset 0 -3px 4px -2px rgba(120,60,80,0.3), 0 0 16px rgba(255,140,180,0.6), 0 0 30px rgba(255,120,170,0.35)'
                      : 'inset -1px 0 1.5px -1px rgba(60,55,40,0.35), inset 1px 0 1.5px -1px rgba(255,255,255,0.95), inset 0 -5px 6px -4px rgba(70,64,48,0.5)',
                    transform: on ? 'scaleY(0.975)' : undefined,
                    transformOrigin: 'top',
                  }}
                  {...pressHandlers(k.name, k.freq)}
                >
                  {/* 键前立面 */}
                  <div className="pointer-events-none absolute inset-x-[1.5px] bottom-0 h-[8%] rounded-b-[4px] bg-gradient-to-b from-black/[0.05] to-black/[0.15]" />
                  {k.label && (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8.5px] font-bold text-[#a8a496]">
                      {k.name}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* 黑键：亮面质感，按下微沉 */}
          {PIANO_BLACK.map((b) => {
            const isOn = pressed.includes(b.name) || lit.includes(b.name);
            return (
              <div
                key={b.name}
                className="absolute top-0 z-10 h-[58%] touch-none"
                style={{
                  left: `calc(${(b.after + 1) * unit}% - ${unit * 0.29}%)`,
                  width: `${unit * 0.58}%`,
                  WebkitTapHighlightColor: 'transparent',
                  borderRadius: '0 0 3.5px 3.5px',
                  background: isOn
                    ? 'linear-gradient(180deg,#7d7d8c 0%,#2c2c36 100%)'
                    : 'linear-gradient(180deg,#34343b 0%,#0e0e13 62%,#1f1f26 100%)',
                  boxShadow: isOn
                    ? '0 3px 5px rgba(0,0,0,0.65), inset 0 2px 2px rgba(255,255,255,0.28), inset -1.5px 0 3px rgba(0,0,0,0.6), inset 0 -2px 2px rgba(255,255,255,0.1), 0 0 14px rgba(255,150,185,0.55), 0 0 26px rgba(255,120,170,0.3)'
                    : '0 3px 5px rgba(0,0,0,0.65), inset 0 2px 2px rgba(255,255,255,0.22), inset -1.5px 0 3px rgba(0,0,0,0.6), inset 0 -2px 2px rgba(255,255,255,0.1)',
                  transform: isOn ? 'scaleY(0.96)' : undefined,
                  transformOrigin: 'top',
                }}
                {...pressHandlers(b.name, b.freq)}
              />
            );
          })}
        </div>
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html:
            '@keyframes noteFloat{0%{transform:translate(-50%,8px);opacity:0}18%{opacity:1}100%{transform:translate(-50%,-46px);opacity:0}}.note-bubble{animation:noteFloat 1.05s ease-out both}',
        }}
      />
    </div>
  );
}

// ---------------- 覆盖层主体 ----------------

export default function InstrumentOverlay({
  kind,
  onClose,
}: {
  kind: 'piano' | 'guitar';
  onClose: () => void;
}) {
  const stop = useCallback((e: React.SyntheticEvent) => e.stopPropagation(), []);

  // v10 C2：AI 弹奏时显示曲名字幕（钢琴键床上方胶囊 / 吉他标题条；订阅 ai-song 曲目状态）
  const [aiSong, setAiSong] = useState<{ title: string; kind: string } | null>(null);
  useEffect(() => {
    return onSongState((s) => {
      setAiSong(s.playing && s.title && s.kind ? { title: s.title, kind: s.kind } : null);
    });
  }, []);

  // 音色（钢琴/吉他各自记忆，切面板不丢）
  const [pianoTimbre, setPianoTimbre] = useState<PianoTimbre>('grand');
  const [guitarTimbre, setGuitarTimbre] = useState<GuitarTimbre>('acoustic');
  const timbre: PianoTimbre | GuitarTimbre = kind === 'piano' ? pianoTimbre : guitarTimbre;

  const pickTimbre = useCallback(
    (v: PianoTimbre | GuitarTimbre) => {
      if (kind === 'piano') setPianoTimbre(v as PianoTimbre);
      else setGuitarTimbre(v as GuitarTimbre);
    },
    [kind],
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-end">
      <style
        dangerouslySetInnerHTML={{
          __html: '@keyframes instPopUp{from{opacity:0;transform:translateY(8px) scale(.95)}to{opacity:1;transform:none}}',
        }}
      />
      <div
        className={`pointer-events-auto mx-3 mb-[64px] flex flex-col gap-2 ${
          kind === 'piano' ? 'h-[27%] max-h-[218px]' : 'h-[45%] max-h-[388px]'
        }`}
        onPointerDown={stop}
        onPointerMove={stop}
        onPointerUp={stop}
        onTouchStart={stop}
        onTouchMove={stop}
      >
        {kind === 'piano' ? (
          // 钢琴：深色舞台一体面板（工具条内含红点演示/FX 音色/节拍器/结束）
          <PianoStage timbre={pianoTimbre} onTimbre={setPianoTimbre} onClose={onClose} aiSongTitle={aiSong && aiSong.kind !== 'guitar' ? aiSong.title : null} />
        ) : (
          <>
            {/* 标题条（毛玻璃）：左标题｜音色收缩选择 + 结束（吉他） */}
            <div
              className={`flex h-11 shrink-0 items-center justify-between gap-2 rounded-full pl-4 pr-1.5 ${GLASS}`}
            >
              <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-[#453e39]">
                <Music className={`h-4 w-4 shrink-0 text-[#d97f95] ${aiSong ? 'animate-pulse' : ''}`} />
                <span className="truncate">
                  {aiSong?.kind === 'guitar' ? (
                    <span className="text-[#c05c78]">♪ 《{aiSong.title}》 · TA 弹奏中</span>
                  ) : (
                    '弹吉他'
                  )}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <TimbrePicker options={GUITAR_TIMBRES} value={timbre as GuitarTimbre} onChange={pickTimbre} />
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="结束演奏"
                  className="flex h-8 items-center gap-1 rounded-full bg-[#f4b3c2] px-3 text-[12px] font-semibold text-white shadow-sm transition active:scale-95"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <X className="h-3.5 w-3.5" />
                  结束演奏
                </button>
              </div>
            </div>
            <GuitarStage timbre={guitarTimbre} />
          </>
        )}
      </div>
    </div>
  );
}
