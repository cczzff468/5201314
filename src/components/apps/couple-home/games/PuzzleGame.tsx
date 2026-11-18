'use client';

/**
 * 情侣小家 3D —— 照片拼图小游戏（v6.1 G10，相框联动）
 *
 * - 3×3 交换拼图：photo（相框 dataURL）离屏 canvas cover 裁成正方形；
 *   缺省用内置插画（离屏 canvas：渐变天空 + 太阳 + 云 + 小屋 + 两只手拉手的简笔小人 +「拾光小屋」）；
 * - 图片切 9 片（backgroundSize 300% + backgroundPosition 切片），随机两两交换 24 次
 *   打乱（保证非初始顺序）；点第一块选中（粉描边高亮）再点第二块交换（framer layout 动画）；
 * - 步数 + 计时；完成 = 缝隙收起 + 全图高亮描边 + 彩带粒子 +「拼好啦！」+ 用时/步数；
 * - 自包含模态（absolute 遮罩 + 白卡 + AnimatePresence），拼图盘只在 open 时挂载
 * （每次开 = 新一局），卸载清理计时器。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, Footprints, PartyPopper, X } from 'lucide-react';

interface PuzzleGameProps {
  open: boolean;
  onClose: () => void;
  /** 相框照片（压缩后 dataURL）；缺省 = 内置插画底图 */
  photo?: string;
}

const N = 3;
const SZ = 480; // 底图边长（切片按 300% 定位）

/** 内置插画底图（离屏 canvas 手绘，不引外部图片） */
function makeDefaultArt(): string {
  const cv = document.createElement('canvas');
  cv.width = SZ;
  cv.height = SZ;
  const ctx = cv.getContext('2d')!;
  // 渐变天空
  const sky = ctx.createLinearGradient(0, 0, 0, SZ * 0.72);
  sky.addColorStop(0, '#aee0f5');
  sky.addColorStop(0.7, '#fde9ee');
  sky.addColorStop(1, '#fff4ec');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SZ, SZ * 0.72);
  // 太阳 + 光晕
  ctx.fillStyle = 'rgba(255,217,143,0.4)';
  ctx.beginPath();
  ctx.arc(SZ * 0.8, SZ * 0.17, SZ * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd98f';
  ctx.beginPath();
  ctx.arc(SZ * 0.8, SZ * 0.17, SZ * 0.072, 0, Math.PI * 2);
  ctx.fill();
  // 云 ×2（椭圆簇）
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  for (const [cx, cy, s] of [
    [0.2, 0.15, 1],
    [0.52, 0.1, 0.72],
  ]) {
    for (const [dx, dy, r] of [
      [0, 0, 34],
      [-26, 8, 24],
      [26, 8, 26],
    ]) {
      ctx.beginPath();
      ctx.arc(cx * SZ + dx * s, cy * SZ + dy * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 草地两层
  ctx.fillStyle = '#bfe0ac';
  ctx.beginPath();
  ctx.moveTo(0, SZ * 0.62);
  ctx.quadraticCurveTo(SZ * 0.5, SZ * 0.52, SZ, SZ * 0.64);
  ctx.lineTo(SZ, SZ);
  ctx.lineTo(0, SZ);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#aed49a';
  ctx.beginPath();
  ctx.moveTo(0, SZ * 0.78);
  ctx.quadraticCurveTo(SZ * 0.5, SZ * 0.7, SZ, SZ * 0.8);
  ctx.lineTo(SZ, SZ);
  ctx.lineTo(0, SZ);
  ctx.closePath();
  ctx.fill();
  // 小房子（粉墙红顶，呼应「拾光小屋」）
  ctx.fillStyle = '#fdf6f0';
  ctx.fillRect(SZ * 0.62, SZ * 0.42, SZ * 0.2, SZ * 0.17);
  ctx.fillStyle = '#e8899a';
  ctx.beginPath();
  ctx.moveTo(SZ * 0.59, SZ * 0.42);
  ctx.lineTo(SZ * 0.72, SZ * 0.33);
  ctx.lineTo(SZ * 0.85, SZ * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8a6a58';
  ctx.fillRect(SZ * 0.695, SZ * 0.5, SZ * 0.05, SZ * 0.09);
  // 两只好朋友（简笔小人，内侧手臂上扬牵手）
  const pal = (x: number, skin: string, shirt: string, armDir: number) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#6a5a52';
    ctx.lineWidth = SZ * 0.011;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * SZ * 0.012, SZ * 0.71);
      ctx.lineTo(x + s * SZ * 0.019, SZ * 0.78);
      ctx.stroke();
    }
    ctx.strokeStyle = shirt;
    ctx.lineWidth = SZ * 0.028;
    ctx.beginPath();
    ctx.moveTo(x, SZ * 0.605);
    ctx.lineTo(x, SZ * 0.71);
    ctx.stroke();
    ctx.lineWidth = SZ * 0.014;
    ctx.beginPath(); // 外侧手臂下垂
    ctx.moveTo(x, SZ * 0.63);
    ctx.lineTo(x - armDir * SZ * 0.042, SZ * 0.685);
    ctx.stroke();
    ctx.beginPath(); // 内侧手臂上扬牵手
    ctx.moveTo(x, SZ * 0.63);
    ctx.lineTo(x + armDir * SZ * 0.03, SZ * 0.6);
    ctx.stroke();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x, SZ * 0.555, SZ * 0.036, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a4a44';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + s * SZ * 0.012, SZ * 0.55, SZ * 0.0042, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#5a4a44';
    ctx.lineWidth = SZ * 0.006;
    ctx.beginPath();
    ctx.arc(x, SZ * 0.562, SZ * 0.013, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  };
  pal(SZ * 0.38, '#fde3da', '#f2a9bc', 1);
  pal(SZ * 0.48, '#d9e6f5', '#9fc3e8', -1);
  // 牵手上空的小爱心
  const heart = (x: number, y: number, s: number) => {
    ctx.fillStyle = 'rgba(240,150,170,0.9)';
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.4, y - s * 0.3, x - s * 0.5, y - s * 1.1, x, y - s * 0.3);
    ctx.bezierCurveTo(x + s * 0.5, y - s * 1.1, x + s * 1.4, y - s * 0.3, x, y + s * 0.9);
    ctx.fill();
  };
  heart(SZ * 0.43, SZ * 0.53, SZ * 0.02);
  heart(SZ * 0.35, SZ * 0.48, SZ * 0.013);
  heart(SZ * 0.5, SZ * 0.47, SZ * 0.011);
  // 「拾光小屋」字样（白描边 + 粉字）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${SZ * 0.1}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = SZ * 0.014;
  ctx.strokeText('拾光小屋', SZ * 0.5, SZ * 0.885);
  ctx.fillStyle = '#e8899a';
  ctx.fillText('拾光小屋', SZ * 0.5, SZ * 0.885);
  return cv.toDataURL('image/png');
}

/** 打乱（随机两两交换 24 次；保证不是初始顺序） */
function shuffled(): number[] {
  const order = Array.from({ length: N * N }, (_, i) => i);
  for (let k = 0; k < 24; k++) {
    const a = Math.floor(Math.random() * order.length);
    const b = Math.floor(Math.random() * order.length);
    [order[a], order[b]] = [order[b], order[a]];
  }
  if (order.every((v, i) => v === i)) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** 拼图盘（仅在 open 时挂载，天然新一局） */
function PuzzleBoard({ onClose, photo }: { onClose: () => void; photo?: string }) {
  const [img, setImg] = useState<string | null>(null);
  const [order, setOrder] = useState<number[]>(() => shuffled());
  const [sel, setSel] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const [secs, setSecs] = useState(0);
  const [won, setWon] = useState(false);
  const startedRef = useRef(false);

  // 底图：photo cover 裁方 / 内置插画（photo 变化时重生成）
  useEffect(() => {
    let alive = true;
    if (!photo) {
      setImg(makeDefaultArt());
      return;
    }
    const image = new Image();
    image.onload = () => {
      if (!alive) return;
      const cv = document.createElement('canvas');
      cv.width = SZ;
      cv.height = SZ;
      const ctx = cv.getContext('2d')!;
      const s = Math.max(SZ / image.width, SZ / image.height);
      const w = image.width * s;
      const h = image.height * s;
      ctx.drawImage(image, (SZ - w) / 2, (SZ - h) / 2, w, h);
      setImg(cv.toDataURL('image/png'));
    };
    image.onerror = () => {
      if (alive) setImg(makeDefaultArt());
    };
    image.src = photo;
    return () => {
      alive = false;
    };
  }, [photo]);

  // 计时（首次交换起跳，胜利停止）
  useEffect(() => {
    if (won || !startedRef.current) return;
    const iv = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [won, moves]);

  const tap = (cell: number) => {
    if (won || !img) return;
    if (sel === null) {
      setSel(cell);
      return;
    }
    if (sel === cell) {
      setSel(null);
      return;
    }
    const next = order.slice();
    [next[sel], next[cell]] = [next[cell], next[sel]];
    setOrder(next);
    setSel(null);
    setMoves((m) => m + 1);
    startedRef.current = true;
    if (next.every((v, i) => v === i)) setWon(true);
  };

  // 胜利彩带粒子（一次性）
  const confetti = useMemo(
    () =>
      won
        ? Array.from({ length: 22 }, (_, i) => ({
            x: 4 + Math.random() * 90,
            delay: Math.random() * 0.5,
            dur: 1.4 + Math.random() * 1.2,
            w: 6 + Math.random() * 6,
            color: ['#f2a9bc', '#f7d76a', '#9fd0a8', '#a8cdee', '#e0b0e8'][i % 5],
            rot: Math.random() * 360,
          }))
        : [],
    [won],
  );

  return (
    <>
      {/* 头部：缩略图 + 步数/计时 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="h-10 w-10 shrink-0 rounded-lg bg-[#f3f1ec] bg-cover bg-center ring-1 ring-black/10"
            style={{ backgroundImage: img ? `url(${img})` : undefined }}
          />
          <div>
            <div className="text-[15px] font-semibold text-[#3a3a3e]">照片拼图</div>
            <div className="text-[11px] text-[#9a9a96]">点两块交换位置，还原照片</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-[#f6f4ef] px-2.5 py-1 text-[11px] font-medium text-[#6a6a6e]">
            <Footprints className="h-3 w-3 text-[#c99a5b]" />
            {moves}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-[#f6f4ef] px-2.5 py-1 text-[11px] font-medium text-[#6a6a6e]">
            <Clock className="h-3 w-3 text-[#7fa8c9]" />
            {fmt(secs)}
          </span>
          <button
            onClick={onClose}
            aria-label="关闭拼图"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 拼图盘（胜利后缝隙收起 + 高亮描边 + 彩带） */}
      <div
        className={`relative mx-auto grid w-full max-w-[268px] grid-cols-3 overflow-hidden rounded-2xl bg-[#f6f1e8] transition-all duration-500 ${
          won ? 'gap-0 p-0 shadow-[0_0_0_4px_rgba(244,179,194,0.55)]' : 'gap-1.5 p-1.5 shadow-inner'
        } ${!img ? 'animate-pulse' : ''}`}
      >
        {order.map((piece, cell) => (
          <motion.button
            layout
            key={piece}
            type="button"
            onClick={() => tap(cell)}
            aria-label={`拼图第 ${cell + 1} 格`}
            className={`relative aspect-square transition-shadow ${won ? 'cursor-default' : 'cursor-pointer'} ${
              sel === cell && !won ? 'z-10 ring-[3px] ring-inset ring-[#f4b3c2]' : ''
            }`}
            style={{
              backgroundImage: img ? `url(${img})` : undefined,
              backgroundSize: '300% 300%',
              backgroundPosition: `${(piece % N) * 50}% ${Math.floor(piece / N) * 50}%`,
            }}
          >
            {sel === cell && !won && <span className="absolute inset-0 bg-white/25" />}
          </motion.button>
        ))}
        {/* 彩带粒子 */}
        {won && (
          <div className="pointer-events-none absolute inset-0 z-10 overflow-visible">
            {confetti.map((c, i) => (
              <motion.span
                key={i}
                className="absolute top-0 rounded-sm"
                style={{ left: `${c.x}%`, width: c.w, height: c.w * 0.45, background: c.color }}
                initial={{ y: -24, opacity: 1, rotate: c.rot }}
                animate={{ y: 320, opacity: [1, 1, 0], rotate: c.rot + 240 }}
                transition={{ duration: c.dur, delay: c.delay, ease: 'easeIn' }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 胜利结算 */}
      <AnimatePresence>
        {won && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 flex flex-col items-center gap-1.5"
          >
            <div className="flex items-center gap-2 text-[16px] font-semibold text-[#3a3a3e]">
              <PartyPopper className="h-5 w-5 text-[#e8899a]" />
              拼好啦！
            </div>
            <div className="text-[12px] text-[#9a9a96]">
              用时 {fmt(secs)} · {moves} 步
            </div>
            <button
              onClick={onClose}
              className="mt-1 flex h-11 items-center gap-2 rounded-full bg-[#f4b3c2] px-7 text-[14px] font-semibold text-white shadow-lg shadow-[#f4b3c2]/40 transition active:scale-95"
            >
              收好回忆
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {!won && img && <div className="mt-3 text-center text-[11px] text-[#c8c8c4]">提示：点一下选中，再点另一块交换</div>}
    </>
  );
}

export default function PuzzleGame({ open, onClose, photo }: PuzzleGameProps) {
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
            <PuzzleBoard onClose={onClose} photo={photo} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
