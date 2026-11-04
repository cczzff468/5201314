'use client';

/**
 * 情书信封卡片气泡（第十八轮）——微信/QQ 聊天共用。
 *
 * 用户规格（第七批）：AI 写给我的信（AI 也可以主动写信/回信）以信封卡片发到聊天里，
 * 点击卡片直接进入信件页面（LettersPage 消费 pendingLetterOpen，不进情侣空间主页）。
 * 样式仿亲密关系卡（couple-rel-bubble / couple-pact-bubble）的白底卡：
 * 左侧卡通信封缩略图 + 右侧「XX的情书」+ 信开头摘要 + 底部「情书」小字标签 / 「拆信」按钮。
 *
 * 本文件同时导出信封样式库 LETTER_ENVELOPES 与信封图形组件 EnvelopeArt，
 * 供情侣空间情书页（选样式/主视图/详情/寄出预览）复用同一套视觉。
 *
 * 第十九轮（用户要求：信封封面再美化一下，不要 emoji 表情）：
 * - 底纹（爪印/星星/爱心/云朵/圆点）、火漆贴纸、底部一排小动物全部改为 SVG 手绘；
 * - 封口盖顶部加蕾丝花边（SVG 扇贝边），右上角加「恋人邮局 LOVE POST」圆形邮戳。
 *
 * 第二十八轮（参考「衔纸的鸽」信封信纸图）：
 * - 邮戳下移避开蕾丝花边（原 top 4% 紧贴顶边且被信箱「可拆信」角标压住），缩小到 21% 并微调角度；
 * - 信封正面新增收信字样「致 最爱的你 · 亲启」+ 英文小字（仿参考图封面手写体排版，cqw 缩放）；
 * - 新增 dove 底纹（飞鸟剪影）与 dove 小动物（衔信白鸽）；
 * - 新增两款信封样式：白羽信鸽（米白+酒红，参考图同款气质）、蔷薇飞鸟（粉蔷薇）。
 */

import type { CoupleLetterCardData } from '@/lib/ios/couple-letter-share';
import { navToLetter } from '@/lib/ios/couple-letter-share';
import { kvGet } from '@/lib/ios/idb-kv';
import { useUI } from '@/lib/ios/store';

// ---------------- 信封样式库（参考用户两张信封截图：粉色爪印兔子信封 / 黄色星星小狗信封） ----------------

export interface LetterEnvelopeStyle {
  key: string;
  name: string;
  body: string; // 信封底渐变
  flap: string; // 封口盖颜色
  seal: string; // 火漆印颜色
  sticker: string; // 火漆上的贴纸（第十九轮起按此字符映射为 SVG 图形，不再渲染 emoji）
  pets: string; // 底部一排小动物（第十九轮起按字符映射为 SVG 小动物脸）
  pattern: 'paw' | 'star' | 'heart' | 'cloud' | 'dot' | 'dove';
  patternColor: string; // 底纹颜色
  accent: string; // 强调色（选中描边等）
}

export const LETTER_ENVELOPES: LetterEnvelopeStyle[] = [
  { key: 'pinkbunny', name: '粉兔信笺', body: 'linear-gradient(160deg,#fbd9e2,#f6c3d2)', flap: '#f3b4c6', seal: '#e88ba4', sticker: '💌', pets: '🐰🐨🐰🐰', pattern: 'paw', patternColor: 'rgba(235,150,175,0.34)', accent: '#e88ba4' },
  { key: 'yellowpup', name: '暖黄小狗', body: 'linear-gradient(160deg,#fbe3a2,#f8d476)', flap: '#f5cd66', seal: '#e2b34c', sticker: '🌟', pets: '🐶⭐️🐶', pattern: 'star', patternColor: 'rgba(226,160,70,0.28)', accent: '#e2a03e' },
  { key: 'lavendrcat', name: '香芋小猫', body: 'linear-gradient(160deg,#e6dcf7,#d8c9f0)', flap: '#cdbcec', seal: '#a98fe0', sticker: '🌙', pets: '🐱🐭🐱', pattern: 'paw', patternColor: 'rgba(150,125,205,0.24)', accent: '#a98fe0' },
  { key: 'mintbear', name: '薄荷小熊', body: 'linear-gradient(160deg,#d4f2e2,#b8e8d0)', flap: '#a9e0c4', seal: '#6fc7a0', sticker: '🌿', pets: '🐻🐰🐻', pattern: 'dot', patternColor: 'rgba(100,180,145,0.22)', accent: '#6fc7a0' },
  { key: 'skybunny', name: '晴空云朵', body: 'linear-gradient(160deg,#cfe7fb,#b3d9f5)', flap: '#a8cef2', seal: '#7fb2e8', sticker: '☁️', pets: '🐰☁️🐰', pattern: 'cloud', patternColor: 'rgba(110,160,220,0.24)', accent: '#7fb2e8' },
  { key: 'kraft', name: '牛皮复古', body: 'linear-gradient(160deg,#ead9bd,#dcc39c)', flap: '#d3b98e', seal: '#b98a5a', sticker: '❤️', pets: '🐻🦊🐻', pattern: 'heart', patternColor: 'rgba(160,110,60,0.2)', accent: '#b98a5a' },
  // 第二十八轮新增（参考「衔纸的鸽」信封图）：白羽信鸽 —— 米白纸面 + 酒红邮戳火漆，复古信鸽气质
  { key: 'whitedove', name: '白羽信鸽', body: 'linear-gradient(160deg,#f8f3e8,#f0e7d2)', flap: '#ecdfc4', seal: '#a13a52', sticker: '💌', pets: '🕊️☁️🕊️', pattern: 'dove', patternColor: 'rgba(161,58,82,0.15)', accent: '#a13a52' },
  { key: 'rosedove', name: '蔷薇飞鸟', body: 'linear-gradient(160deg,#fbeee9,#f6dcd1)', flap: '#f3ccb9', seal: '#c96a72', sticker: '💌', pets: '🕊️🐰🕊️', pattern: 'heart', patternColor: 'rgba(201,106,114,0.2)', accent: '#c96a72' },
];

export function letterEnvelopeOf(key: string | undefined): LetterEnvelopeStyle {
  return LETTER_ENVELOPES.find((e) => e.key === key) ?? LETTER_ENVELOPES[0];
}

// ---------------- SVG 图形库（第十九轮：全信封零 emoji） ----------------

/** 底纹图形（爪印/星星/爱心/云朵；圆点由调用方直接画 span） */
function PatternGlyph({ pattern, color, size }: { pattern: LetterEnvelopeStyle['pattern']; color: string; size: number }) {
  const svgProps = { width: size, height: size, viewBox: '0 0 20 20', fill: color, 'aria-hidden': true } as const;
  if (pattern === 'paw') {
    return (
      <svg {...svgProps}>
        <ellipse cx="10" cy="12.8" rx="4.7" ry="3.9" />
        <circle cx="4.4" cy="7.8" r="2.05" />
        <circle cx="8.3" cy="4.9" r="2.15" />
        <circle cx="12.7" cy="4.9" r="2.15" />
        <circle cx="15.9" cy="7.8" r="2.05" />
      </svg>
    );
  }
  if (pattern === 'star') {
    return (
      <svg {...svgProps}>
        <path d="M10 1.3 12.4 7l6.1.5-4.7 4 1.5 6-5.3-3.3L4.7 17.5l1.5-6-4.7-4L7.6 7Z" />
      </svg>
    );
  }
  if (pattern === 'heart') {
    return (
      <svg {...svgProps}>
        <path d="M10 17.6 3.1 10.9a4.35 4.35 0 0 1 0-6.2 4.25 4.25 0 0 1 6.1 0l.8.8.8-.8a4.25 4.25 0 0 1 6.1 0 4.35 4.35 0 0 1 0 6.2Z" />
      </svg>
    );
  }
  if (pattern === 'cloud') {
    return (
      <svg {...svgProps}>
        <path d="M6.2 14.8a3.5 3.5 0 0 1-.4-7 4.7 4.7 0 0 1 9.1.9 3.1 3.1 0 0 1-.5 6.1Z" />
      </svg>
    );
  }
  if (pattern === 'dove') {
    // 飞鸟剪影（同色 compound 拼成小鸟：身+双翅+头+尾）
    return (
      <svg {...svgProps}>
        <ellipse cx="10.5" cy="12.6" rx="5.2" ry="3.6" />
        <path d="M10.5 9.6C9 6.9 6.2 5.5 3 5.7c1.4 1.9 3.4 3.1 5.8 3.4Z" />
        <path d="M12.6 9.3c.6-2.8 2.6-4.8 5.6-5.4-.4 2.3-1.9 4.1-4.1 5Z" />
        <circle cx="15.3" cy="11.7" r="2.2" />
        <path d="M5.6 12.3 2.4 14.1l3.4.4Z" />
      </svg>
    );
  }
  return null;
}

type PetKind = 'bunny' | 'koala' | 'pup' | 'cat' | 'mouse' | 'bear' | 'fox' | 'star' | 'cloud' | 'dove';

export function petKindOf(ch: string): PetKind | null {
  if (ch === '🐰') return 'bunny';
  if (ch === '🐨') return 'koala';
  if (ch === '🐶') return 'pup';
  if (ch === '🐱') return 'cat';
  if (ch === '🐭') return 'mouse';
  if (ch === '🐻') return 'bear';
  if (ch === '🦊') return 'fox';
  if (ch === '🕊️' || ch === '🕊') return 'dove';
  if (ch === '⭐️' || ch === '⭐' || ch === '🌟') return 'star';
  if (ch === '☁️' || ch === '☁') return 'cloud';
  return null;
}

const PET_COLORS: Record<PetKind, { face: string; inner: string; line: string }> = {
  bunny: { face: '#ffffff', inner: '#f7b8c8', line: 'rgba(0,0,0,0.14)' },
  koala: { face: '#bcc3cf', inner: '#f2cdd6', line: 'rgba(0,0,0,0.16)' },
  pup: { face: '#f6ddab', inner: '#e9b97e', line: 'rgba(0,0,0,0.15)' },
  cat: { face: '#d9cdf2', inner: '#f2cdd6', line: 'rgba(0,0,0,0.15)' },
  mouse: { face: '#e4defa', inner: '#f2cdd6', line: 'rgba(0,0,0,0.14)' },
  bear: { face: '#cf9d6d', inner: '#e9c193', line: 'rgba(0,0,0,0.18)' },
  fox: { face: '#f0a45f', inner: '#fbe0c3', line: 'rgba(0,0,0,0.16)' },
  star: { face: '#ffd968', inner: '#ffe9a8', line: 'rgba(0,0,0,0.10)' },
  cloud: { face: '#ffffff', inner: '#eef4fb', line: 'rgba(0,0,0,0.08)' },
  dove: { face: '#ffffff', inner: '#f3ece0', line: 'rgba(0,0,0,0.12)' },
};

/** SVG 小动物脸（卡通信风：耳朵 + 圆脸 + 点点眼 + 腮红 + 微笑），替代原 emoji 小动物；
 *  尺寸走父容器 cqw（containerType:inline-size），任意缩放清晰；第二十八轮导出供信纸角落装饰复用 */
export function PetFace({ kind }: { kind: PetKind }) {
  const c = PET_COLORS[kind];
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', width: 'clamp(10px, 15cqw, 19px)', height: 'auto', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.10))' }}>
      {/* 耳朵 */}
      {kind === 'bunny' && (
        <>
          <ellipse cx="8" cy="5.4" rx="2.3" ry="4.2" fill={c.face} stroke={c.line} strokeWidth="0.7" />
          <ellipse cx="16" cy="5.4" rx="2.3" ry="4.2" fill={c.face} stroke={c.line} strokeWidth="0.7" />
          <ellipse cx="8" cy="6" rx="1.05" ry="2.6" fill={c.inner} />
          <ellipse cx="16" cy="6" rx="1.05" ry="2.6" fill={c.inner} />
        </>
      )}
      {(kind === 'bear' || kind === 'koala' || kind === 'mouse') && (
        <>
          <circle cx="5.6" cy="6.4" r={kind === 'mouse' ? 2.8 : 3.4} fill={c.face} stroke={c.line} strokeWidth="0.7" />
          <circle cx="18.4" cy="6.4" r={kind === 'mouse' ? 2.8 : 3.4} fill={c.face} stroke={c.line} strokeWidth="0.7" />
          <circle cx="5.6" cy="6.4" r={kind === 'mouse' ? 1.3 : 1.6} fill={c.inner} />
          <circle cx="18.4" cy="6.4" r={kind === 'mouse' ? 1.3 : 1.6} fill={c.inner} />
        </>
      )}
      {(kind === 'cat' || kind === 'fox') && (
        <>
          <path d="M4.4 9.6 5.6 3l4 3.4Z" fill={c.face} stroke={c.line} strokeWidth="0.7" strokeLinejoin="round" />
          <path d="M19.6 9.6 18.4 3l-4 3.4Z" fill={c.face} stroke={c.line} strokeWidth="0.7" strokeLinejoin="round" />
          <path d="M5.9 7.6 6.4 5l1.9 1.6Z" fill={c.inner} />
          <path d="M18.1 7.6 17.6 5l-1.9 1.6Z" fill={c.inner} />
        </>
      )}
      {kind === 'pup' && (
        <>
          <ellipse cx="4.8" cy="9.4" rx="2.1" ry="3.6" fill={c.inner} stroke={c.line} strokeWidth="0.7" transform="rotate(14 4.8 9.4)" />
          <ellipse cx="19.2" cy="9.4" rx="2.1" ry="3.6" fill={c.inner} stroke={c.line} strokeWidth="0.7" transform="rotate(-14 19.2 9.4)" />
        </>
      )}
      {kind === 'dove' && (
        <>
          {/* 衔信白鸽：两侧小翅膀（橙黄小喙画在五官区替代嘴巴） */}
          <ellipse cx="3.6" cy="13.8" rx="2.5" ry="4" fill={c.inner} stroke={c.line} strokeWidth="0.7" transform="rotate(18 3.6 13.8)" />
          <ellipse cx="20.4" cy="13.8" rx="2.5" ry="4" fill={c.inner} stroke={c.line} strokeWidth="0.7" transform="rotate(-18 20.4 13.8)" />
          <path d="M6.4 8.2q2.2 -2.4 4.4 -0.6" fill="none" stroke={c.line} strokeWidth="0.6" strokeLinecap="round" />
          <path d="M17.6 8.2q-2.2 -2.4 -4.4 -0.6" fill="none" stroke={c.line} strokeWidth="0.6" strokeLinecap="round" />
        </>
      )}
      {kind === 'star' && (
        <path d="M12 1.8 14.6 7.6 20.9 8.2 16.2 12.4 17.6 18.6 12 15.4 6.4 18.6 7.8 12.4 3.1 8.2 9.4 7.6Z" fill={c.face} stroke={c.line} strokeWidth="0.7" strokeLinejoin="round" />
      )}
      {kind === 'cloud' && (
        <path d="M7 16.5a3.6 3.6 0 0 1-.4-7.2 4.9 4.9 0 0 1 9.4.9 3.2 3.2 0 0 1-.5 6.3Z" fill={c.face} stroke={c.line} strokeWidth="0.7" />
      )}
      {/* 圆脸（星星/云朵自撑形状，不再叠圆） */}
      {kind !== 'star' && kind !== 'cloud' && <circle cx="12" cy="13.6" r="8" fill={c.face} stroke={c.line} strokeWidth="0.8" />}
      {/* 五官 */}
      <circle cx="9.2" cy="12.6" r="1.05" fill="#3c3c44" />
      <circle cx="14.8" cy="12.6" r="1.05" fill="#3c3c44" />
      <circle cx="6.9" cy="15.6" r="1.55" fill="#f7a8bc" opacity="0.6" />
      <circle cx="17.1" cy="15.6" r="1.55" fill="#f7a8bc" opacity="0.6" />
      {kind !== 'dove' && <path d="M10.9 15.9q1.1 1 2.2 0" stroke="#3c3c44" strokeWidth="0.9" fill="none" strokeLinecap="round" />}
      {kind === 'dove' && <path d="M10.5 16.1 L13.5 16.1 L12 18.5 Z" fill="#e8a04c" stroke="rgba(0,0,0,0.10)" strokeWidth="0.4" strokeLinejoin="round" />}
      {(kind === 'cat' || kind === 'mouse' || kind === 'fox') && (
        <path d="M11.2 14.2 12 15l.8-.8" fill="none" stroke="#3c3c44" strokeWidth="0.8" strokeLinejoin="round" />
      )}
      {kind === 'pup' && <ellipse cx="12" cy="14.9" rx="1.15" ry="0.85" fill="#3c3c44" />}
    </svg>
  );
}

/** 火漆贴纸图形（按原 emoji 字符映射为 SVG：爱心/星星/月亮/叶子/云朵），替代 emoji */
function SealGlyph({ ch, color }: { ch: string; color: string }) {
  const svgProps = { width: '58%', height: '58%', viewBox: '0 0 20 20', fill: color, 'aria-hidden': true } as const;
  if (ch === '🌟' || ch === '⭐️' || ch === '⭐') {
    return (
      <svg {...svgProps}>
        <path d="M10 1.3 12.4 7l6.1.5-4.7 4 1.5 6-5.3-3.3L4.7 17.5l1.5-6-4.7-4L7.6 7Z" />
      </svg>
    );
  }
  if (ch === '🌙') {
    return (
      <svg {...svgProps}>
        <path d="M15.6 12.4A6.6 6.6 0 0 1 7.6 4a6.9 6.9 0 1 0 8 8.4Z" />
      </svg>
    );
  }
  if (ch === '🌿') {
    return (
      <svg {...svgProps}>
        <path d="M16.5 3.5c-6 .4-10.4 3-11.6 8.2-.3 1.5-.2 3 .1 4.3l1.6-.4C6 12 8.4 8.6 12.6 6.4c-3.4 2.7-5.6 5.8-6.4 9.4l1.6.3c.9-3.4 3.3-6 7.5-7.6-3 2.3-4.7 4.6-5.3 7.3 4.9.2 8-3.4 8.2-8.9.05-1.2-.4-3.4-1.7-3.4Z" />
      </svg>
    );
  }
  if (ch === '☁️' || ch === '☁') {
    return (
      <svg {...svgProps}>
        <path d="M6.2 14.8a3.5 3.5 0 0 1-.4-7 4.7 4.7 0 0 1 9.1.9 3.1 3.1 0 0 1-.5 6.1Z" />
      </svg>
    );
  }
  // 💌 / ❤️ 及缺省：爱心
  return (
    <svg {...svgProps}>
      <path d="M10 17.6 3.1 10.9a4.35 4.35 0 0 1 0-6.2 4.25 4.25 0 0 1 6.1 0l.8.8.8-.8a4.25 4.25 0 0 1 6.1 0 4.35 4.35 0 0 1 0 6.2Z" />
    </svg>
  );
}

/** 蕾丝花边（封口盖顶部一排扇贝边，SVG 扁平铺满宽度） */
function LaceTrim({ color }: { color: string }) {
  const scallops = Array.from({ length: 21 }, (_, i) => `q2.5 -5 5 0`).join(' ');
  return (
    <svg viewBox="0 0 105 6" preserveAspectRatio="none" className="absolute inset-x-0 top-0 h-[8%] w-full" aria-hidden="true">
      <path d={`M0 6 ${scallops} V6 Z`} fill={color} opacity="0.9" />
      <circle cx="2.5" cy="2.2" r="0.55" fill="#ffffff" opacity="0.9" />
      <circle cx="52.5" cy="2.2" r="0.55" fill="#ffffff" opacity="0.9" />
      <circle cx="102.5" cy="2.2" r="0.55" fill="#ffffff" opacity="0.9" />
    </svg>
  );
}

/** 恋人邮局圆形邮戳（右上角，纯 SVG 文字 + 波浪戳线；
 *  第二十八轮位置调整：下移避开顶部蕾丝花边、缩小防止被信箱角标完全遮挡，角度微调） */
function Postmark({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 34 34" className="absolute right-[5%] top-[8.5%] w-[21%] max-w-[38px]" style={{ transform: 'rotate(8deg)', opacity: 0.9 }} aria-hidden="true">
      <circle cx="17" cy="17" r="15.2" fill="none" stroke={color} strokeWidth="1.6" />
      <circle cx="17" cy="17" r="10.6" fill="none" stroke={color} strokeWidth="0.9" />
      <text x="17" y="15.2" textAnchor="middle" fontSize="6.4" fontWeight="700" fill={color} style={{ letterSpacing: '0.5px' }}>
        恋人邮局
      </text>
      <text x="17" y="22.4" textAnchor="middle" fontSize="4.6" fontWeight="600" fill={color} style={{ letterSpacing: '0.8px' }}>
        LOVE POST
      </text>
    </svg>
  );
}

/** 信封底纹（爪印/星星/爱心/云朵/圆点，SVG 图形绝对定位铺满） */
function EnvelopePattern({ style }: { style: LetterEnvelopeStyle }) {
  const items = Array.from({ length: 10 }, (_, i) => i);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((i) => {
        const left = `${(i * 23 + 6) % 88}%`;
        const top = `${(i * 41 + 6) % 72}%`;
        const size = i % 3 === 0 ? 12 : 9;
        if (style.pattern === 'dot') {
          return <span key={i} className="absolute rounded-full" style={{ left: `${(i * 23 + 8) % 92}%`, top: `${(i * 37 + 10) % 78}%`, width: 5, height: 5, background: style.patternColor }} />;
        }
        return (
          <span key={i} className="absolute" style={{ left, top, transform: `rotate(${((i * 53) % 40) - 20}deg)` }}>
            <PatternGlyph pattern={style.pattern} color={style.patternColor} size={size} />
          </span>
        );
      })}
    </div>
  );
}

/**
 * 卡通信封图形（情侣空间情书页与聊天卡片共用；第十九轮重绘：零 emoji 全 SVG；第二十轮美化 + 头像火漆）：
 * 信封身 + 底纹 + 内衼信纸探头 + V 形封口盖（渐变高光）+ 顶部蕾丝花边 + 圆形火漆印
 * （传 avatar 时火漆位改盖发件人头像印章）+ 右上角恋人邮局邮戳 + 底部一排 SVG 小动物 + 内描边。
 * 第二十九轮：收信字样可自定义（faceText 传入信封上的第一行字；空/缺省 = 默认「致 最爱的你」，
 * 第二行「· 亲 启 ·」保持装饰样式不变）。
 */
export function EnvelopeArt({ envKey, className = '', pets = true, avatar, faceText }: { envKey?: string; className?: string; pets?: boolean; avatar?: string | null; faceText?: string | null }) {
  const st = letterEnvelopeOf(envKey);
  const petKinds = Array.from(st.pets).map(petKindOf).filter((k): k is PetKind => k !== null);
  const sealInk = 'rgba(255,255,255,0.92)';
  const customLine = (faceText ?? '').trim() || '致 最爱的你'; // 收信字样第一行（第二十九轮可自定义，空 = 默认）
  return (
    <div aria-hidden="true" className={`relative overflow-hidden ${className}`} style={{ background: st.body, borderRadius: 10, containerType: 'inline-size' }}>
      <EnvelopePattern style={st} />
      {/* 内衼信纸探头（封口盖后露出一截信纸，更像真的信封） */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-[3%] -translate-x-1/2"
        style={{ width: '44%', height: '13%', background: 'linear-gradient(180deg,#ffffff,#f7f4ea)', borderRadius: '3px 3px 0 0', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}
      >
        <div style={{ margin: '22% 14% 0', height: '1.5px', background: 'rgba(0,0,0,0.08)', borderRadius: 2 }} />
        <div style={{ margin: '16% 14% 0', height: '1.5px', background: 'rgba(0,0,0,0.08)', borderRadius: 2 }} />
      </div>
      {/* V 形封口盖（叠一层自上而下的微高光） */}
      <div
        className="absolute inset-x-0 top-0"
        style={{
          height: '58%',
          background: `linear-gradient(180deg, rgba(255,255,255,0.30), rgba(255,255,255,0) 42%), ${st.flap}`,
          clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
          boxShadow: '0 1px 0 rgba(255,255,255,0.35) inset',
        }}
      />
      {/* 封口盖折边描边 */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0" style={{ height: '58%', clipPath: 'polygon(0 0, 100% 0, 50% 100%)', background: 'transparent', boxShadow: '0 -1.5px 0 rgba(255,255,255,0.5) inset' }} />
      {/* 顶部蕾丝花边（压在封口盖上沿） */}
      <LaceTrim color="rgba(255,255,255,0.85)" />
      {/* 右上角邮戳 */}
      <Postmark color={st.accent} />
      {/* 火漆印 / 发件人头像印章（第二十轮：头像位置调整至封口尖角正中，与参考图一致） */}
      {avatar ? (
        <div
          className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full"
          style={{
            width: '26%',
            aspectRatio: '1 / 1',
            background: st.seal,
            border: '2.5px solid rgba(255,255,255,0.92)',
            boxShadow: '0 3px 8px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.05)',
            padding: '1.5px',
          }}
        >
          <img src={avatar} alt="" draggable={false} className="h-full w-full rounded-full object-cover" />
        </div>
      ) : (
        <div
          className="absolute left-1/2 top-[44%] flex h-[30%] w-[20%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
          style={{
            background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.5), rgba(255,255,255,0) 55%), ${st.seal}`,
            border: '2px solid rgba(255,255,255,0.75)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
          }}
        >
          <SealGlyph ch={st.sticker} color={sealInk} />
        </div>
      )}
      {/* 收信字样（第二十八轮：仿参考信封封面手写体排版，cqw 缩放适配任意尺寸；位于火漆下方、小动物上方；容器宽度过小时由 globals.css @container 规则自动隐藏）
          第二十九轮：第一行支持自定义（faceText 整行替换；空 = 默认「致 最爱的你」）；长文字自动收紧字距防溢出 */}
      <div aria-hidden="true" className="letter-env-face absolute inset-x-0 flex flex-col items-center" style={{ top: '70.5%' }}>
        <span style={{ fontFamily: 'KaiTi,"Kaiti SC",STKaiti,serif', fontSize: 'clamp(9px, 5.4cqw, 17px)', letterSpacing: customLine.length > 6 ? '0.12em' : '0.3em', textIndent: '0.3em', lineHeight: 1.25, color: 'rgba(96,60,52,0.55)', maxWidth: '92%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {customLine}
        </span>
        <span style={{ marginTop: '0.8%', fontSize: 'clamp(6px, 2.8cqw, 9.5px)', letterSpacing: '0.42em', textIndent: '0.42em', fontFamily: 'KaiTi,"Kaiti SC",STKaiti,serif', color: 'rgba(96,60,52,0.42)' }}>
          · 亲 启 ·
        </span>
      </div>
      {/* 底部一排 SVG 小动物 */}
      {pets && petKinds.length > 0 && (
        <div className="absolute inset-x-0 bottom-[3%] flex items-end justify-center" style={{ gap: '4cqw' }}>
          {petKinds.map((k, i) => (
            <PetFace key={i} kind={k} />
          ))}
        </div>
      )}
      {/* 内描边（信封边缘一圈细白线，更有纸质感） */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[10px]" style={{ boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.35), inset 0 -10px 18px rgba(0,0,0,0.05)' }} />
    </div>
  );
}

// ---------------- 聊天气泡 ----------------

export default function CoupleLetterBubble({ data, mine, testidPrefix = 'wx' }: { data: CoupleLetterCardData; mine: boolean; testidPrefix?: string }) {
  /** 点击卡片 → 进情侣空间信件页面（任何状态都直达信件详情；不进情侣空间主页） */
  const openLetter = () => {
    const ui = useUI.getState();
    if (ui.locked) return;
    navToLetter({
      letterId: data.letterId,
      from: data.from,
      envelope: data.envelope,
      snippet: data.snippet,
      replyToId: data.replyToId,
      channel: data.app,
      contactId: data.contactId,
    });
    if (ui.activeApp && ui.activeApp !== 'couple') ui.switchToApp('couple');
    else if (!ui.activeApp && ui.phase === 'closed') ui.openApp('couple');
  };
  void mine;

  // 第二十三轮（用户反馈）：分享卡片不显示时间、不显示「可拆信」徽章——只有分享卡片不显示（信箱列表照旧），
  // 整张卡就是一枚纯净的信封（火漆位仍是头像），点卡片直接读信
  let avatar: string | null = null;
  let envText: string | undefined;
  try {
    const snap = kvGet<Record<string, unknown>>('couple-space:state');
    if (data.from === 'ta') avatar = (snap?.taAvatar as string | null) ?? null;
    else avatar = ((snap?.letterSenderAvatar as string) || (snap?.meAvatar as string) || '') || null;
    // 第二十九轮：信封收信字样可自定义——我的信带自定义字样（卡片落库时已写入 data.envText），
    // 旧卡片/TA 的信没有该字段 → 走 EnvelopeArt 默认「致 最爱的你」
    if (typeof data.envText === 'string' && data.envText.trim()) envText = data.envText;
    else if (data.from === 'me' && typeof snap?.letterEnvText === 'string' && snap.letterEnvText.trim()) envText = snap.letterEnvText;
  } catch {
    /* 读不到就用纯火漆印 */
  }

  return (
    <button
      type="button"
      data-testid={`${testidPrefix}-letter-card`}
      onClick={(e) => {
        e.stopPropagation();
        openLetter();
      }}
      className="relative block w-[248px] cursor-pointer select-none overflow-hidden rounded-[10px] shadow-sm transition-transform active:scale-[0.985] dark:shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
    >
      <EnvelopeArt envKey={data.envelope} className="h-[132px] w-full" pets avatar={avatar} faceText={envText} />
    </button>
  );
}
