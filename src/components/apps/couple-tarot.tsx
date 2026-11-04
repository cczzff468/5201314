'use client';

/**
 * 情侣空间「爱情塔罗」· 浅色毛玻璃风 + 真实牌面图（第四十九轮）。
 *
 * 流程：选主题（预设 + 自定义问题）→ 洗牌（牌堆散乱铺开；点击牌堆=重新打乱 / 长按持续洗牌；
 * 「切牌」按钮=先整叠整齐再上下左右四叠分开合拢，可无限切牌；「下一步」进入）→ 选牌阵（13 种经典牌阵）→
 * 排位页（牌位布局独占全屏，展示进度与当前待填牌位，点「去选第 N 张牌」）→ 牌轮页（独立全屏界面：大标题为
 * 牌位名，大幅扇形牌轮从右下角外辐射展开，滑动/双指缩放/点选）→ 选完自动回到排位页看牌飞入牌位，
 * 交替往复直到选满 → 翻牌（逐张 3D 翻开）→ AI 纯塔罗解读 → 结果 / 历史。
 *
 * 第四十九轮变更：
 * - 洗牌：牌堆默认散乱铺开（参考 quin 洗牌页），点击牌堆随时重新打乱；
 * - 切牌：「再洗一次」按钮移除，改为「切牌」——先把牌整叠整齐，再按上/右/下/左四叠分开、停顿、
 *   合拢（可无限切，每方向随机错位），完成后「下一步」选牌阵；
 * - 选牌拆成「排位页 / 牌轮页」两个独立界面交替：排位页全屏展示牌阵布局与进度，牌轮页全屏展示扇形牌轮，
 *   点牌后回到排位页、牌从点击处飞入牌位，再点「去选第 N 张牌」进入下一张；
 * - 牌轮：大幅扇形（轮心在右下角屏外，78 张沿圆环切线铺开，牌顶指向圆外呈放射状），滑动旋转 + 双指缩放；
 * - 牌背：白灰底 + 极淡星座连线纹理（参考 quin 牌背）。
 *
 * 第五十一轮变更：
 * - 牌面换装：/tarot/deck/ 78 张换为 reginanka 深蓝金拱门牌组（"Tarot Cards WebP Collection"
 *   by reginanka, CC BY 4.0, github.com/reginanka/tarot-cards；WebP 裁掉底部标题条带后转 JPG，
 *   马赛序 m08/m11 已按 RWS 序互换；源 m20「审判」误图已 AI 按同风格补绘），署名见
 *   public/tarot/DECK-CREDITS.txt；加载失败仍退回原 sprite/SVG 线稿；
 * - 牌面配色随牌组换装：CardFace 名牌条/罗马数字章/边框改深蓝夜空底 + 香槟金文字（牌背不变）。
 *
 * 第五十四轮变更：
 * - 幽灵 click 防护由 600ms 时间窗改为「事件配对（arming）」确定性方案：根容器
 *   onPointerDownCapture / onKeyDownCapture 先武装，click 配对消费后解除；无手势来源的
 *   click（牌轮选牌切页后浏览器补发的那次）一律按幽灵吞掉——不依赖时钟，延迟再久也拦得住，
 *   也不再误吞用户在 600ms 内的快速真实操作；pickGuard 时间戳与牌位侧双保险随之移除。
 *
 * 第五十三轮变更：
 * - 修复「选完第 2/3 张牌后先前牌位被清空、要求重选」：牌轮用 pointerup 选牌，切页后浏览器
 *   补发的 click 会被重新命中到排位页同位置元素（牌位/按钮）——第 1 次选牌时牌位全空无感，
 *   之后随机发作；全部牌阵通用（根因在切页衔接，不在具体牌阵）。
 *
 * 第五十二轮变更：
 * - 「塔罗解读」标题图标美化：文字符号「☾」圆章改为深蓝夜空渐变徽章（金线描边 + 顶部内高光），
 *   内置香槟金 MoonStar 细线图标，与 reginanka 深蓝金牌面同源呼应；结果页与历史详情页共用。
 *
 * - 牌库与牌阵：src/lib/tarot-deck.ts（大阿尔卡那 22 + 小阿尔卡那 56，含正逆位牌意）；
 * - 持久化：state.tarotReadings[contactId]（按恋人联系人 ID 隔离，随 couple-space:state 落 IndexedDB，重启可查）；
 * - 记忆：解读完成后 coupleTarotRemember 写入恋人（AI）记忆（sourceTag='couple-tarot'，仅记录事件，解读不用记忆）；
 * - 动画：globals.css tarot-* keyframes；牌轮用 CSS 变量（--wa 角度 / --ws 缩放）驱动，一次样式写全牌生效。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, MoonStar, Star, Trash2 } from 'lucide-react';
import {
  TAROT_FULL_DECK,
  TAROT_SPREADS,
  tarotCardById,
  tarotSpreadByKey,
  type SpreadPos,
  type TarotCardDef,
  type TarotReading,
  type TarotSpread,
  type TarotSuit,
  type TarotTheme,
} from '@/lib/tarot-deck';
import { aiTarotReading, coupleTarotRemember, type TarotAiCard } from '@/lib/ios/couple-ai';
import { readInviteMeta } from '@/lib/ios/couple-invite';
import type { CoupleState } from './couple-space';

// ---------------- 预设主题（问什么；牌阵洗牌后单独选） ----------------

const THEMES: TarotTheme[] = [
  { key: 'love', label: '恋爱运势', desc: '看看你们恋爱的整体能量' },
  { key: 'state', label: '当前状态', desc: '这段关系此刻的真实状况' },
  { key: 'hismind', label: 'TA 的想法', desc: 'TA 心里真实的念头' },
  { key: 'future', label: '关系走向', desc: '这段关系会往哪里去' },
  { key: 'custom', label: '自定义问题', desc: '写下你最想问的问题', custom: true },
];

// ---------------- 工具 ----------------

function cutText(s: string, max: number): string {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function fmtTs(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/** AI 失败时的本地兜底解读（牌位 + 牌意直出，语气平实） */
function fallbackReading(positions: SpreadPos[], cards: { def: TarotCardDef; reversed: boolean }[]): { per: string[]; overall: string } {
  const per = cards.map((c, i) => `【${positions[i]?.label ?? '牌面'}】${c.def.name}（${c.reversed ? '逆位' : '正位'}）——${c.reversed ? c.def.reversed : c.def.upright}`);
  const overall = `整副牌落在「${cards.map((c) => (c.reversed ? c.def.revKeys : c.def.upKeys).split(' · ')[0]).join('、')}」这些能量上。顺着牌面的提示走，答案已经在你手里了。`;
  return { per, overall };
}

// ---------------- 卡背 / 卡面 / 3D 翻牌（第四十九轮：真实牌面图 + 星座纹牌背） ----------------

const INK = '#43392b'; // 复古炭墨

/** 大阿尔卡那 → majors.png（6 列 × 4 行）网格位置；恋人 / 倒吊人走 patch.png 左右半（线稿兜底用） */
const MAJOR_SPRITE: Record<number, [number, number]> = {
  0: [0, 0], 1: [1, 0], 2: [2, 0], 3: [3, 0], 4: [4, 0], 5: [5, 0],
  7: [1, 1], 8: [2, 1], 9: [3, 1], 10: [4, 1], 11: [5, 1],
  13: [1, 2], 14: [2, 2], 15: [3, 2], 16: [4, 2], 17: [5, 2],
  18: [5, 3], 19: [0, 3], 20: [1, 3], 21: [2, 3],
};

/** 大阿尔卡那中央插画（兜底）：sprite 按格裁切 */
function MajorArt({ idx }: { idx: number }) {
  const cell = MAJOR_SPRITE[idx];
  const base: CSSProperties = { width: '100%', height: '100%', display: 'block' };
  if (cell) {
    const [c, r] = cell;
    return (
      <div
        style={{
          ...base,
          backgroundImage: 'url(/tarot/majors.png)',
          backgroundSize: '600% 400%',
          backgroundPosition: `${(c / 5) * 100}% ${(r / 3) * 100}%`,
        }}
      />
    );
  }
  // 恋人(6) / 倒吊人(12)：patch.png 左右两半
  return (
    <div
      style={{
        ...base,
        backgroundImage: 'url(/tarot/patch.png)',
        backgroundSize: '200% 100%',
        backgroundPosition: idx === 6 ? '0% 0%' : '100% 0%',
      }}
    />
  );
}

/** 小阿尔卡那花色线稿符号（权杖 / 圣杯 / 宝剑 / 星币，兜底用） */
function SuitGlyph({ suit, size, stroke = 1.6 }: { suit: TarotSuit; size: number; stroke?: number }) {
  const s = { stroke: INK, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
      {suit === 'wands' && (
        <>
          <path d="M12 21V3.5" {...s} />
          <path d="M12 9C9.4 8.5 7.7 6.7 7.5 3.8c2.9.2 4.6 1.9 5 4.6" {...s} />
          <path d="M12 14c2.6-.5 4.3-2.3 4.5-5.2-2.9.2-4.6 1.9-5 4.6" {...s} />
          <path d="M9.2 21h5.6" {...s} />
        </>
      )}
      {suit === 'cups' && (
        <>
          <path d="M6.5 4h11c0 5-2.6 8-5.5 8S6.5 9 6.5 4z" {...s} />
          <path d="M12 12v6.2" {...s} />
          <path d="M9.4 18.2h5.2" {...s} />
          <path d="M7.8 21h8.4" {...s} />
        </>
      )}
      {suit === 'swords' && (
        <>
          <path d="M12 2.5 13.7 15h-3.4L12 2.5z" {...s} />
          <path d="M7 16.4h10" {...s} />
          <path d="M12 16.4V21" {...s} />
          <path d="M9.4 21h5.2" {...s} />
        </>
      )}
      {suit === 'pentacles' && (
        <>
          <circle cx="12" cy="12" r="8.4" {...s} />
          <path d="M12 6.6l1.7 3.5 3.8.5-2.8 2.6.8 3.8-3.5-2-3.5 2 .8-3.8-2.8-2.6 3.8-.5L12 6.6z" {...s} />
        </>
      )}
    </svg>
  );
}

/** 小阿尔卡那数字牌 pip 排布（经典扑克式阵位，0~1 单位坐标，兜底用） */
const PIP_LAYOUT: Record<string, [number, number][]> = {
  A: [[0.5, 0.5]],
  '2': [[0.5, 0.17], [0.5, 0.83]],
  '3': [[0.5, 0.13], [0.5, 0.5], [0.5, 0.87]],
  '4': [[0.29, 0.17], [0.71, 0.17], [0.29, 0.83], [0.71, 0.83]],
  '5': [[0.29, 0.15], [0.71, 0.15], [0.5, 0.5], [0.29, 0.85], [0.71, 0.85]],
  '6': [[0.29, 0.13], [0.71, 0.13], [0.29, 0.5], [0.71, 0.5], [0.29, 0.87], [0.71, 0.87]],
  '7': [[0.29, 0.13], [0.71, 0.13], [0.5, 0.315], [0.29, 0.5], [0.71, 0.5], [0.29, 0.87], [0.71, 0.87]],
  '8': [[0.29, 0.11], [0.71, 0.11], [0.29, 0.37], [0.71, 0.37], [0.29, 0.63], [0.71, 0.63], [0.29, 0.89], [0.71, 0.89]],
  '9': [[0.29, 0.11], [0.71, 0.11], [0.29, 0.37], [0.71, 0.37], [0.5, 0.5], [0.29, 0.63], [0.71, 0.63], [0.29, 0.89], [0.71, 0.89]],
  '10': [[0.29, 0.1], [0.71, 0.1], [0.5, 0.24], [0.29, 0.38], [0.71, 0.38], [0.29, 0.62], [0.71, 0.62], [0.5, 0.76], [0.29, 0.9], [0.71, 0.9]],
};

/** 小阿尔卡那中央图形（兜底）：数字牌 = pip 阵；宫廷牌 = 单个大花色符号 + 徽记 */
function MinorArt({ suit, numeral, w, h }: { suit: TarotSuit; numeral: string; w: number; h: number }) {
  const court = numeral === '侍从' || numeral === '骑士' || numeral === '王后' || numeral === '国王';
  if (court) {
    const mark = numeral === '侍从' ? '✦' : numeral === '骑士' ? '☾' : numeral === '王后' ? '☼' : '♛';
    return (
      <div className="relative flex h-full w-full items-center justify-center">
        <span className="absolute left-1/2 top-0 -translate-x-1/2 font-serif" style={{ color: INK, fontSize: Math.max(7, w * 0.13), lineHeight: 1.2 }}>{mark}</span>
        <SuitGlyph suit={suit} size={Math.min(w * 0.5, h * 0.4)} stroke={1.4} />
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap font-serif" style={{ color: INK, fontSize: Math.max(5.5, w * 0.1), letterSpacing: '0.14em' }}>{numeral}</span>
        <span className="absolute left-1 top-0.5" style={{ color: INK, fontSize: Math.max(4, w * 0.07) }}>✦</span>
        <span className="absolute right-1 bottom-0.5" style={{ color: INK, fontSize: Math.max(4, w * 0.07) }}>✦</span>
      </div>
    );
  }
  const pips = PIP_LAYOUT[numeral] ?? PIP_LAYOUT.A;
  const glyphW = numeral === 'A' ? Math.min(w * 0.44, h * 0.34) : numeral === '10' ? Math.min(w * 0.2, h * 0.15) : Math.min(w * 0.24, h * 0.18);
  return (
    <div className="relative h-full w-full">
      {pips.map(([px, py], i) => (
        <span key={i} className="absolute" style={{ left: `${px * 100}%`, top: `${py * 100}%`, transform: 'translate(-50%,-50%)' }}>
          <SuitGlyph suit={suit} size={glyphW} stroke={numeral === 'A' ? 1.5 : 1.3} />
        </span>
      ))}
    </div>
  );
}

/** 牌面图路径：/tarot/deck/ 78 张（reginanka 深蓝金拱门牌组，CC BY 4.0，署名见 public/tarot/DECK-CREDITS.txt） */
function cardImgSrc(def: TarotCardDef): string {
  if (def.arcana === 'major') return `/tarot/deck/major-${def.id.slice(6)}.jpg`;
  const rankIdx: Record<string, string> = { A: '01', '2': '02', '3': '03', '4': '04', '5': '05', '6': '06', '7': '07', '8': '08', '9': '09', '10': '10', '侍从': '11', '骑士': '12', '王后': '13', '国王': '14' };
  return `/tarot/deck/${def.suit}-${rankIdx[def.numeral] ?? '01'}.jpg`;
}

/** 中央牌面图：优先真实牌面（object-cover 裁切），加载失败退回线稿 */
function DeckArt({ def, w, h }: { def: TarotCardDef; w: number; h: number }) {
  const [broken, setBroken] = useState(false);
  if (!broken) {
    return (
      <img
        src={cardImgSrc(def)}
        alt={def.name}
        draggable={false}
        onError={() => setBroken(true)}
        className="h-full w-full select-none object-cover"
      />
    );
  }
  if (def.arcana === 'major') return <MajorArt idx={Number(def.id.slice(6))} />;
  return <MinorArt suit={def.suit!} numeral={def.numeral} w={w} h={h} />;
}

/** 牌背：白灰底 + 极淡星座连线纹理（第四十九轮，参考 quin 牌背） */
const BACK_PATTERN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='88' viewBox='0 0 64 88'%3E%3Cg fill='none' stroke='%23aab0bc' stroke-width='0.6' opacity='0.36'%3E%3Cpath d='M12 16 L28 24 L46 13'/%3E%3Cpath d='M16 60 L32 52 L50 64'/%3E%3Cpath d='M28 24 L32 52'/%3E%3C/g%3E%3Cg fill='%239aa1ad' opacity='0.4'%3E%3Ccircle cx='12' cy='16' r='1.2'/%3E%3Ccircle cx='28' cy='24' r='1.4'/%3E%3Ccircle cx='46' cy='13' r='1'/%3E%3Ccircle cx='16' cy='60' r='1.3'/%3E%3Ccircle cx='32' cy='52' r='1'/%3E%3Ccircle cx='50' cy='64' r='1.4'/%3E%3Ccircle cx='42' cy='38' r='0.9'/%3E%3Ccircle cx='7' cy='38' r='0.9'/%3E%3C/g%3E%3C/svg%3E")`;

function CardBack({ w, h }: { w: number; h: number }) {
  return (
    <div
      className="relative overflow-hidden border shadow-[0_2px_10px_rgba(17,24,39,0.10)]"
      style={{
        width: w,
        height: h,
        borderRadius: Math.max(6, w * 0.12),
        borderColor: 'rgba(17,24,39,0.16)',
        background: 'linear-gradient(180deg,#fcfcfd 0%,#f2f2f5 100%)',
      }}
    >
      <div className="absolute inset-0" style={{ backgroundImage: BACK_PATTERN, backgroundSize: '64px 88px' }} />
      <div className="absolute inset-[3px] rounded-[5px] border" style={{ borderColor: 'rgba(17,24,39,0.07)' }} />
    </div>
  );
}

/** 牌面：真实牌面图全幅 + 底部名牌条（罗马数字 / 点数 + 中英文名），逆位整面 rotate-180（第五十一轮换深蓝金配色） */
function CardFace({ def, reversed, w, h }: { def: TarotCardDef; reversed: boolean; w: number; h: number }) {
  const stripH = Math.max(15, h * 0.175);
  return (
    <div
      className="relative overflow-hidden border shadow-[0_3px_14px_rgba(17,24,39,0.14)]"
      style={{ width: w, height: h, borderRadius: Math.max(6, w * 0.12), borderColor: 'rgba(203,174,110,0.5)', background: '#0d1226' }}
    >
      <div className={`absolute inset-0 flex flex-col ${reversed ? 'rotate-180' : ''}`}>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <DeckArt def={def} w={w} h={h - stripH} />
          <div
            className="absolute left-[3px] top-[3px] rounded-[3px] border font-serif font-semibold"
            style={{ color: '#ecd9a0', fontSize: Math.max(5, w * 0.088), lineHeight: 1.35, padding: '0 2.5px', borderColor: 'rgba(203,174,110,0.45)', background: 'rgba(10,14,32,0.78)' }}
          >
            {def.numeral}
          </div>
        </div>
        <div
          className="flex shrink-0 flex-col justify-center text-center"
          style={{ height: stripH, borderTop: '1px solid rgba(203,174,110,0.4)', padding: '0 2px', background: 'linear-gradient(180deg,#131935 0%,#0b0f22 100%)' }}
        >
          <div className="truncate font-medium" style={{ color: '#f2e7c8', fontSize: Math.max(5.5, w * 0.095), lineHeight: 1.25 }}>{def.name}</div>
          <div className="truncate font-serif uppercase" style={{ color: 'rgba(214,188,132,0.78)', fontSize: Math.max(4.5, w * 0.07), lineHeight: 1.2, letterSpacing: '0.05em' }}>{def.nameEn}</div>
        </div>
      </div>
      {reversed && <div className="absolute right-1 top-1 rounded-full bg-gray-900/85 px-1 py-[1px] text-[7px] font-bold text-white">逆位</div>}
    </div>
  );
}

/** 3D 翻牌：牌背 → 牌面（rot 为该牌位的角度，如凯尔特十字的横牌 / 脉轮的竖排牌） */
function FlipCard({ def, reversed, flipped, w, h, rot = 0 }: { def: TarotCardDef; reversed: boolean; flipped: boolean; w: number; h: number; rot?: number }) {
  return (
    <div className="h-full w-full" style={{ perspective: 900, transform: rot ? `rotate(${rot}deg)` : undefined }}>
      <div
        className="relative transition-transform duration-[560ms] ease-out"
        style={{ width: '100%', height: '100%', transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
      >
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
          <CardBack w={w} h={h} />
        </div>
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          <CardFace def={def} reversed={reversed} w={w} h={h} />
        </div>
      </div>
    </div>
  );
}

// ---------------- 动态牌位框（按牌阵布局渲染） ----------------

/**
 * SpreadSlots：按牌阵 positions 的坐标把虚线牌位框 / 牌 / 标签摆成该牌阵的标准排版。
 * mode：pick = 选牌中（牌背 + 单行标签）；flip / done = 翻牌展示（3D 翻开 + 「第N张·牌位 / EN」两行说明）。
 */
function SpreadSlots({ spread, positions, slots, revsBySlot, flippedCount, mode, activeSlot, onSlotTap, slotRefCb }: {
  spread: TarotSpread;
  positions: SpreadPos[];
  slots: (number | null)[];
  revsBySlot: boolean[];
  flippedCount: number;
  mode: 'pick' | 'flip' | 'done';
  activeSlot?: number;
  onSlotTap?: (i: number) => void;
  slotRefCb?: (i: number, el: HTMLDivElement | null) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (size.w < 60 || size.h < 50) return null;
    const rotAll = positions.length > 0 && positions.every((p) => p.rot === 90);
    const leftW = spread.labelSide === 'left' ? 88 : 0;
    const labelH = spread.labelSide === 'left' ? 0 : mode === 'pick' ? 14 : 27;
    const padX = 3;
    const availW = size.w - padX * 2 - leftW;
    const availH = size.h - 2;
    const rowH = availH / spread.rows;
    const colW = availW / spread.cols;
    // 排位页独占全屏后，选牌时牌位框略缩（留呼吸感）
    const pickScale = mode === 'pick' ? 0.85 : 1;
    let cardW: number;
    let cardH: number;
    if (rotAll) {
      // 整阵横牌（脉轮竖列）：视觉高 = cardW
      cardW = Math.max(20, Math.min(rowH - 2, (colW - 6) / 1.58)) * pickScale;
      cardH = cardW * 1.58;
    } else {
      cardH = Math.max(30, rowH - labelH - 4) * pickScale;
      cardW = Math.min(cardH * 0.64, colW - 5) * pickScale;
      cardH = cardW / 0.64;
    }
    return { padX, leftW, labelH, cardW, cardH, rowH, colW };
  }, [size, spread, positions, mode]);

  return (
    <div ref={boxRef} className="relative h-full w-full">
      {geo &&
        positions.map((p, i) => {
          const deckIdx = slots[i] ?? null;
          const def = deckIdx != null ? TAROT_FULL_DECK[deckIdx] : null;
          const rev = revsBySlot[i] ?? false;
          const rot = p.rot ?? 0;
          const cellCx = geo.padX + geo.leftW + (p.x + 0.5) * geo.colW;
          const cellCy = (p.y + 0.5) * geo.rowH;
          // 视觉外包络（横牌时互换）
          const visW = rot === 90 ? geo.cardH : geo.cardW;
          const visH = rot === 90 ? geo.cardW : geo.cardH;
          const labelTop = cellCy + visH / 2 + 2 + (p.labelDy ?? 0);
          return (
            <div key={`${p.label}-${i}`} className="absolute" style={{ left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {/* 牌位 */}
              <div
                data-slot-idx={i}
                ref={(el) => slotRefCb?.(i, el)}
                onClick={onSlotTap ? () => onSlotTap(i) : undefined}
                className="absolute"
                style={{
                  left: cellCx - geo.cardW / 2,
                  top: cellCy - geo.cardH / 2,
                  width: geo.cardW,
                  height: geo.cardH,
                  transform: rot ? `rotate(${rot}deg)` : undefined,
                  zIndex: rot ? 6 : 3,
                  cursor: onSlotTap ? 'pointer' : 'default',
                  pointerEvents: 'auto',
                }}
              >
                {def ? (
                  mode === 'pick' ? (
                    <div className="h-full w-full" style={{ animation: 'tarot-reveal-in 0.34s ease both' }}>
                      <CardBack w={geo.cardW} h={geo.cardH} />
                    </div>
                  ) : (
                    <FlipCard def={def} reversed={rev} flipped={flippedCount > i} w={geo.cardW} h={geo.cardH} rot={rot} />
                  )
                ) : (
                  <div
                    className={`absolute inset-0 rounded-[9px] border-[1.5px] border-dashed transition-colors ${
                      activeSlot === i ? 'border-gray-800/70 bg-white/60 dark:border-zinc-300/60 dark:bg-white/15' : 'border-gray-300/90 bg-white/35 dark:border-zinc-600 dark:bg-white/[0.07]'
                    }`}
                  >
                    {activeSlot === i && (
                      <div
                        className="absolute inset-0 rounded-[9px]"
                        style={{ animation: 'tarot-slot-pulse 1.5s ease-in-out infinite' }}
                      />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center font-semibold text-gray-300 dark:text-zinc-600" style={{ fontSize: Math.max(8, geo.cardW * 0.22) }}>
                      {i + 1}
                    </span>
                  </div>
                )}
              </div>
              {/* 下方标签 */}
              {geo.labelH > 0 && (
                <div
                  className="absolute text-center"
                  style={{ left: cellCx - geo.colW / 2, top: labelTop, width: geo.colW, pointerEvents: 'none' }}
                >
                  {mode === 'pick' ? (
                    <div className="truncate text-[9px] leading-tight text-gray-500 dark:text-zinc-400">{p.label}</div>
                  ) : (
                    <>
                      <div className="truncate text-[9.5px] font-semibold leading-tight text-gray-700 dark:text-zinc-300">
                        第{i + 1}张 · {p.label}
                      </div>
                      {p.en && <div className="truncate text-[7.5px] uppercase tracking-[0.06em] leading-tight text-gray-400 dark:text-zinc-500">{p.en}</div>}
                    </>
                  )}
                </div>
              )}
              {/* 左侧标签（脉轮竖列） */}
              {geo.leftW > 0 && (
                <div
                  className="absolute flex flex-col items-end justify-center text-right"
                  style={{ left: geo.padX, top: cellCy - 16, width: geo.leftW - 10, height: 32, pointerEvents: 'none' }}
                >
                  {mode === 'pick' ? (
                    <div className="text-[10px] font-medium text-gray-600 dark:text-zinc-400">{p.label}</div>
                  ) : (
                    <>
                      <div className="text-[10px] font-semibold leading-tight text-gray-700 dark:text-zinc-300">
                        第{i + 1}张 · {p.label}
                      </div>
                      {p.en && <div className="text-[7.5px] uppercase tracking-wide leading-tight text-gray-400 dark:text-zinc-500">{p.en}</div>}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ---------------- 步骤指示（洗牌 → 牌阵 → 选牌 → 解读） ----------------

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-3">
      {['洗牌', '牌阵', '选牌', '解读'].map((s, i) => (
        <div key={s} className={`flex items-center gap-1 transition-colors ${i === step ? 'text-gray-900 dark:text-zinc-100' : 'text-gray-400/80 dark:text-zinc-500'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-gray-900 dark:bg-zinc-100' : 'bg-gray-300 dark:bg-zinc-600'}`} />
          <span className="text-[11.5px] font-medium">{s}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------- 主题选择（无图标，纯文字行） ----------------

function ThemeView({ themes, customQ, setCustomQ, onPick, historyCount, onHistory }: {
  themes: TarotTheme[];
  customQ: string;
  setCustomQ: (v: string) => void;
  onPick: (t: TarotTheme) => void;
  historyCount: number;
  onHistory: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4 pb-6">
      <div className="pt-3 text-center">
        <div className="text-[22px] font-bold tracking-wide text-gray-900 dark:text-zinc-100">选择占卜主题</div>
        <div className="mt-1 text-[12px] text-gray-500 dark:text-zinc-400">静下心来，在心里默想你要问的事</div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {themes.map((t) =>
          t.custom ? (
            <div
              key={t.key}
              className={`overflow-hidden rounded-2xl border bg-white/60 backdrop-blur-xl shadow-[0_4px_18px_rgba(17,24,39,0.05)] transition-all dark:bg-zinc-800/60 ${
                customOpen ? 'border-gray-300 ring-1 ring-gray-900/10 dark:border-white/20 dark:ring-white/10' : 'border-white/80 dark:border-white/10'
              }`}
            >
              <button
                type="button"
                onClick={() => setCustomOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-opacity active:opacity-70"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-gray-900 dark:text-zinc-100">{t.label}</span>
                  <span className="mt-0.5 block text-[12px] text-gray-500 dark:text-zinc-400">{t.desc}</span>
                </span>
              </button>
              {customOpen && (
                <div className="px-4 pb-4" style={{ animation: 'tarot-text-in 0.28s ease both' }}>
                  <textarea
                    value={customQ}
                    onChange={(e) => setCustomQ(e.target.value)}
                    maxLength={60}
                    rows={2}
                    placeholder="例如：我们最近的关系会好吗？"
                    className="w-full resize-none rounded-xl border border-gray-200 bg-white/80 px-3 py-2.5 text-[13px] text-gray-900 outline-none placeholder:text-gray-300 focus:border-gray-400 dark:border-white/15 dark:bg-white/10 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-400"
                    data-testid="tarot-custom-q"
                  />
                  <button
                    type="button"
                    disabled={customQ.trim().length < 2}
                    onClick={() => onPick(t)}
                    className="mt-2 h-10 w-full rounded-full bg-gray-900 text-[14px] font-semibold text-white shadow-[0_6px_18px_rgba(17,24,39,0.2)] transition-all active:scale-[0.98] active:opacity-90 disabled:opacity-35 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    带着问题去洗牌
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              key={t.key}
              type="button"
              onClick={() => onPick(t)}
              className="flex w-full items-center justify-between rounded-2xl border border-white/80 bg-white/60 px-4 py-3.5 text-left backdrop-blur-xl shadow-[0_4px_18px_rgba(17,24,39,0.05)] transition-all active:scale-[0.98] active:bg-white/80 dark:border-white/10 dark:bg-zinc-800/60 dark:active:bg-white/15"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-gray-900 dark:text-zinc-100">{t.label}</span>
                <span className="mt-0.5 block text-[12px] text-gray-500 dark:text-zinc-400">{t.desc}</span>
              </span>
            </button>
          ),
        )}
      </div>

      {historyCount > 0 && (
        <button
          type="button"
          onClick={onHistory}
          data-testid="tarot-history-entry"
          className="mt-4 w-full rounded-2xl border border-white/80 bg-white/45 py-3 text-[13px] text-gray-600 backdrop-blur-xl transition-opacity active:opacity-60 dark:border-white/10 dark:bg-white/[0.08] dark:text-zinc-400"
        >
          占卜记录（{historyCount}）
        </button>
      )}
    </div>
  );
}

// ---------------- 洗牌（散乱牌堆 · 点击牌堆随时打乱 / 长按持续）+ 整叠后上下左右四叠切牌（第四十九轮） ----------------

/** 牌堆单张的散乱状态（每次洗牌重新随机） */
interface ScatterCard {
  x: number; // 相对牌堆中心的散开横距
  y: number;
  r: number; // 散乱旋转角
  sx: number; // 洗牌动画：扔出去的方向
  sy: number;
  sr: number;
  delay: string;
  dur: string;
}

const PILE_N = 16;
const PILE_CARD_W = 96;
const PILE_CARD_H = 150;

function makeScatter(): ScatterCard[] {
  return Array.from({ length: PILE_N }, () => ({
    x: Math.round(-112 + Math.random() * 224),
    y: Math.round(-120 + Math.random() * 232),
    r: Math.round((Math.random() * 2 - 1) * 62),
    sx: Math.round(-72 + Math.random() * 144),
    sy: Math.round(-96 + Math.random() * 84),
    sr: Math.round((Math.random() * 2 - 1) * 52),
    delay: (Math.random() * 0.12).toFixed(2),
    dur: (0.58 + Math.random() * 0.34).toFixed(2),
  }));
}

/** 切牌阶段：idle → tidy（整叠整齐）→ split（上右下左四叠分开）→ hold（停顿）→ merge（按切牌顺序合拢） */
type CutPhase = 'idle' | 'tidy' | 'split' | 'hold' | 'merge';

// 切牌时间线：0 起 tidy，300ms 起 split，640ms 三/四叠停顿，880ms 合拢，1240ms 完成（总计约 1.24s）

/** 近乎对齐的整齐牌叠（每张极小错位，避免完全重合的塑料感） */
function neatTransform(i: number): string {
  const jx = (((i * 5) % 3) - 1) * 0.5;
  const jy = (((i * 3) % 3) - 1) * 0.45;
  const jr = (((i * 11) % 5) - 2) * 0.3;
  return `translate(-50%,-50%) translate(${jx}px,${jy}px) rotate(${jr}deg)`;
}

/**
 * 牌堆里每张牌在切牌各阶段的目标状态：
 * 16 张按 i/4 分四叠，分别向上 / 右 / 下 / 左弹开（cutFlip 翻转方向分配），停顿后按真实切牌顺序回拢。
 */
function pileCardState(i: number, phase: CutPhase, cutFlip: boolean): {
  transform: string;
  zIndex: number;
  filter?: string;
  delay: number;
} {
  const gi = Math.floor(i / 4); // 0..3 四叠分组
  const di = (gi + (cutFlip ? 2 : 0)) % 4; // 0上 1右 2下 3左
  if (phase === 'tidy') {
    return { transform: neatTransform(i), zIndex: 10 + (i % 4), delay: (i % 4) * 0.02 };
  }
  if (phase === 'split' || phase === 'hold') {
    const dirs: [number, number, number][] = [
      [0, -98, -3], // 上
      [98, 2, 3.5], // 右
      [0, 98, 3], // 下
      [-98, -2, -3.5], // 左
    ];
    const [dx, dy, dr] = dirs[di];
    // 组内微错位：四张牌叠成小牌堆而非完全重合
    const off = (i % 4) - 1.5;
    return {
      transform: `translate(-50%,-50%) translate(${dx + off * 2.2}px,${dy + off * 1.6}px) rotate(${dr + off * 1.1}deg)`,
      zIndex: 10 + gi * 2,
      filter: 'drop-shadow(0 10px 14px rgba(17,24,39,0.18))',
      delay: (i % 4) * 0.03,
    };
  }
  // merge：反向顺序回拢（后分的叠先回、先分的叠压顶，形成「切过一轮」的层次）
  return {
    transform: neatTransform(i),
    zIndex: 10 + ((gi + 2) % 4) * 2,
    filter: 'drop-shadow(0 4px 7px rgba(17,24,39,0.12))',
    delay: (3 - (i % 4)) * 0.02,
  };
}

function ShuffleView({ theme, question, scatter, tick, neat, count, cutting, cutPhase, cutFlip, cutDone, holding, onDown, onUp, onCut, onNext }: {
  theme: TarotTheme;
  question: string;
  scatter: ScatterCard[];
  tick: number;
  neat: boolean;
  count: number;
  cutting: boolean;
  cutPhase: CutPhase;
  cutFlip: boolean;
  cutDone: boolean;
  holding: boolean;
  onDown: () => void;
  onUp: () => void;
  onCut: () => void;
  onNext: () => void;
}) {
  const cutStage = count > 0; // 洗过一次即出现切牌 / 下一步按钮
  const hint = count === 0
    ? '点击牌堆洗牌 · 长按持续洗牌'
    : cutting
      ? '切牌中…'
      : cutDone
        ? '切牌完成 · 可继续切牌，或点「下一步」'
        : '点击「切牌」整理牌堆并切牌 · 点击牌堆可重新打乱';
  return (
    <div className="flex h-full flex-col items-center px-5">
      <div className="mt-2 shrink-0 text-center">
        <div className="text-[24px] font-bold tracking-wide text-gray-900 dark:text-zinc-100">洗牌</div>
        <div className="mt-1 text-[12.5px] text-gray-500 dark:text-zinc-400">
          {theme.label}
          {theme.custom && question ? ` · ${question}` : ''}
        </div>
      </div>

      {/* 散乱牌堆（可按压：点击洗牌 / 长按持续洗牌；切牌走下方按钮） */}
      <div
        className="relative mt-1 flex min-h-0 flex-1 touch-none select-none items-center justify-center self-stretch"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onUp}
        data-testid="tarot-pile"
      >
        <div className="relative h-[300px] w-[330px]">
          {scatter.map((o, i) => {
            const st = cutting ? pileCardState(i, cutPhase, cutFlip) : null;
            return (
              <div
                key={i}
                className="absolute left-1/2 top-1/2"
                style={{
                  // 切牌动画各阶段 / 切完保持整齐牌叠 / 其余时候散乱牌堆
                  transform: st ? st.transform : neat ? neatTransform(i) : `translate(-50%,-50%) translate(${o.x}px,${o.y}px) rotate(${o.r}deg)`,
                  zIndex: st ? st.zIndex : neat ? 10 + (i % 4) : 10,
                  filter: st?.filter,
                  transition: cutting
                    ? `transform 320ms cubic-bezier(.4,.55,.3,1.04) ${(st?.delay ?? 0).toFixed(3)}s, filter 300ms ease ${(st?.delay ?? 0).toFixed(3)}s`
                    : `transform 430ms cubic-bezier(.3,.7,.3,1.02) ${o.delay}s`,
                  willChange: 'transform',
                }}
              >
                {/* 洗牌层：key=tick 重挂载触发扔牌动画 */}
                <div
                  key={tick}
                  style={
                    tick > 0
                      ? ({ '--sx': `${o.sx}px`, '--sy': `${o.sy}px`, '--sr': `${o.sr}deg`, animation: `tarot-shuffle-card ${o.dur}s ease-in-out ${o.delay}s both`, willChange: 'transform' } as CSSProperties)
                      : undefined
                  }
                >
                  <CardBack w={PILE_CARD_W} h={PILE_CARD_H} />
                </div>
              </div>
            );
          })}
        </div>
        {holding && <div className="absolute bottom-1 text-[11.5px] text-gray-500 dark:text-zinc-400" style={{ animation: 'tarot-star-pulse 1.2s ease-in-out infinite' }}>持续洗牌中…</div>}
        {cutting && <div className="absolute bottom-1 text-[11.5px] text-gray-500 dark:text-zinc-400">切牌中…</div>}
      </div>

      {/* 提示 + 操作按钮（第四十九轮：切牌可无限次，下一步进入牌阵） */}
      <div className="flex w-full shrink-0 flex-col items-center gap-2.5 pb-6">
        <div className="text-[12px] text-gray-500 dark:text-zinc-400">{hint}</div>
        {cutStage && (
          <div className="flex w-full items-center gap-2.5">
            <button
              type="button"
              onClick={onCut}
              disabled={cutting}
              data-testid="tarot-cut"
              className="h-12 flex-1 rounded-full border border-white/90 bg-white/55 text-[13.5px] font-medium text-gray-700 backdrop-blur-xl transition-all active:scale-[0.98] active:opacity-60 disabled:opacity-40 dark:border-white/15 dark:bg-white/10 dark:text-zinc-300"
            >
              {cutting ? '切牌中…' : '切牌'}
            </button>
            <button
              type="button"
              onClick={onNext}
              data-testid="tarot-next"
              className="h-12 flex-1 rounded-full bg-gray-900 text-[14.5px] font-semibold text-white shadow-[0_8px_22px_rgba(17,24,39,0.24)] transition-all active:scale-[0.98] active:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
            >
              下一步
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 牌阵选择（图示 + 名称 + 简述 + 张数） ----------------

function SpreadGlyph({ spread }: { spread: TarotSpread }) {
  const W = 40;
  const H = 52;
  const maxN = spread.counts[spread.counts.length - 1];
  const pts = spread.positions(maxN);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden="true">
      <rect x="1" y="1" width={W - 2} height={H - 2} rx="7" className="fill-white/70 stroke-gray-200" />
      {pts.map((p, i) => {
        const cx = ((p.x + 0.5) / spread.cols) * (W - 10) + 5;
        const cy = ((p.y + 0.5) / spread.rows) * (H - 10) + 5;
        return p.rot ? (
          <rect key={i} x={cx - 2.4} y={cy - 3.8} width={4.8} height={7.6} rx={1.3} transform={`rotate(90 ${cx} ${cy})`} className="fill-gray-400" />
        ) : (
          <circle key={i} cx={cx} cy={cy} r={2.4} className="fill-gray-400" />
        );
      })}
    </svg>
  );
}

function SpreadView({ theme, question, onStart }: {
  theme: TarotTheme;
  question: string;
  onStart: (s: TarotSpread, n: number) => void;
}) {
  const [openVar, setOpenVar] = useState<string | null>(null);
  const groups: TarotSpread['group'][] = ['基础类', '主题类'];
  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4 pb-6">
      <div className="pt-2 text-center">
        <div className="text-[21px] font-bold tracking-wide text-gray-900 dark:text-zinc-100">选择牌阵</div>
        <div className="mt-1 truncate text-[12px] text-gray-500 dark:text-zinc-400">
          {theme.label}
          {question ? ` · ${question}` : ''}
        </div>
      </div>

      {groups.map((g) => (
        <div key={g} className="mt-3">
          <div className="px-1 text-[11px] font-semibold text-gray-400 dark:text-zinc-500">【{g}】</div>
          <div className="mt-1.5 flex flex-col gap-2">
            {TAROT_SPREADS.filter((s) => s.group === g).map((s) => {
              const variable = s.counts.length > 1;
              const open = openVar === s.key;
              return (
                <div
                  key={s.key}
                  className={`overflow-hidden rounded-2xl border bg-white/60 backdrop-blur-xl shadow-[0_4px_16px_rgba(17,24,39,0.05)] transition-all dark:bg-zinc-800/60 ${
                    open ? 'border-gray-300 ring-1 ring-gray-900/10 dark:border-white/20 dark:ring-white/10' : 'border-white/80 dark:border-white/10'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => (variable ? setOpenVar(open ? null : s.key) : onStart(s, s.counts[0]))}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-opacity active:opacity-70"
                    data-testid={`tarot-spread-${s.key}`}
                  >
                    <SpreadGlyph spread={s} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold text-gray-900 dark:text-zinc-100">{s.name}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-gray-500 dark:text-zinc-400">{s.desc}</span>
                    </span>
                    <span className="shrink-0 rounded-full border border-gray-200/90 bg-white/80 px-2 py-0.5 text-[10px] text-gray-600 dark:border-white/10 dark:bg-white/10 dark:text-zinc-400">
                      {variable ? `${s.counts[0]}-${s.counts[s.counts.length - 1]}张` : `${s.counts[0]}张`}
                    </span>
                  </button>
                  {open && variable && (
                    <div className="flex items-center gap-2 px-3 pb-3" style={{ animation: 'tarot-text-in 0.24s ease both' }}>
                      {s.counts.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => onStart(s, n)}
                          className="h-9 flex-1 rounded-full border border-gray-200 bg-white/85 text-[13px] font-medium text-gray-800 transition-all active:scale-[0.97] active:opacity-70 dark:border-white/15 dark:bg-white/10 dark:text-zinc-200"
                        >
                          {n} 张牌
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- 大幅扇形牌轮（78 张沿圆环放射铺开，滑动旋转 / 双指缩放 / 点选，第四十九轮） ----------------

const WHEEL_STEP = 360 / 78;
/**
 * 第四十九轮重做为「大幅扇形」（参考 quin 选牌页）：轮心放在屏幕右下角外（+40, +36），
 * 78 张牌沿半径 R 的圆环铺开，牌顶指向圆外（放射状），可见窗口约 100° ≈ 21 张牌构成大扇面。
 * 定位公式（γ = --wa + i·step，从「左」起顺时针）：translate(-R·cosγ, -R·sinγ) rotate(γ-90°)，
 * 全部走 transform（compositor 合成层），一次 CSS 变量更新驱动全牌。
 */
const WHEEL_R = 430;
const WHEEL_AX = 10; // 轮心距右缘（外）
const WHEEL_AY = 36; // 轮心距底缘（外）
const WHEEL_MIN_SCALE = 0.7;
const WHEEL_MAX_SCALE = 1.35;
const CARD_W = 100;
const CARD_H = 156;
/** 拖拽灵敏度：R=430 时 0.13deg/px ≈ 扇缘 1:1 跟手（竖滑为主、横滑辅助） */
const WHEEL_DRAG_K = 0.13;
const WHEEL_ANGLE0 = 16; // 初始基角：扇面从底部横牌铺到右缘竖牌

function CardWheel({ hidden, onTapCard }: { hidden: number[]; onTapCard: (idx: number, el: HTMLElement) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(WHEEL_ANGLE0); // 初始让扇面从底部横牌铺到右缘竖牌
  const scaleRef = useRef(1);
  const velRef = useRef(0);
  const rafRef = useRef(0);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const modeRef = useRef<'none' | 'drag' | 'pinch'>('none');
  const lastXRef = useRef(0);
  const lastYRef = useRef(0);
  const pinch0Ref = useRef({ dist: 0, scale: 1 });
  const movedRef = useRef(false);
  const downAtRef = useRef(0);

  const applyVars = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.style.setProperty('--wa', `${angleRef.current.toFixed(2)}deg`);
    el.style.setProperty('--ws', scaleRef.current.toFixed(3));
  }, []);

  useEffect(() => {
    applyVars();
    return () => window.cancelAnimationFrame(rafRef.current);
  }, [applyVars]);

  /** 惯性旋转 */
  function spin() {
    rafRef.current = requestAnimationFrame(() => {
      angleRef.current += velRef.current;
      velRef.current *= 0.93;
      applyVars();
      if (Math.abs(velRef.current) > 0.04) spin();
    });
  }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    window.cancelAnimationFrame(rafRef.current);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downAtRef.current = Date.now();
    movedRef.current = false;
    if (ptrs.current.size === 1) {
      modeRef.current = 'drag';
      lastXRef.current = e.clientX;
      lastYRef.current = e.clientY;
      velRef.current = 0;
    } else if (ptrs.current.size === 2) {
      modeRef.current = 'pinch';
      const [a, b] = Array.from(ptrs.current.values());
      pinch0Ref.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: scaleRef.current };
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const prev = ptrs.current.get(e.pointerId);
      if (!prev) return;
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (modeRef.current === 'drag' && ptrs.current.size === 1) {
        const dy = e.clientY - lastYRef.current;
        const dx = e.clientX - lastXRef.current;
        lastYRef.current = e.clientY;
        lastXRef.current = e.clientX;
        if (Math.abs(dy) > 2 || Math.abs(dx) > 2) movedRef.current = true;
        // 扇轮：上滑牌沿右缘向上走（竖滑为主、横滑辅助），灵敏度按 R 折算约 1:1 跟手
        const delta = (-dy + dx * 0.5) * WHEEL_DRAG_K;
        angleRef.current += delta;
        velRef.current = velRef.current * 0.7 + delta * 0.3;
        applyVars();
      } else if (modeRef.current === 'pinch' && ptrs.current.size === 2) {
        movedRef.current = true;
        const [a, b] = Array.from(ptrs.current.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        scaleRef.current = Math.min(WHEEL_MAX_SCALE, Math.max(WHEEL_MIN_SCALE, pinch0Ref.current.scale * (dist / pinch0Ref.current.dist)));
        applyVars();
      }
    },
    [applyVars],
  );

  const endPtr = useCallback(
    (e: React.PointerEvent) => {
      ptrs.current.delete(e.pointerId);
      if (modeRef.current === 'pinch' && ptrs.current.size === 1) {
        modeRef.current = 'drag';
        const [a] = Array.from(ptrs.current.values());
        lastXRef.current = a.x;
        lastYRef.current = a.y;
      }
      if (ptrs.current.size === 0) {
        if (modeRef.current === 'drag' && Math.abs(velRef.current) > 0.35) spin();
        modeRef.current = 'none';
        // 点选（未拖动 + 快速点按）
        if (!movedRef.current && Date.now() - downAtRef.current < 420) {
          const el = e.target as HTMLElement | null;
          const card = el?.closest('[data-card-idx]') as HTMLElement | null;
          if (card) onTapCard(Number(card.dataset.cardIdx), card);
        }
      }
    },
    [onTapCard, spin],
  );

  return (
    <div
      ref={wrapRef}
      className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPtr}
      onPointerCancel={endPtr}
      onPointerLeave={endPtr}
      data-testid="tarot-wheel"
    >
      <div className="pointer-events-none absolute left-4 top-1 text-[10px] text-gray-400 dark:text-zinc-500">滑动牌轮 · 双指缩放 · 点选牌背</div>
      {/* 轮心锚点：屏幕右下角外，78 张牌以 transform 挂在圆环上 */}
      <div className="absolute h-0 w-0" style={{ left: `calc(100% + ${WHEEL_AX}px)`, top: `calc(100% + ${WHEEL_AY}px)` }}>
        {TAROT_FULL_DECK.map((c, i) => {
          const gone = hidden.includes(i);
          const ang = `calc(var(--wa, ${WHEEL_ANGLE0.toFixed(2)}deg) + ${(i * WHEEL_STEP).toFixed(3)}deg)`;
          return (
            <div
              key={c.id}
              data-card-idx={i}
              className="absolute left-0 top-0 cursor-pointer"
              style={{
                width: CARD_W,
                height: CARD_H,
                marginLeft: -CARD_W / 2,
                marginTop: -CARD_H / 2,
                // 位置 = 轮心 - R·(cosγ, sinγ)，再 rotate(γ-90°) 让牌顶指向圆外（放射状扇面）
                transform: `translate(calc(-1 * ${WHEEL_R}px * var(--ws, 1) * cos(${ang})), calc(-1 * ${WHEEL_R}px * var(--ws, 1) * sin(${ang}))) rotate(calc(${ang} - 90deg)) scale(var(--ws, 1))`,
                willChange: 'transform',
                zIndex: i + 1,
                opacity: gone ? 0 : 1,
                pointerEvents: gone ? 'none' : 'auto',
                transition: gone ? 'opacity 0.16s ease' : undefined,
              }}
            >
              <CardBack w={CARD_W} h={CARD_H} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- 飞牌动画（牌轮点击处 → 牌位） ----------------

interface FlyState {
  idx: number;
  slotIdx: number;
  gx: number; // 起点（页面容器内坐标）
  gy: number;
  tx: number; // 终点
  ty: number;
  rot: number; // 牌位角度
  sx: number;
  sy: number;
  go: boolean;
}

function FlyGhost({ fly, onEnd }: { fly: FlyState; onEnd: () => void }) {
  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{
        left: fly.gx,
        top: fly.gy,
        width: CARD_W,
        height: CARD_H,
        marginLeft: -CARD_W / 2,
        marginTop: -CARD_H / 2,
        transform: fly.go
          ? `translate(${fly.tx - fly.gx}px, ${fly.ty - fly.gy}px) rotate(${fly.rot}deg) scale(${fly.sx.toFixed(3)}, ${fly.sy.toFixed(3)})`
          : undefined,
        transition: fly.go ? 'transform 520ms cubic-bezier(.3,.75,.25,1)' : undefined,
        willChange: 'transform',
      }}
      onTransitionEnd={onEnd}
    >
      <CardBack w={CARD_W} h={CARD_H} />
    </div>
  );
}

// ---------------- 排位页（独立界面：牌阵布局全屏 + 进度 + 去选牌 / 翻牌，第四十九轮） ----------------

function SlotsView({ theme, question, spread, positions, slots, revsBySlot, filledCount, slotRefCb, onSlotTap, onGoPick, onFlip }: {
  theme: TarotTheme;
  question: string;
  spread: TarotSpread;
  positions: SpreadPos[];
  slots: (number | null)[];
  revsBySlot: boolean[];
  filledCount: number;
  slotRefCb: (i: number, el: HTMLDivElement | null) => void;
  onSlotTap: (i: number) => void;
  onGoPick: () => void;
  onFlip: () => void;
}) {
  const need = positions.length;
  // 下一个待填牌位 = 第一个空位（而非已填数索引）：「点牌位收回」可清空中间任意位，
  // 用 filledCount 当索引会指错牌位（按钮/大标题/脉冲高亮全错位，第五十三轮修正）
  const nextSlot = slots.findIndex((s) => s === null);
  const full = nextSlot < 0;
  const nextPos = full ? null : positions[nextSlot];
  return (
    <div className="relative flex h-full flex-col">
      <div className="shrink-0 px-5 pt-1 text-center">
        <div className="truncate text-[11px] text-gray-500 dark:text-zinc-400">
          {spread.name} · {theme.label}
          {theme.custom && question ? ` · ${question}` : ''}
        </div>
        <div className="mt-0.5 text-[22px] font-bold tracking-wide text-gray-900 dark:text-zinc-100">{full ? '牌阵已满' : nextPos?.label}</div>
        <div className="mt-0.5 text-[11px] text-gray-500 dark:text-zinc-400">
          {full
            ? '点击下方「翻牌」揭晓'
            : `第 ${filledCount + 1} 张 · 已选 ${filledCount}/${need}${filledCount > 0 ? ' · 点牌位可收回' : ''}`}
        </div>
      </div>

      {/* 牌阵布局独占剩余全屏 */}
      <div className="min-h-0 flex-1 px-2 pb-1 pt-1.5">
        <SpreadSlots
          spread={spread}
          positions={positions}
          slots={slots}
          revsBySlot={revsBySlot}
          flippedCount={0}
          mode="pick"
          activeSlot={full ? undefined : nextSlot}
          onSlotTap={onSlotTap}
          slotRefCb={slotRefCb}
        />
      </div>

      <div className="shrink-0 px-5 pb-5 pt-1">
        {full ? (
          <button
            type="button"
            onClick={onFlip}
            data-testid="tarot-flip"
            className="h-12 w-full rounded-full bg-gray-900 text-[15px] font-semibold text-white shadow-[0_10px_26px_rgba(17,24,39,0.28)] transition-all active:scale-[0.98] active:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
          >
            翻牌
          </button>
        ) : (
          <button
            type="button"
            onClick={onGoPick}
            data-testid="tarot-go-pick"
            className="h-12 w-full rounded-full bg-gray-900 text-[14.5px] font-semibold text-white shadow-[0_8px_22px_rgba(17,24,39,0.24)] transition-all active:scale-[0.98] active:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
          >
            去选第 {filledCount + 1} 张牌 · {nextPos?.label}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- 牌轮页（独立界面：第N张牌 + 牌位名大标题 + 全屏扇形牌轮，第四十九轮） ----------------

function WheelView({ theme, question, spread, positions, slots, filledCount, onCardTap, onBackToSlots }: {
  theme: TarotTheme;
  question: string;
  spread: TarotSpread;
  positions: SpreadPos[];
  slots: (number | null)[];
  filledCount: number;
  onCardTap: (idx: number, el: HTMLElement) => void;
  onBackToSlots: () => void;
}) {
  const need = positions.length;
  const nextSlot = slots.findIndex((s) => s === null); // 与排位页同一算法：第一个空位才是当前牌位
  const full = nextSlot < 0;
  const nextPos = positions[full ? need - 1 : nextSlot];
  const hidden = useMemo(() => slots.filter((s): s is number => s !== null), [slots]);
  return (
    <div className="relative flex h-full flex-col">
      <div className="shrink-0 px-5 pt-1 text-center">
        <div className="text-[11px] text-gray-500 dark:text-zinc-400">
          第 {Math.min(filledCount + 1, need)} 张牌 · {spread.name}
          {theme.custom && question ? ` · ${question}` : ''}
        </div>
        <div className="mt-0.5 text-[24px] font-bold tracking-wide text-gray-900 dark:text-zinc-100">{full ? '选好了' : nextPos.label}</div>
        <div className="mt-0.5 text-[11.5px] text-gray-500 dark:text-zinc-400">{full ? '点击下方按钮回到牌位' : '双指放大牌轮 · 滑动牌轮 · 点选牌'}</div>
      </div>

      <CardWheel hidden={hidden} onTapCard={onCardTap} />

      <div className="shrink-0 px-5 pb-5 pt-1">
        <button
          type="button"
          onClick={onBackToSlots}
          data-testid="tarot-back-slots"
          className="h-11 w-full rounded-full border border-white/90 bg-white/55 text-[13.5px] font-medium text-gray-700 backdrop-blur-xl transition-all active:scale-[0.98] active:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-zinc-300"
        >
          查看牌位
        </button>
      </div>
    </div>
  );
}

// ---------------- 翻牌 / 解读 / 结果 ----------------

function revealSlotsH(rows: number): number {
  if (rows <= 1) return 225;
  if (rows === 2) return 262;
  if (rows === 3) return 302;
  if (rows === 4) return 342;
  return 380;
}

function ReadingCard({ reading, positions, drawnDefs }: {
  reading: { per: string[]; overall: string; aiUsed: boolean } | null;
  positions: SpreadPos[];
  drawnDefs: { def: TarotCardDef; reversed: boolean }[];
}) {
  return (
    <div className="mt-3 rounded-2xl border border-white/80 bg-white/65 p-4 backdrop-blur-xl shadow-[0_6px_22px_rgba(17,24,39,0.06)] dark:border-white/10 dark:bg-zinc-800/60" data-testid="tarot-reading">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{
            background: 'linear-gradient(155deg,#1b2244 0%,#0c1026 100%)',
            border: '1px solid rgba(203,174,110,0.5)',
            boxShadow: '0 3px 10px rgba(13,18,38,0.16), inset 0 1px 0 rgba(236,217,160,0.22)',
          }}
        >
          <MoonStar className="h-[17px] w-[17px]" strokeWidth={1.4} style={{ color: '#ecd9a0' }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-gray-900 dark:text-zinc-100">塔罗解读</div>
          <div className="text-[10.5px] text-gray-500 dark:text-zinc-400">按牌位职责 · 按正逆位牌意</div>
        </div>
      </div>

      {!reading ? (
        <div className="mt-3.5 flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/90 px-3.5 py-3 dark:border-white/10 dark:bg-white/[0.06]" data-testid="tarot-reading-loading">
          <span className="relative flex h-6 w-6 items-center justify-center">
            <span className="absolute inset-0 rounded-full border-2 border-gray-300 border-t-gray-800 dark:border-zinc-600 dark:border-t-zinc-200" style={{ animation: 'tarot-halo-spin 0.9s linear infinite' }} />
            <Star className="h-2.5 w-2.5 text-gray-700 dark:text-zinc-300" />
          </span>
          <span className="text-[12.5px] text-gray-600 dark:text-zinc-400">正在解读这副牌…</span>
        </div>
      ) : (
        <div className="mt-3.5 flex flex-col gap-3">
          {reading.per.map((t, i) => {
            const c = drawnDefs[i];
            return (
              <div key={i} className="rounded-xl border border-gray-100 bg-gray-50/90 px-3.5 py-3 dark:border-white/10 dark:bg-white/[0.06]" style={{ animation: `tarot-text-in 0.45s ease ${i * 0.12}s both` }}>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[12px] font-semibold text-gray-900 dark:text-zinc-100">{positions[i]?.label ?? ''}</span>
                  {c && <span className="text-[11px] text-gray-500 dark:text-zinc-400">{c.def.name} · {c.reversed ? '逆位' : '正位'}</span>}
                </div>
                <p className="mt-1 text-[13.5px] leading-[1.75] text-gray-800 dark:text-zinc-200">{t}</p>
              </div>
            );
          })}
          {reading.overall && (
            <div className="rounded-xl border border-gray-200 bg-white/90 px-3.5 py-3 dark:border-white/10 dark:bg-white/[0.08]" style={{ animation: 'tarot-text-in 0.45s ease 0.2s both' }}>
              <p className="text-[13.5px] leading-[1.8] text-gray-900 dark:text-zinc-100">{reading.overall}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RevealBody({ spread, positions, slots, revsBySlot, flippedCount, mode, theme, question, reading, footer }: {
  spread: TarotSpread;
  positions: SpreadPos[];
  slots: (number | null)[];
  revsBySlot: boolean[];
  flippedCount: number;
  mode: 'flip' | 'done';
  theme: { label: string };
  question: string;
  reading: { per: string[]; overall: string; aiUsed: boolean } | null;
  footer?: React.ReactNode;
}) {
  const drawnDefs = slots
    .map((s, i) => (s !== null ? { def: TAROT_FULL_DECK[s], reversed: revsBySlot[i] ?? false } : null))
    .filter((x): x is { def: TarotCardDef; reversed: boolean } => !!x);
  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4 pb-5">
      <div className="pt-1 text-center">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-gray-400 dark:text-zinc-500">{spread.name}</div>
        <div className="mt-0.5 text-[18px] font-bold text-gray-900 dark:text-zinc-100">
          {theme.label}
          {question ? `：「${question}」` : ''}
        </div>
      </div>

      <div className="mx-auto mt-2 px-1" style={{ height: revealSlotsH(spread.rows) }}>
        <SpreadSlots spread={spread} positions={positions} slots={slots} revsBySlot={revsBySlot} flippedCount={flippedCount} mode={mode} />
      </div>

      <ReadingCard reading={reading} positions={positions} drawnDefs={drawnDefs} />
      {footer}
    </div>
  );
}

// ---------------- 历史记录 ----------------

/** 从持久化记录还原牌阵与牌位（旧记录无 spreadKey 时退化为横排） */
function spreadInfoOf(r: TarotReading): { spread: TarotSpread; positions: SpreadPos[] } {
  const n = Math.max(1, r.cards.length);
  const s = r.spreadKey ? tarotSpreadByKey(r.spreadKey) : undefined;
  if (s) return { spread: s, positions: s.positions(n) };
  const labels = r.spread?.length ? r.spread : Array.from({ length: n }, (_, i) => `第${i + 1}张`);
  const pseudo: TarotSpread = {
    key: 'row',
    name: r.spreadName || '牌阵',
    group: '基础类',
    desc: '',
    counts: [n],
    cols: n,
    rows: 1,
    positions: (m) => labels.slice(0, m).map((lb, i) => ({ label: lb, en: r.posEn?.[i] ?? '', hint: '', x: i, y: 0 })),
  };
  return { spread: pseudo, positions: pseudo.positions(n) };
}

function HistoryView({ readings, onBack, onOpen }: {
  readings: TarotReading[];
  onBack: () => void;
  onOpen: (r: TarotReading) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-5 pt-2 text-center">
        <div className="text-[20px] font-bold tracking-wide text-gray-900 dark:text-zinc-100">占卜记录</div>
        <div className="mt-0.5 text-[12px] text-gray-500 dark:text-zinc-400">每一次提问，牌都有回应</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">
        {readings.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-gray-400 dark:text-zinc-500">
            <Star className="h-6 w-6" strokeWidth={1.5} />
            <span className="text-[13px]">还没有占卜记录</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {readings.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpen(r)}
                data-testid="tarot-history-item"
                className="rounded-2xl border border-white/80 bg-white/60 px-4 py-3.5 text-left backdrop-blur-xl shadow-[0_4px_16px_rgba(17,24,39,0.05)] transition-all active:scale-[0.98] dark:border-white/10 dark:bg-zinc-800/60"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[14.5px] font-bold text-gray-900 dark:text-zinc-100">{r.themeLabel}</span>
                  {r.spreadName && <span className="shrink-0 rounded-full border border-gray-200 bg-white/80 px-2 py-0.5 text-[10px] text-gray-600 dark:border-white/10 dark:bg-white/10 dark:text-zinc-400">{r.spreadName}</span>}
                  {r.question ? <span className="min-w-0 flex-1 truncate text-[11.5px] text-gray-500 dark:text-zinc-400">「{r.question}」</span> : <span className="flex-1" />}
                  <span className="shrink-0 text-[10.5px] text-gray-400 dark:text-zinc-500">{fmtTs(r.at)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.cards.map((c, i) => {
                    const def = tarotCardById(c.defId);
                    return (
                      <span key={i} className="rounded-full border border-gray-200/90 bg-gray-50 px-2 py-0.5 text-[10.5px] text-gray-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-300">
                        {r.spread?.[i] ? `${r.spread[i]}·` : ''}{def?.name ?? '?'} {c.reversed ? '· 逆' : ''}
                      </span>
                    );
                  })}
                </div>
                {r.overall && <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-gray-600 dark:text-zinc-400">{r.overall}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 px-4 pb-5">
        <button type="button" onClick={onBack} className="h-11 w-full rounded-full border border-white/90 bg-white/65 text-[14px] font-medium text-gray-800 backdrop-blur-xl transition-opacity active:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-zinc-200">
          返回
        </button>
      </div>
    </div>
  );
}

// ---------------- 主组件 ----------------

type View = 'theme' | 'shuffle' | 'spread' | 'slots' | 'wheel' | 'reveal' | 'history' | 'detail';

export default function CoupleTarotPage({ state, patch, showToast, close }: {
  state: CoupleState;
  patch: (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;
  showToast: (m: string) => void;
  close: () => void;
}) {
  const meta = readInviteMeta();
  const cid = meta.partnerContactId || 'default';
  const channel = meta.partnerApp ?? 'wx';
  const meName = (state.meName || '').trim() || '我';

  const [view, setView] = useState<View>('theme');
  const [theme, setTheme] = useState<TarotTheme | null>(null);
  const [customQ, setCustomQ] = useState('');
  const [scatter, setScatter] = useState<ScatterCard[]>(() => makeScatter());
  const [shuffleTick, setShuffleTick] = useState(0);
  const [shuffleCount, setShuffleCount] = useState(0);
  const [cutCount, setCutCount] = useState(0);
  const [cutFlip, setCutFlip] = useState(false);
  const [cutting, setCutting] = useState(false);
  const [cutDone, setCutDone] = useState(false);
  const [cutPhase, setCutPhase] = useState<CutPhase>('idle');
  const [neat, setNeat] = useState(false); // 切牌完成后牌堆保持整齐；点击牌堆洗牌重新打乱
  const [holding, setHolding] = useState(false);
  const [spread, setSpread] = useState<TarotSpread | null>(null);
  const [spreadN, setSpreadN] = useState(1);
  const [slots, setSlots] = useState<(number | null)[]>([]);
  const [fly, setFly] = useState<FlyState | null>(null);
  const revsRef = useRef<boolean[]>([]); // 每张牌的正/逆位（进牌轮时预定，翻牌时揭晓）
  const [flipped, setFlipped] = useState(0);
  const [reading, setReading] = useState<{ per: string[]; overall: string; aiUsed: boolean } | null>(null);
  const [detail, setDetail] = useState<TarotReading | null>(null);

  const positions = useMemo(() => (spread ? spread.positions(spreadN) : []), [spread, spreadN]);
  const positionsRef = useRef<SpreadPos[]>([]);
  positionsRef.current = positions;
  const filledCount = useMemo(() => slots.reduce<number>((acc, s) => acc + (s !== null ? 1 : 0), 0), [slots]);
  const revsBySlot = useMemo(() => slots.map((idx) => (idx !== null ? revsRef.current[idx] ?? false : false)), [slots]);

  const readings = state.tarotReadings?.[cid] ?? [];

  // —— 洗牌：点击牌堆随时重新打乱 / 长按持续 ——
  const pressTimer = useRef<number | null>(null);
  const holdingRef = useRef(false);
  const cuttingRef = useRef(false);
  const doShuffle = useCallback(() => {
    if (cuttingRef.current) return;
    setScatter(makeScatter());
    setShuffleTick((t) => t + 1);
    setShuffleCount((n) => n + 1);
    setNeat(false);
    setCutDone(false); // 重新洗牌后需重新切牌
  }, []);

  // —— 切牌（可无限次）：整叠整齐 → 上/右/下/左四叠分开 → 停顿 → 合拢 ——
  const cutTimersRef = useRef<number[]>([]);
  const doCut = useCallback(() => {
    if (cuttingRef.current || shuffleCount === 0) return; // 防抖：动画中不重复触发；至少先洗一次
    cuttingRef.current = true;
    setCutting(true);
    setCutDone(false);
    setCutPhase('tidy');
    setCutCount((n) => n + 1);
    const t = cutTimersRef.current;
    t.push(window.setTimeout(() => setCutPhase('split'), 300));
    t.push(window.setTimeout(() => setCutPhase('hold'), 640));
    t.push(window.setTimeout(() => setCutPhase('merge'), 880));
    t.push(
      window.setTimeout(() => {
        cuttingRef.current = false;
        setCutting(false);
        setCutPhase('idle');
        setCutFlip((f) => !f); // 下一刀换一组方向分配
        setNeat(true); // 切完保持整齐牌叠，点击牌堆可重新打乱
        setCutDone(true);
      }, 1240),
    );
  }, [shuffleCount]);
  useEffect(
    () => () => {
      cutTimersRef.current.forEach((id) => window.clearTimeout(id));
      cutTimersRef.current = [];
    },
    [],
  );

  const pileDown = useCallback(() => {
    if (cuttingRef.current) return;
    holdingRef.current = false;
    pressTimer.current = window.setTimeout(() => {
      holdingRef.current = true;
      setHolding(true);
      doShuffle();
    }, 380);
  }, [doShuffle]);
  const pileUp = useCallback(() => {
    if (cuttingRef.current) return;
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    if (holdingRef.current) {
      holdingRef.current = false;
      setHolding(false);
    } else {
      doShuffle(); // 点击牌堆 = 洗牌（随时可重新打乱）
    }
  }, [doShuffle]);
  useEffect(() => {
    if (!holding) return;
    const iv = window.setInterval(doShuffle, 1000);
    return () => window.clearInterval(iv);
  }, [holding, doShuffle]);
  useEffect(
    () => () => {
      if (pressTimer.current != null) window.clearTimeout(pressTimer.current);
    },
    [],
  );

  // —— 选定牌阵 → 进入排位页 ——
  const startSpread = useCallback((s: TarotSpread, n: number) => {
    revsRef.current = TAROT_FULL_DECK.map(() => Math.random() < 0.38);
    setSpread(s);
    setSpreadN(n);
    setSlots(Array(n).fill(null));
    setFlipped(0);
    setReading(null);
    setFly(null);
    flyRef.current = null;
    pendingCardRef.current = null;
    setView('slots');
  }, []);

  // —— 选牌：排位页 ↔ 牌轮页交替，牌从牌轮点击处飞入牌位 ——
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const flyRef = useRef<FlyState | null>(null);
  flyRef.current = fly;
  const pendingCardRef = useRef<{ idx: number; slotIdx: number; gx: number; gy: number } | null>(null);
  // 「事件配对」防幽灵 click（第五十四轮）：真实手势（pointerdown / 键盘 keydown）先武装本页，
  // 其配对的 click 才被放行并消费武装；没有手势来源的 click 一律视为幽灵。
  // 牌轮选牌用 pointerup 切页，原目标卸载后浏览器补发的那次 click 无任何新 pointerdown，
  // 必被根容器吞掉——确定性过滤，不依赖时间窗，补发再晚也拦得住。
  const clickArmedRef = useRef(false);
  const slotEls = useRef<(HTMLDivElement | null)[]>([]);
  const pageRef = useRef<HTMLDivElement>(null);
  const slotRefCb = useCallback((i: number, el: HTMLDivElement | null) => {
    slotEls.current[i] = el;
  }, []);

  const commitSlot = useCallback((slotIdx: number, idx: number) => {
    setSlots((prev) => {
      if (prev[slotIdx] != null) return prev;
      const n = [...prev];
      n[slotIdx] = idx;
      return n;
    });
  }, []);

  /** 牌轮页点牌：记下点击位置 → 切回排位页 → 牌从点击处飞入第 1 个空牌位 */
  const handleCardTap = useCallback(
    (idx: number, el: HTMLElement) => {
      if (pendingCardRef.current || flyRef.current) return;
      const slotIdx = slotsRef.current.findIndex((s) => s === null);
      if (slotIdx < 0) return;
      const pr = pageRef.current?.getBoundingClientRect();
      const sr = el.getBoundingClientRect();
      pendingCardRef.current = {
        idx,
        slotIdx,
        gx: sr.left + sr.width / 2 - (pr?.left ?? 0),
        gy: sr.top + sr.height / 2 - (pr?.top ?? 0),
      };
      // 选牌用 pointerup 触发，切页后浏览器还会补发一次 click；原目标已卸载时
      // 该 click 会被重新命中到排位页同位置的元素（牌位/按钮），误触「收回牌位」
      // 导致刚选的牌消失。本手势即将卸载自己的目标——主动解除武装，补发的 click
      // 因无配对 pointerdown 被根容器按幽灵吞掉（第五十四轮）。
      clickArmedRef.current = false;
      setView('slots');
    },
    [],
  );

  // 回到排位页后：若有待落牌，等布局稳定后启动飞牌动画
  useEffect(() => {
    if (view !== 'slots') return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const pend = pendingCardRef.current;
        if (!pend || flyRef.current) return;
        pendingCardRef.current = null;
        const slotEl = slotEls.current[pend.slotIdx];
        const pr = pageRef.current?.getBoundingClientRect();
        if (!slotEl || !pr) {
          commitSlot(pend.slotIdx, pend.idx);
          return;
        }
        const tr = slotEl.getBoundingClientRect();
        const rot = positionsRef.current[pend.slotIdx]?.rot ?? 0;
        const g: FlyState = {
          idx: pend.idx,
          slotIdx: pend.slotIdx,
          gx: pend.gx,
          gy: pend.gy,
          tx: tr.left + tr.width / 2 - pr.left,
          ty: tr.top + tr.height / 2 - pr.top,
          rot,
          sx: (rot === 90 ? tr.height : tr.width) / CARD_W,
          sy: (rot === 90 ? tr.width : tr.height) / CARD_H,
          go: false,
        };
        flyRef.current = g;
        setFly(g);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (flyRef.current !== g) return;
            const gg = { ...g, go: true };
            flyRef.current = gg;
            setFly(gg);
          }),
        );
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [view, commitSlot]);

  const onFlyEnd = useCallback(() => {
    const g = flyRef.current;
    if (!g) return;
    flyRef.current = null;
    setFly(null);
    commitSlot(g.slotIdx, g.idx);
  }, [commitSlot]);

  const handleSlotTap = useCallback((i: number) => {
    if (flyRef.current) return;
    setSlots((prev) => {
      if (prev[i] == null) return prev;
      const n = [...prev];
      n[i] = null;
      return n;
    });
  }, []);

  // —— 翻牌视图：逐张翻开 + AI 解读 ——
  const readingStarted = useRef(false);
  useEffect(() => {
    if (view !== 'reveal') return;
    const drawn = slots
      .filter((s): s is number => s !== null)
      .map((idx) => ({ def: TAROT_FULL_DECK[idx], reversed: revsRef.current[idx] ?? false }));
    if (drawn.length === 0) return;
    readingStarted.current = false;
    setFlipped(0);
    const timers: number[] = [];
    drawn.forEach((_, i) => {
      timers.push(window.setTimeout(() => setFlipped((f) => Math.max(f, i + 1)), 420 + i * 560));
    });
    timers.push(
      window.setTimeout(() => {
        if (readingStarted.current) return;
        readingStarted.current = true;
        const cards: TarotAiCard[] = drawn.map((c, i) => ({
          pos: positions[i]?.label ?? '牌面',
          posEn: positions[i]?.en,
          posHint: positions[i]?.hint,
          name: c.def.name,
          nameEn: c.def.nameEn,
          reversed: c.reversed,
          meaning: c.reversed ? c.def.reversed : c.def.upright,
          keys: c.reversed ? c.def.revKeys : c.def.upKeys,
        }));
        void (async () => {
          let res: { per: string[]; overall: string } | null = null;
          try {
            res = await aiTarotReading({
              themeLabel: theme?.label ?? '',
              question: theme?.custom ? customQ.trim() : undefined,
              spreadName: spread?.name ?? '',
              cards,
            });
          } catch {
            res = null;
          }
          const final = res ?? fallbackReading(positions, drawn);
          setReading({ ...final, aiUsed: !!res });
          // 持久化（按联系人隔离）+ 写记忆（塔罗事件）
          const record: TarotReading = {
            id: `tarot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            at: Date.now(),
            themeKey: theme?.key ?? 'custom',
            themeLabel: theme?.label ?? '',
            question: theme?.custom ? customQ.trim() : '',
            spreadKey: spread?.key ?? '',
            spreadName: spread?.name ?? '',
            spread: positions.map((p) => p.label),
            posEn: positions.map((p) => p.en),
            cards: drawn.map((c) => ({ defId: c.def.id, reversed: c.reversed })),
            per: final.per,
            overall: final.overall,
            aiUsed: !!res,
          };
          patch((prev) => ({
            tarotReadings: {
              ...(prev.tarotReadings ?? {}),
              [cid]: [record, ...((prev.tarotReadings ?? {})[cid] ?? [])].slice(0, 60),
            },
          }));
          const cardStr = drawn.map((c, i) => `${positions[i]?.label ?? ''}位-${c.def.name}${c.reversed ? '（逆位）' : ''}`).join('、');
          coupleTarotRemember(
            meta.partnerContactId ? cid : '',
            channel,
            `（塔罗事件）${meName}在情侣空间用塔罗牌以「${spread?.name ?? ''}」牌阵占卜「${theme?.label ?? ''}」${theme?.custom && customQ.trim() ? `（问题：${cutText(customQ.trim(), 24)}）` : ''}，抽到 ${cardStr}。${cutText(final.overall, 90)}`,
          );
          showToast('占卜完成，已写入你们的记忆');
        })();
      }, 420 + drawn.length * 560 + 340),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [view]);

  // —— 再来一次 ——
  const restart = useCallback(() => {
    setTheme(null);
    setCustomQ('');
    setSpread(null);
    setSpreadN(1);
    setSlots([]);
    setFlipped(0);
    setReading(null);
    setFly(null);
    flyRef.current = null;
    pendingCardRef.current = null;
    setShuffleCount(0);
    setShuffleTick(0);
    setScatter(makeScatter());
    setCutCount(0);
    setCutFlip(false);
    setCutting(false);
    setCutDone(false);
    setCutPhase('idle');
    setNeat(false);
    cuttingRef.current = false;
    setView('theme');
  }, []);

  const back = useCallback(() => {
    if (view === 'shuffle') setView('theme');
    else if (view === 'spread') setView('shuffle');
    else if (view === 'slots') {
      setSlots([]);
      setFly(null);
      flyRef.current = null;
      pendingCardRef.current = null;
      setView('spread');
    } else if (view === 'wheel') setView('slots');
    else if (view === 'reveal') restart();
    else if (view === 'history' || view === 'detail') setView('theme');
    else close();
  }, [view, close, restart]);

  const step = view === 'shuffle' ? 0 : view === 'spread' ? 1 : view === 'slots' || view === 'wheel' ? 2 : view === 'reveal' ? 3 : -1;

  return (
    <div
      ref={pageRef}
      className="relative flex h-full flex-col overflow-hidden bg-[#f1f2f4] text-gray-900 dark:bg-zinc-900 dark:text-zinc-100"
      onPointerDownCapture={() => {
        // 真实指针手势先武装：其后配对的 click 才会被放行（键盘 Enter/Space 走 onKeyDownCapture 同理）
        clickArmedRef.current = true;
      }}
      onKeyDownCapture={() => {
        clickArmedRef.current = true;
      }}
      onClickCapture={(e) => {
        // 幽灵 click 过滤（第五十四轮，替代 600ms 时间窗）：click 必须配对到本页内的
        // pointerdown/keydown 才合法；牌轮选牌（pointerup）切页后浏览器补发的那次没有
        // 新手势来源，无论延迟多久都被吞掉，防其命中牌位（误收回）/「去选牌」「翻牌」按钮（误跳页）
        if (clickArmedRef.current) {
          clickArmedRef.current = false;
        } else {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {/* 浅色氛围光斑 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-28 h-72 w-72 rounded-full bg-white/85 blur-3xl dark:bg-white/[0.07]" />
        <div className="absolute -right-24 top-1/4 h-72 w-72 rounded-full bg-gray-300/40 blur-3xl dark:bg-white/[0.05]" />
        <div className="absolute -bottom-20 left-1/5 h-64 w-64 rounded-full bg-white/80 blur-3xl dark:bg-white/[0.06]" />
      </div>

      {/* 顶栏（步骤条独占一行，不与标题重叠） */}
      <div className="relative z-10 shrink-0 pt-[54px]">
        <div className="relative flex h-11 items-center px-1.5">
          <button type="button" onClick={back} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-gray-800 transition-opacity active:opacity-50 dark:text-zinc-200">
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[16px] font-bold tracking-wide">爱情塔罗</div>
        </div>
        {step >= 0 && (
          <div className="flex justify-center pb-1">
            <StepBar step={step} />
          </div>
        )}
      </div>

      <div className="relative z-10 min-h-0 flex-1">
        {view === 'theme' && (
          <ThemeView
            themes={THEMES}
            customQ={customQ}
            setCustomQ={setCustomQ}
            onPick={(t) => {
              setTheme(t);
              setShuffleCount(0);
              setShuffleTick(0);
              setScatter(makeScatter());
              setCutCount(0);
              setCutFlip(false);
              setCutDone(false);
              setCutPhase('idle');
              setNeat(false);
              setView('shuffle');
            }}
            historyCount={readings.length}
            onHistory={() => setView('history')}
          />
        )}
        {view === 'shuffle' && theme && (
          <ShuffleView
            theme={theme}
            question={theme.custom ? customQ.trim() : ''}
            scatter={scatter}
            tick={shuffleTick}
            count={shuffleCount}
            cutting={cutting}
            cutPhase={cutPhase}
            cutFlip={cutFlip}
            cutDone={cutDone}
            neat={neat}
            holding={holding}
            onDown={pileDown}
            onUp={pileUp}
            onCut={doCut}
            onNext={() => setView('spread')}
          />
        )}
        {view === 'spread' && theme && (
          <SpreadView theme={theme} question={theme.custom ? customQ.trim() : ''} onStart={startSpread} />
        )}
        {view === 'slots' && theme && spread && (
          <SlotsView
            theme={theme}
            question={theme.custom ? customQ.trim() : ''}
            spread={spread}
            positions={positions}
            slots={slots}
            revsBySlot={revsBySlot}
            filledCount={filledCount}
            slotRefCb={slotRefCb}
            onSlotTap={handleSlotTap}
            onGoPick={() => setView('wheel')}
            onFlip={() => setView('reveal')}
          />
        )}
        {view === 'wheel' && theme && spread && (
          <WheelView
            theme={theme}
            question={theme.custom ? customQ.trim() : ''}
            spread={spread}
            positions={positions}
            slots={slots}
            filledCount={filledCount}
            onCardTap={handleCardTap}
            onBackToSlots={() => setView('slots')}
          />
        )}
        {view === 'reveal' && theme && spread && slots.length > 0 && (
          <RevealBody
            spread={spread}
            positions={positions}
            slots={slots}
            revsBySlot={revsBySlot}
            flippedCount={flipped}
            mode="flip"
            theme={{ label: theme.label }}
            question={theme.custom ? customQ.trim() : ''}
            reading={reading}
            footer={
              reading ? (
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setView('history')}
                    className="h-11 rounded-full border border-white/90 bg-white/65 text-[14px] font-medium text-gray-800 backdrop-blur-xl transition-opacity active:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-zinc-200"
                  >
                    占卜记录
                  </button>
                  <button
                    type="button"
                    onClick={restart}
                    data-testid="tarot-again"
                    className="h-11 rounded-full bg-gray-900 text-[14px] font-semibold text-white shadow-[0_6px_18px_rgba(17,24,39,0.22)] transition-all active:scale-[0.97] active:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    再占一次
                  </button>
                </div>
              ) : null
            }
          />
        )}
        {view === 'history' && (
          <HistoryView
            readings={readings}
            onBack={back}
            onOpen={(r) => {
              setDetail(r);
              setView('detail');
            }}
          />
        )}
        {view === 'detail' && detail && (
          <DetailPage
            reading={detail}
            onBack={() => {
              setDetail(null);
              setView('history');
            }}
            onDelete={onDeleteDetail}
          />
        )}
      </div>

      {/* 飞牌幽灵（挂顶层，坐标相对页面容器；排位页可见） */}
      {fly && view === 'slots' && <FlyGhost fly={fly} onEnd={onFlyEnd} />}
    </div>
  );

  // —— 删除历史记录 ——
  function onDeleteDetail() {
    if (!detail) return;
    patch((prev) => ({
      tarotReadings: {
        ...(prev.tarotReadings ?? {}),
        [cid]: ((prev.tarotReadings ?? {})[cid] ?? []).filter((r) => r.id !== detail.id),
      },
    }));
    showToast('已删除这条占卜记录');
    setDetail(null);
    setView('history');
  }
}

// ---------------- 历史详情 ----------------

function DetailPage({ reading, onBack, onDelete }: {
  reading: TarotReading;
  onBack: () => void;
  onDelete: () => void;
}) {
  const { spread, positions } = spreadInfoOf(reading);
  const slots = reading.cards.map((c) => Math.max(0, TAROT_FULL_DECK.findIndex((d) => d.id === c.defId)));
  const revsBySlot = reading.cards.map((c) => c.reversed);
  return (
    <RevealBody
      spread={spread}
      positions={positions}
      slots={slots}
      revsBySlot={revsBySlot}
      flippedCount={slots.length}
      mode="done"
      theme={{ label: reading.themeLabel }}
      question={reading.question}
      reading={reading.per.length > 0 || reading.overall ? { per: reading.per, overall: reading.overall, aiUsed: reading.aiUsed } : null}
      footer={
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onDelete}
            className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-red-200 bg-red-50/80 text-[14px] font-medium text-red-600 transition-opacity active:opacity-60 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
            删除
          </button>
          <button type="button" onClick={onBack} className="h-11 rounded-full border border-white/90 bg-white/65 text-[14px] font-medium text-gray-800 backdrop-blur-xl transition-opacity active:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-zinc-200">
            返回列表
          </button>
        </div>
      }
    />
  );
}
