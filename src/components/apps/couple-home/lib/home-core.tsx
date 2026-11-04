'use client';

/**
 * 拾光小屋 —— 共享常量 / 纯函数 / 小型 UI 件（从 CoupleHome.tsx 原样搬移，逻辑零变化）
 *
 * - 编辑模式常量（旋转/俯仰/升降步进、撤销栈上限、毛玻璃操作条样式、装修快照 EditSnap）
 * - 宠物状态纯函数（衰减/清洗/等级）与互动按钮定义、头像 SVG、PetActionButton
 * - 拍照压缩、调色盘预设、套装兜底图标、朝向换算、家具动作锚点 anchorOf
 * - 装修面板单行选色 ColorRow、相片窗宽高比、猫窝换色精选色
 */

import {
  Armchair,
  ArrowDownToLine,
  Bath,
  BedDouble,
  BookOpen,
  Circle,
  Coffee,
  CupSoda,
  Flame,
  Heart,
  HeartHandshake,
  Moon,
  PawPrint,
  RefreshCw,
  Sparkles,
  UtensilsCrossed,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CATALOG } from '../catalog';
import type { CharAction, CharPose, FurnitureItem, Pet2State, PetCareKind, PetState } from '../types';

/** 洗衣一轮时长（秒） */
export const WASH_SECONDS = 30;

/** 水平旋转步进（弧度，45°） */
export const YAW_STEP = Math.PI / 4;
/** 俯仰旋转步进（弧度，15°） */
export const TILT_STEP = Math.PI / 12;
/** 升降步进（米）：把小家具抬上桌 / 放回地面 */
export const LIFT_STEP = 0.23;
export const LIFT_MAX = 2.05;

/** 相片窗宽高比：按框型裁剪（立式/挂墙竖版 3:4 偏竖、横版 5:3、拍立得 1:1） */
export const PHOTO_ASPECTS: Record<string, number> = {
  photoFrame: 0.4 / 0.56,
  photoWall: 0.46 / 0.6,
  photoWallWide: 1.0 / 0.6,
  polaroid: 1,
};

// ---------------- 宠物「团子」状态（v6.9） ----------------

const clamp01x = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/** 随真实时间衰减：体力 -4/h、清洁 -3/h、心情 -6/h（最多追算 48h，回访不会一贫如洗） */
export function decayPet(p: PetState, now = Date.now()): PetState {
  const h = Math.max(0, Math.min(48, (now - p.ts) / 3.6e6));
  return {
    name: p.name,
    st: Math.round(clamp01x(p.st - h * 4)),
    cl: Math.round(clamp01x(p.cl - h * 3)),
    mo: Math.round(clamp01x(p.mo - h * 6)),
    ts: now,
    // v8.3 成长/毛色/装扮字段原样透传（衰减不丢档）
    since: p.since,
    care: p.care,
    coat: p.coat,
    wear: p.wear,
  };
}

/** 读档/默认清洗：缺省值 + 名字截断 + 按最后结算时间补衰减 */
export function sanitizePet(raw?: PetState): PetState {
  const base: PetState = {
    name: (raw?.name || '团子').slice(0, 8),
    st: raw?.st ?? 88,
    cl: raw?.cl ?? 80,
    mo: raw?.mo ?? 90,
    ts: raw?.ts ?? Date.now(),
    since: raw?.since ?? Date.now(), // v8.3 成长系统：默认从现在开始陪伴
    care: raw?.care ?? 0,
    coat: raw?.coat,
    wear: raw?.wear,
  };
  return decayPet(base);
}

/** 宠物毛色清洗（白名单） */
export function sanitizePet2(raw?: Pet2State): Pet2State | undefined {
  if (!raw || (raw.kind !== 'dog' && raw.kind !== 'rabbit')) return undefined;
  return {
    kind: raw.kind,
    name: raw.name?.slice(0, 8),
    since: raw.since ?? Date.now(),
    care: raw.care ?? 0,
    coat: raw.coat,
    wear: raw.wear,
    st: raw.st ?? 88,
    cl: raw.cl ?? 88,
    mo: raw.mo ?? 90,
    ts: raw.ts ?? Date.now(),
  };
}

/** v9 领养宠物列表清洗（可领养无数只；兼容旧单只 pet2 字段） */
export function sanitizePets2(raw?: Pet2State[] | Pet2State): Pet2State[] {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return arr.map(sanitizePet2).filter((p): p is Pet2State => !!p).slice(0, 24);
}

// ---------------- v8.3 成长系统（F：陪伴天数 + 照顾次数 → 等级解锁小把戏） ----------------

/** 成长解锁的小把戏（达到 Lv 后出现在互动按钮里） */
export const PET_TRICK_DEFS: { kind: PetCareKind; label: string; lvl: number; icon: LucideIcon }[] = [
  { kind: 'shake', label: '握手', lvl: 2, icon: Heart },
  { kind: 'spin', label: '转圈', lvl: 3, icon: RefreshCw },
  { kind: 'roll', label: '打滚', lvl: 5, icon: Circle },
  { kind: 'dead', label: '装死', lvl: 7, icon: Moon },
];

/** 宠物等级：1 + 陪伴天数/2 + 累计照顾次数/6（封顶 Lv.9） */
export function petLevelOf(p: PetState): number {
  const days = Math.max(0, Math.floor((Date.now() - (p.since ?? Date.now())) / 864e5));
  return Math.min(9, 1 + Math.floor(days / 2) + Math.floor((p.care ?? 0) / 6));
}

/** 当前等级到下一级还差几次照顾（升级进度用） */
export function petLevelGap(p: PetState): { days: number; lvl: number; inLvl: number; need: number } {
  const days = Math.max(0, Math.floor((Date.now() - (p.since ?? Date.now())) / 864e5));
  const score = days / 2 + (p.care ?? 0) / 6;
  const lvl = Math.min(9, 1 + Math.floor(score));
  const inLvl = Math.min(1, score - Math.floor(score));
  return { days, lvl, inLvl, need: Math.max(1, Math.ceil((1 - inLvl) * 6)) };
}

/** 宠物互动按钮（v7.1 右侧竖条）：六种照顾动作（bg 已废弃 —— 按钮无彩色底，仅保留彩色图标） */
export const PET_ACTIONS: { kind: PetCareKind; icon: LucideIcon; label: string; fg: string }[] = [
  { kind: 'pat', icon: PawPrint, label: '抚摸', fg: '#d96a86' },
  { kind: 'feed', icon: UtensilsCrossed, label: '喂食', fg: '#c98a3e' },
  { kind: 'water', icon: CupSoda, label: '喂水', fg: '#4a90c9' },
  { kind: 'bath', icon: Bath, label: '洗澡', fg: '#3e97b4' },
  { kind: 'hug', icon: HeartHandshake, label: '抱抱', fg: '#d96a86' },
  { kind: 'summon', icon: Sparkles, label: '召唤', fg: '#8a7ab0' },
];

/**
 * 猫头图标（v7.1 内联 SVG，替代 emoji）：奶油猫头 + 耳朵内廓 + 豆豆眼 + 粉鼻 + w 嘴 + 腮红 + 红项圈金铃铛，
 * 与 3D 小猫同款配色；HUD 头像与状态面板共用。
 */
export function CatFaceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      {/* 耳朵（先画，压在头后） */}
      <path d="M10 20 Q6.5 8 8.5 6.5 Q10.5 5.5 19 12.5 Z" fill="#fdf8ee" stroke="#eadbc4" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M38 20 Q41.5 8 39.5 6.5 Q37.5 5.5 29 12.5 Z" fill="#fdf8ee" stroke="#eadbc4" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11 16.5 Q9.5 10 10.5 9 Q11.5 8.5 16 12.5 Z" fill="#f6c2ca" />
      <path d="M37 16.5 Q38.5 10 37.5 9 Q36.5 8.5 32 12.5 Z" fill="#f6c2ca" />
      {/* 脸（奶油圆） */}
      <ellipse cx="24" cy="26.5" rx="16" ry="13.5" fill="#fdf8ee" stroke="#eadbc4" strokeWidth="1.4" />
      {/* 豆豆眼 + 高光 */}
      <ellipse cx="17.5" cy="25" rx="2.1" ry="2.5" fill="#3a3230" />
      <ellipse cx="30.5" cy="25" rx="2.1" ry="2.5" fill="#3a3230" />
      <circle cx="18.2" cy="24.2" r="0.7" fill="#ffffff" />
      <circle cx="31.2" cy="24.2" r="0.7" fill="#ffffff" />
      {/* 粉鼻 + w 嘴 */}
      <path d="M22.4 30.4 L25.6 30.4 L24 32.2 Z" fill="#e89aa4" />
      <path d="M24 32.2 Q24 33.8 22.2 33.8 M24 32.2 Q24 33.8 25.8 33.8" fill="none" stroke="#c98d7e" strokeWidth="1.1" strokeLinecap="round" />
      {/* 腮红 */}
      <ellipse cx="12.5" cy="29.5" rx="2.6" ry="1.7" fill="#f6bfc6" opacity="0.8" />
      <ellipse cx="35.5" cy="29.5" rx="2.6" ry="1.7" fill="#f6bfc6" opacity="0.8" />
      {/* 胡须 */}
      <g stroke="#d9c9b4" strokeWidth="1" strokeLinecap="round">
        <path d="M7.5 24.5 L3.5 23.5" />
        <path d="M7.5 27.5 L3.5 28.5" />
        <path d="M40.5 24.5 L44.5 23.5" />
        <path d="M40.5 27.5 L44.5 28.5" />
      </g>
      {/* 红项圈 + 金铃铛（呼应 3D 小猫） */}
      <path d="M14 37.5 Q24 41.5 34 37.5" fill="none" stroke="#e46a6a" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="24" cy="40.5" r="2.1" fill="#f4c34e" stroke="#d9a13c" strokeWidth="0.7" />
    </svg>
  );
}

/** v9 小狗头像（HUD 宠物头像轮换用；风格与猫头一致：豆豆眼 + 腮红） */
export function DogFaceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <path d="M10 24 Q4 20 6 12 Q7 8 12 11 Q17 14 18 22 Z" fill="#d9bd90" stroke="#c9a877" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M38 24 Q44 20 42 12 Q41 8 36 11 Q31 14 30 22 Z" fill="#d9bd90" stroke="#c9a877" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="24" cy="26" r="14" fill="#e8d3ae" stroke="#d9bd90" strokeWidth="1.4" />
      <ellipse cx="24" cy="31" rx="6.5" ry="5" fill="#f6ecd8" />
      <circle cx="24" cy="29.5" r="2.3" fill="#3a3230" />
      <circle cx="19" cy="24" r="1.7" fill="#3a3230" />
      <circle cx="29" cy="24" r="1.7" fill="#3a3230" />
      <circle cx="15.5" cy="30" r="2" fill="#f6bfc6" opacity="0.7" />
      <circle cx="32.5" cy="30" r="2" fill="#f6bfc6" opacity="0.7" />
    </svg>
  );
}

/** v9 小兔子头像（HUD 宠物头像轮换用；长耳 + 内耳粉） */
export function RabbitFaceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <ellipse cx="17" cy="13" rx="4.6" ry="10.5" fill="#f8f6f2" stroke="#e8e2d8" strokeWidth="1.4" transform="rotate(-8 17 13)" />
      <ellipse cx="31" cy="13" rx="4.6" ry="10.5" fill="#f8f6f2" stroke="#e8e2d8" strokeWidth="1.4" transform="rotate(8 31 13)" />
      <ellipse cx="17" cy="14" rx="2.2" ry="6.5" fill="#f3c9d4" transform="rotate(-8 17 14)" />
      <ellipse cx="31" cy="14" rx="2.2" ry="6.5" fill="#f3c9d4" transform="rotate(8 31 14)" />
      <circle cx="24" cy="30" r="13" fill="#f8f6f2" stroke="#e8e2d8" strokeWidth="1.4" />
      <circle cx="24" cy="32.5" r="1.8" fill="#e89aa4" />
      <circle cx="19.5" cy="28" r="1.6" fill="#3a3230" />
      <circle cx="28.5" cy="28" r="1.6" fill="#3a3230" />
      <circle cx="16" cy="33" r="1.9" fill="#f6bfc6" opacity="0.7" />
      <circle cx="32" cy="33" r="1.9" fill="#f6bfc6" opacity="0.7" />
    </svg>
  );
}

/**
 * 宠物互动按钮（v7.2 面板下方 & 右侧竖条共用）：白玻璃胶囊 + 彩色图标 + 小字标签（无彩色底）。
 * 抱抱按钮在「抱着」时变「放下」（图标 ArrowDownToLine），点一下即可把小猫放到地上。
 */
export function PetActionButton({
  kind,
  icon: Icon,
  label,
  fg,
  carrying,
  disabled,
  onClick,
}: {
  kind: PetCareKind;
  icon: LucideIcon;
  label: string;
  fg: string;
  carrying: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const isHug = kind === 'hug';
  const dropped = isHug && carrying;
  const Icn = dropped ? ArrowDownToLine : Icon;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dropped ? '放下宠物' : `${label}宠物`}
      className={`flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-full bg-white/70 dark:bg-zinc-900/70 shadow-md ring-1 ring-white/70 dark:ring-white/15 backdrop-blur-md transition active:scale-90 disabled:cursor-not-allowed ${
        disabled && !dropped ? 'opacity-40' : ''
      }`}
    >
      <Icn className="h-[17px] w-[17px]" style={{ color: fg }} />
      <span className="text-[8.5px] font-bold leading-none" style={{ color: fg }}>
        {dropped ? '放下' : label}
      </span>
    </button>
  );
}

/**
 * 手机照片 → 居中裁到指定比例 → 压成 JPEG dataURL（几十 KB，可永久存在小家档案里）
 */
export function compressPhoto(file: File, aspect: number, maxH = 520, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const finish = (fn: () => void) => {
      URL.revokeObjectURL(url);
      fn();
    };
    img.onload = () => {
      try {
        let cw = img.width;
        let ch = img.height;
        if (cw / ch > aspect) cw = Math.round(ch * aspect);
        else ch = Math.round(cw / aspect);
        const sx = (img.width - cw) / 2;
        const sy = (img.height - ch) / 2;
        const scale = Math.min(1, maxH / ch);
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(cw * scale));
        cv.height = Math.max(1, Math.round(ch * scale));
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, sx, sy, cw, ch, 0, 0, cv.width, cv.height);
        const data = cv.toDataURL('image/jpeg', quality);
        finish(() => resolve(data));
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error('compress-fail')));
      }
    };
    img.onerror = () => finish(() => reject(new Error('img-load-fail')));
    img.src = url;
  });
}

/** 调色盘预设（白色为主 + 可混搭的点缀色） */
export const SWATCHES: { hex: string; name: string }[] = [
  { hex: '#ffffff', name: '云白' },
  { hex: '#f6f1e7', name: '奶油' },
  { hex: '#e3e1db', name: '浅灰' },
  { hex: '#43464b', name: '柔黑' },
  { hex: '#f6cdd6', name: '浅粉' },
  { hex: '#f2b3c2', name: '樱粉' },
  { hex: '#f9e6a6', name: '浅黄' },
  { hex: '#c9e3cf', name: '抹茶' },
  { hex: '#d9e0e6', name: '雾灰蓝' },
  { hex: '#dcd2ec', name: '雾紫' },
];

/** E7 灯光颜色预设（调色盘「灯光颜色」行：暖黄/奶白/玫粉/天青/星绿/梦紫） */
export const LIGHT_SWATCHES: { hex: string; name: string }[] = [
  { hex: '#ffd9a0', name: '暖黄' },
  { hex: '#fff2dc', name: '奶白' },
  { hex: '#ffb3c6', name: '玫粉' },
  { hex: '#a8d8e8', name: '天青' },
  { hex: '#b8e6c9', name: '星绿' },
  { hex: '#d4b8e8', name: '梦紫' },
];

/** F3 套装卡片兜底线性图标（lucide；真实 3D 整组合成缩略图生成前的占位） */
export const SET_FALLBACK: Record<string, LucideIcon> = {
  bedSet: BedDouble,
  sofaSet: Armchair,
  studySet: BookOpen,
  teaCorner: Coffee,
  balconySet: Flame,
};

export const dirToHeading: Record<string, number> = { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 };

/** 装修面板单行选色（色卡 + 自定义 + 默认），地板/墙/门/窗共用 */
export function ColorRow({
  label,
  value,
  onPick,
  fallback,
}: {
  label: string;
  value?: string;
  onPick: (hex: string | null) => void;
  fallback: string;
}) {
  const validHex = /^#[0-9a-fA-F]{6}$/.test(value ?? '');
  return (
    <div className="mb-3.5 last:mb-0">
      <div className="mb-1 text-[12.5px] font-medium text-[#6a6a6e] dark:text-zinc-300">{label}</div>
      <div className="mb-2 grid grid-cols-5 gap-2.5">
        {SWATCHES.map((s) => (
          <button
            key={s.hex}
            onClick={() => onPick(s.hex)}
            title={s.name}
            aria-label={`${label}选色 ${s.name}`}
            className="group flex flex-col items-center gap-1"
          >
            <span
              className={
                value === s.hex
                  ? 'h-9 w-9 rounded-full ring-2 ring-[#f2a9bc] ring-offset-2 dark:ring-offset-zinc-900 shadow-md'
                  : 'h-9 w-9 rounded-full shadow-sm ring-1 ring-black/10 dark:ring-white/15 transition group-active:scale-90'
              }
              style={{ background: s.hex }}
            />
            <span className="text-[10px] text-[#8a8a86]">{s.name}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <label className="relative flex h-10 flex-1 cursor-pointer items-center gap-2.5 rounded-2xl bg-[#f6f4ef] px-3 ring-1 ring-[#eae7df]">
          <span
            className="h-6 w-6 rounded-lg shadow-inner ring-1 ring-black/10"
            style={{
              background: validHex
                ? value
                : 'conic-gradient(#f6cdd6,#f9e6a6,#c9e3cf,#dcd2ec,#f6cdd6)',
            }}
          />
          <span className="text-[12px] font-medium text-[#4a4a4e]">自定义{label}色</span>
          <input
            type="color"
            aria-label={`自定义${label}颜色`}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={validHex ? value : fallback}
            onChange={(e) => onPick(e.target.value)}
          />
        </label>
        <button
          onClick={() => onPick(null)}
          className="flex h-10 items-center rounded-2xl bg-[#f1efe9] px-3.5 text-[12px] font-medium text-[#8a8a86] transition active:scale-95"
        >
          默认
        </button>
      </div>
    </div>
  );
}

export function headingToDir(h: number): 'up' | 'down' | 'left' | 'right' {
  const deg = ((((h * 180) / Math.PI) % 360) + 360) % 360;
  if (deg >= 315 || deg < 45) return 'down';
  if (deg >= 45 && deg < 135) return 'right';
  if (deg >= 135 && deg < 225) return 'up';
  return 'left';
}

/** 角度归一到 [-π, π] */
export function normAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/** 家具动作 → 小人姿势（watch/work/game 也是坐姿；play 按乐器分流，见 act.pose；coffee 复用喝姿；read 专门看书姿势） */
export const POSE_OF_ACT: Record<CharAction['type'], CharPose> = {
  sit: 'sit',
  lie: 'lie',
  bath: 'bath',
  shower: 'shower',
  watch: 'sit',
  work: 'sit',
  cook: 'cook',
  eat: 'eat',
  drink: 'drink',
  play: 'sit',
  makeup: 'makeup',
  mirror: 'mirror',
  dress: 'stand',
  game: 'sit',
  hotpot: 'eat',
  coffee: 'drink',
  read: 'read',
};

/** 自动结束型动作（走到位后定时完成；退出重进时不恢复） */
export const AUTO_ACTS: ReadonlySet<CharAction['type']> = new Set(['cook', 'drink', 'dress', 'coffee']);

/** 动作按钮文案：[待开始, 进行中] */
export const ACT_LABELS: Record<CharAction['type'], [string, string]> = {
  sit: ['坐下', '站起来'],
  lie: ['睡觉', '起床'],
  bath: ['泡个澡', '出来啦'],
  shower: ['冲个澡', '出来啦'],
  watch: ['看电视', '关电视'],
  work: ['上网', '休息一下'],
  cook: ['做一顿饭', '不做了'],
  eat: ['开饭', '吃饱啦'],
  drink: ['喝一杯', '放下杯子'],
  dress: ['换套衣服', '换好啦'],
  play: ['演奏一曲', '演奏结束'],
  makeup: ['化个妆', '化好啦'],
  mirror: ['照照镜子', '照好啦'],
  game: ['打游戏', '不玩啦'],
  hotpot: ['开涮火锅', '吃饱啦'],
  coffee: ['端一杯咖啡', '放下杯子'],
  read: ['抽本书读', '合上书'],
};

/**
 * 由动作类型 + 家具实例算出完整动作参数（落点/朝向/支撑面/起身落点）。
 * 起身落点默认沿「背对所面对象」方向留出一步：躺床从床尾下、坐椅向房内跨一步、
 * 看电视/上网/做饭/喝东西等面向家具的动作向后离屏；目录锚点可用 out 显式指定。
 * ⚑ 面向家具型动作（watch/work/cook/…）小人朝向 = 家具朝向 + π（脸对着家具）。
 */
export const FACE_ACTS: ReadonlySet<CharAction['type']> = new Set([
  'watch', 'work', 'cook', 'eat', 'drink', 'dress', 'play', 'makeup', 'mirror', 'coffee',
]);

export function anchorOf(type: CharAction['type'], item: FurnitureItem): CharAction | null {
  const entry = CATALOG[item.kind];
  const a =
    type === 'sit'
      ? entry?.acts.seat
      : type === 'lie'
        ? entry?.acts.sleep
        : type === 'bath' || type === 'shower'
          ? entry?.acts.bath
          : type === 'watch'
            ? entry?.acts.watch
            : type === 'cook'
              ? entry?.acts.cook
              : type === 'eat'
                ? entry?.acts.eat
                : type === 'drink'
                  ? entry?.acts.drink
                  // read 的 itemId 是「沙发/椅子」本身：锚点复用 seat 配置
                  : type === 'read'
                    ? entry?.acts.seat
                    : type === 'coffee'
                      ? entry?.acts.coffee
                      : type === 'dress'
                        ? entry?.acts.dress
                        : type === 'play'
                          ? entry?.acts.play
                          : type === 'makeup'
                            ? entry?.acts.makeup
                            : type === 'mirror'
                              ? entry?.acts.mirror
                              : type === 'hotpot'
                                ? entry?.acts.hotpot
                                : type === 'game'
                                  ? entry?.acts.game
                                  : entry?.acts.work;
  if (!a) return null;
  // 目录锚点统一形状（各 act 是同一形状的子集，字段可选）
  const an = a as {
    y: number;
    dx?: number;
    dz?: number;
    ryOff?: number;
    out?: [number, number];
  };
  const ry0 = item.ry ?? 0;
  const ry = ry0 + (an.ryOff ?? 0) + (FACE_ACTS.has(type) ? Math.PI : 0);
  const cos = Math.cos(ry0);
  const sin = Math.sin(ry0);
  const lx = an.dx ?? 0;
  let lz = an.dz ?? 0;
  // 写实小人腿长（≈0.78×身高）：坐在座面锚点时大腿会伸进座垫深处。
  // 坐姿系（sit/read）把锚点夹到座面前缘内 0.16m，让大腿探出前缘、小腿自然垂在沙发外。
  if ((type === 'sit' || type === 'read') && !an.out) {
    const fpD = entry?.fp?.[1] ?? 0;
    lz = Math.min(lz, fpD / 2 - 0.16);
  }
  const back = type === 'lie' ? -1.45 : type === 'bath' ? 0.95 : 0.55;
  const out: [number, number] = an.out ?? [lx, lz + back];
  return {
    type,
    itemId: item.id,
    tx: item.x + lx * cos + lz * sin,
    tz: item.z - lx * sin + lz * cos,
    ry,
    y: a.y ?? 0,
    ox: item.x + out[0] * cos + out[1] * sin,
    oz: item.z - out[0] * sin + out[1] * cos,
    // play 按乐器分流姿势（钢琴坐姿 / 吉他站姿）；read 用专门的看书坐姿
    pose:
      type === 'play'
        ? item.kind === 'piano'
          ? 'piano'
          : 'guitar'
        : type === 'read'
          ? 'read'
          : undefined,
  };
}

export interface Toast {
  id: number;
  msg: string;
}

/** 装修快照：一次装修操作（放置/收起/移动/旋转/升降/换色/门窗调整）前的完整可编辑状态 */
export interface EditSnap {
  items: FurnitureItem[];
  winExist?: boolean[];
  winPos?: number[];
  doorPos?: { bed: number; kt: number; bath: number; bal?: number };
  winCol?: string;
  doorCol?: string;
  floorCol?: string;
  wallCol?: string;
  floorColBed?: string;
  wallColBed?: string;
  floorColK?: string;
  wallColK?: string;
  floorColB?: string;
  wallColB?: string;
  ceilCol?: string;
  ceilColBed?: string;
  ceilColK?: string;
  ceilColB?: string;
  floorColBal?: string;
  wallColBal?: string;
  floorTex: 'plain' | 'wood' | 'check';
  wallTex: 'plain' | 'dot' | 'stripe';
}

/** 撤销栈深度上限（步） */
export const HIST_MAX = 60;
/** 连续手势合并时间窗（ms）：拖拽帧/快速连点并入栈顶同一步 */
export const HIST_COALESCE = 900;

/** 编辑模式操作条：毛玻璃胶囊容器质感 */
export const EDIT_GLASS =
  'border border-white/70 dark:border-white/15 bg-white/55 dark:bg-zinc-900/70 shadow-[0_10px_28px_rgba(90,70,60,0.20)] backdrop-blur-2xl';
/** 毛玻璃方向盘小圆钮（移动 · 按下泛绿） */
export const editDirBtn =
  'flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[#77766e] dark:text-zinc-300 shadow-sm ring-1 ring-white/60 dark:ring-white/15 transition active:scale-90 active:bg-[#dff0e2] active:text-[#3f9a58]';
/** 同上（升降 · 按下泛蓝） */
export const editDirBtnBlue =
  'flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[#77766e] dark:text-zinc-300 shadow-sm ring-1 ring-white/60 dark:ring-white/15 transition active:scale-90 active:bg-[#e2edf3] active:text-[#4e7f95]';
/** 同上（旋转 · 按下泛暖沙） */
export const editDirBtnAmber =
  'flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[#77766e] dark:text-zinc-300 shadow-sm ring-1 ring-white/60 dark:ring-white/15 transition active:scale-90 active:bg-[#f5efe2] active:text-[#8a7a54]';

// ---------------- v11 H3 猫窝换色：12 个精选色 ----------------

export const PET_BED_COLORS: { name: string; hex: string }[] = [
  { name: '樱粉', hex: '#f4c2ce' },
  { name: '奶油', hex: '#f5e6c8' },
  { name: '天蓝', hex: '#a8d8e8' },
  { name: '薄荷', hex: '#bfe3d0' },
  { name: '鹅黄', hex: '#f7e3a1' },
  { name: '杏橘', hex: '#f5c9a2' },
  { name: '藕紫', hex: '#d8c3e0' },
  { name: '雾蓝', hex: '#b8c6dd' },
  { name: '奶白', hex: '#f7f3ea' },
  { name: '浅棕', hex: '#d9bfa8' },
  { name: '玫紫', hex: '#c98bb9' },
  { name: '炭黑', hex: '#4a4a50' },
];

/** 操作按钮通用样式（编辑模式各操作条共用） */
export const toolBtn = 'flex h-9 w-9 items-center justify-center rounded-full transition active:scale-90';
