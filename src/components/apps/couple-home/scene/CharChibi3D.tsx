'use client';

/* eslint-disable react-hooks/immutability -- R3F 动画需要每帧原地修改 three 对象 */

/**
 * 拾光小屋 3D —— Q版萌系小人 v2（纯程序化建模，自研造型）
 *
 * 设计目标「好看的头身比 + 精致的脸」：
 * - 约 2.2 头身：大圆头（微扁）+ 圆润短身短手短腿，无脖颈衔接的软萌轮廓；
 * - 脸：竖椭圆大眼睛（眼白+深棕瞳仁+双层高光+上眼线）、细弯眉、
 *   径向渐变腮红、小巧鼻子、微笑弧线嘴；随机眨眼 + 待机歪头；
 * - 发型（女主衣柜 v6.7 一体发壳）：双马尾 / 高马尾 / 短发 / 长直发 / 大波浪，
 *   球面贴片拼成一整片顺滑头发：齐刘海压眉一条线、脸侧无垂发、马尾全在脑后；
 *   男主衣柜 v6.3：顺滑短发 / 蓬松卷发 / 中分刘海 / 活力刺猬；
 * - 服装（女主 v6.2 + 男生 v6.3 + 调色盘）：连衣裙 ×4 / 分体上衣 ×4 / 半裙·短裤·长裤 / 鞋 ×4，
 *   男生上衣/裤子/鞋 ×4，hair/dress/top/bottom/shoes 均可自选色（wear.tints / wear2.tints），
 *   经 wear / wear2 prop 驱动，泡澡/淋浴自动脱衣；
 * - 骨架与姿势系统沿用 v5.4+：走路摆臂迈腿弹跳 / 呼吸 / 坐 / 躺 / 泡澡 / 淋浴 /
 *   做饭 / 吃饭 / 喝东西 / 弹琴 / 弹吉他 / 化妆 / 照镜子 / 看书，全部阻尼过渡；
 * - 道具：咖啡/冰饮（右手，站着会周期性举杯咪一口）、书（翻页）、Zzz、
 *   泡澡/淋浴泡沫、化妆星星、访客头顶名牌；弹琴/扫弦手部随音符脉冲。
 * - 朝向与移动由 GameLoop 每帧写 rt（与旧 Char3D 同接口，含 guest 访客）。
 */

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { onNote } from '../instrument';
import type { BoyWear, CharPose, CharRT, GirlWear } from '../types';
import { BOY_BOTTOMS, BOY_SHOES, BOY_TOPS, BOTTOMS, DRESSES, SHOES, TOPS } from '../wardrobe-data';

export interface CharChibi3DProps {
  rt: CharRT;
  who: 'me' | 'partner' | 'guest';
  /** 隐藏（第一人称时隐藏「我」） */
  hide?: boolean;
  /** 姿势（「我」专属；partner/访客永远站立） */
  poseRef?: RefObject<{ pose: CharPose; y: number }>;
  /** 陪伴小人姿势（v8.0 who='partner' 时生效：拥抱/牵手/坐下等由 companion-rt 写入） */
  poseRef2?: RefObject<{ pose: CharPose; y: number }>;
  /** 手持物（true = 右手握小水杯，拿饮料/咖啡后端着到处逛；coffee = 咖啡款冒热气） */
  carryRef?: RefObject<{ cup: boolean; coffee?: boolean; pet?: boolean }>; // v7.2 pet=true：怀里抱着小猫（双臂环抱）
  /** 访客名牌（头顶浮名字牌；缺省不挂） */
  guestName?: string;
  /** 女主衣柜穿搭（who = 'me' 时生效：发型 + 连衣裙/分体 + 鞋 + 调色盘） */
  wear?: GirlWear;
  /** 男生衣柜穿搭（who = 'partner' 时生效：发型 + 上衣/裤子/鞋 + 调色盘） */
  wear2?: BoyWear;
  /** 点击热区（v8.0：点小人触发回调，如拥抱/牵手环形菜单；不传不建热区） */
  onTap?: () => void;
  /** v11 长按热区（生活模式长按陪伴小人 ≥550ms 触发一次；触发后本轮抬起不再触发 onTap） */
  onLongPress?: () => void;
}

/** 穿搭色板：skin 肤色 / hair 发色 / top 上衣(裙) / bottom 短裤(男主) / sock 袜 / shoes 鞋 / bow 发饰 / blush 腮红 */
interface Palette {
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  sock: string;
  shoes: string;
  bow: string;
  blush: string;
}

const OUTFITS: Record<'me' | 'partner' | 'guest', Palette[]> = {
  me: [
    // 樱粉连衣裙（默认）
    { skin: '#ffe9dc', hair: '#6b4a38', top: '#f7c6d2', bottom: '#f7c6d2', sock: '#ffffff', shoes: '#b06a5a', bow: '#f591ac', blush: '#f7a8b4' },
    // 薄荷奶昔
    { skin: '#ffe9dc', hair: '#6b4a38', top: '#c2e4d2', bottom: '#c2e4d2', sock: '#ffffff', shoes: '#8fae9c', bow: '#8fd0b4', blush: '#f7a8b4' },
    // 奶油杏子
    { skin: '#ffe9dc', hair: '#6b4a38', top: '#f6dfb2', bottom: '#f6dfb2', sock: '#fff8ee', shoes: '#c78d64', bow: '#f0b45c', blush: '#f7a8b4' },
  ],
  partner: [
    // 奶油卫衣 + 藏蓝短裤（默认）
    { skin: '#ffe4cf', hair: '#2f2b29', top: '#f7f1e3', bottom: '#46536b', sock: '#ffffff', shoes: '#fbfaf7', bow: '#f7f1e3', blush: '#f4b3aa' },
    // 燕麦暖男
    { skin: '#ffe4cf', hair: '#2f2b29', top: '#cdb69c', bottom: '#5d544a', sock: '#f6f2ea', shoes: '#fbfaf7', bow: '#cdb69c', blush: '#f4b3aa' },
    // 雾蓝清爽
    { skin: '#ffe4cf', hair: '#2f2b29', top: '#a8bccb', bottom: '#3e4d5c', sock: '#f4f8fa', shoes: '#fbfaf7', bow: '#a8bccb', blush: '#f4b3aa' },
  ],
  // 访客：按名牌哈希取色，同一人每次来访穿同色
  guest: [
    { skin: '#ffe9dc', hair: '#5a3a2e', top: '#e8b8b0', bottom: '#6a5a4e', sock: '#f4f2ee', shoes: '#fbfaf7', bow: '#e8b8b0', blush: '#f4b3aa' },
    { skin: '#ffe4cf', hair: '#2e2e34', top: '#b8cec6', bottom: '#4a5568', sock: '#f6f5f2', shoes: '#fbfaf7', bow: '#b8cec6', blush: '#f4b3aa' },
    { skin: '#ffe9dc', hair: '#6a4a30', top: '#cfc0e0', bottom: '#5a5a66', sock: '#f4ede4', shoes: '#fbfaf7', bow: '#cfc0e0', blush: '#f6b1b8' },
    { skin: '#ffe4cf', hair: '#3a3230', top: '#e5c58e', bottom: '#4e5a52', sock: '#f6f5f2', shoes: '#fbfaf7', bow: '#e5c58e', blush: '#f4b3aa' },
  ],
};

/** Q版身材参数（约 2.2 头身，总高 ≈ 0.92m） */
const P = {
  hipY: 0.29,
  thighLen: 0.13,
  calfLen: 0.11,
  thighR: 0.055,
  calfR: 0.048,
  legX: 0.08,
  torsoY: 0.4,
  torsoR: 0.16,
  torsoLen: 0.11,
  shoulderY: 0.49,
  shoulderX: 0.175,
  upperLen: 0.075,
  upperR: 0.048,
  foreLen: 0.07,
  foreR: 0.04,
  headY: 0.64,
  headR: 0.26,
  eyeR: 0.05,
  eyeX: 0.098,
  eyeY: -0.03,
  shoeS: 0.058,
};

/**
 * 水滴发束几何（全角色共享，极省内存）：
 * 单位造型 —— 发根 y≈0、发梢 y=-1、最大半径 1（在 45% 高度处），
 * 用 mesh.scale(r, len, r*扁平度) 摆成任意粗细长短的发束。
 * 用 LatheGeometry 车出圆润发根 + 尖细发梢（比球体像「一撮头发」而不是「一颗球」）。
 */
const HAIR_LOCK_GEO = new THREE.LatheGeometry(
  (
    [
      [0.0, -1.0], // 梢尖
      [0.22, -0.975],
      [0.55, -0.9],
      [0.86, -0.72],
      [1.0, -0.45], // 最宽处
      [0.88, -0.22],
      [0.62, -0.06],
      [0.3, 0.0],
      [0.0, 0.02], // 发根圆心
    ] as [number, number][]
  ).map(([r, y]) => new THREE.Vector2(r, y)),
  10,
);

interface CharRig {
  root: THREE.Group;
  lieWrap: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  head: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  hairDyn: THREE.Group;
  skirt: THREE.Group | null;
  hipY: number;
  /** 泡澡时隐藏的衣物网格 */
  clothes: THREE.Mesh[];
  /** 泡澡素体（肤色躯干，平时隐藏） */
  skinTorso: THREE.Mesh;
  /** 泡澡/淋浴泡泡（脱衣遮挡，平时隐藏） */
  foam: THREE.Group;
  /** 睡觉 Zzz */
  zzz: THREE.Group;
  zzzSprites: THREE.Sprite[];
  /** 化妆星星 */
  spark: THREE.Group;
  sparkSprites: THREE.Sprite[];
  /** 手持小水杯 */
  cup: THREE.Group;
  cupCoffee: THREE.Mesh;
  cupJuice: THREE.Mesh;
  cupStraw: THREE.Mesh;
  cupSteam: THREE.Sprite;
  /** 看书的书 */
  book: THREE.Group;
  bookFlip: THREE.Group;
}

const stdMat = (c: string, rough = 0.8, extra?: Partial<THREE.MeshStandardMaterialParameters>) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, ...extra });

/** 腮红径向渐变贴图（边缘柔化，比生硬圆片自然） */
function makeBlushTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(247,160,172,0.92)');
  g.addColorStop(0.55, 'rgba(247,160,172,0.55)');
  g.addColorStop(1, 'rgba(247,160,172,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 化妆星星贴图（四角星光） */
function makeSparkTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  const cx = 48;
  const cy = 48;
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 42);
  g.addColorStop(0, 'rgba(255,236,246,0.98)');
  g.addColorStop(0.4, 'rgba(247,183,208,0.9)');
  g.addColorStop(1, 'rgba(247,183,208,0)');
  const star = (long: number, wide: number, rot: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -long);
    ctx.quadraticCurveTo(wide, -wide, long, 0);
    ctx.quadraticCurveTo(wide, wide, 0, long);
    ctx.quadraticCurveTo(-wide, wide, -long, 0);
    ctx.quadraticCurveTo(-wide, -wide, 0, -long);
    ctx.fill();
    ctx.restore();
  };
  ctx.fillStyle = g;
  star(40, 7, 0);
  star(24, 5, Math.PI / 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Zzz 字贴图 */
function makeZzzTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d')!;
  ctx.font = '900 92px "PingFang SC", "Nunito", ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 16;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(179,168,204,0.95)';
  ctx.strokeText('Z', 64, 70);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Z', 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 组装 Q版小人（纯几何，无外部依赖）。
 * 结构：root(起伏/前倾) → lieWrap(躺姿旋转) → [腿×2(髋→膝), 裙摆(女), 躯干, 臂×2(肩→肘), 头+脸+发]
 */
function buildChar(who: 'me' | 'partner' | 'guest', outfit = 0, wear?: GirlWear, wear2?: BoyWear): CharRig {
  const pal = OUTFITS[who];
  const o = pal[outfit % pal.length];
  const g = new THREE.Group();
  const clothes: THREE.Mesh[] = [];
  const isGirl = who === 'me';
  // —— 女主衣柜穿搭解析（v6.2：缺省 = 双马尾 + 樱粉连衣裙 + 棕色小皮鞋） ——
  const W: GirlWear = wear ?? { hair: 'twin', dress: 0, top: 0, bottom: 0, shoes: 0 };
  // —— 男生衣柜穿搭解析（v6.3：缺省 = 顺滑短发 + 奶白连帽卫衣 + 藏蓝短裤 + 白圆头鞋） ——
  const BW: BoyWear = wear2 ?? { hair: 'smooth', top: 0, bottom: 0, shoes: 0 };
  // —— 调色盘自选色（非法/缺省 → 款式默认色） ——
  const tintHex = (base: string, t?: string | null) => (t && /^#[0-9a-fA-F]{6}$/.test(t) ? t : base);
  const GT = W.tints;
  const BT = BW.tints;
  const dressRec = W.dress >= 0 ? DRESSES[Math.min(Math.max(W.dress, 0), DRESSES.length - 1)] : null;
  const topRec = TOPS[Math.min(Math.max(W.top, 0), TOPS.length - 1)];
  const botRec = BOTTOMS[Math.min(Math.max(W.bottom, 0), BOTTOMS.length - 1)];
  const shoeRec = SHOES[Math.min(Math.max(W.shoes, 0), SHOES.length - 1)];
  // 下装形态：连衣裙/裙 → 露腿+过膝袜；短裤 → 大腿裤色；长裤 → 全腿裤色
  const legWear: 'skirt' | 'short' | 'long' = dressRec ? 'skirt' : botRec.kind;
  const topCol = tintHex(dressRec ? dressRec.c : topRec.c, dressRec ? GT?.dress : GT?.top);
  const bowCol = dressRec ? dressRec.bow : topRec.bow;
  // 男生衣柜目录（v6.3）
  const bTop = BOY_TOPS[Math.min(Math.max(BW.top, 0), BOY_TOPS.length - 1)];
  const bBot = BOY_BOTTOMS[Math.min(Math.max(BW.bottom, 0), BOY_BOTTOMS.length - 1)];
  const bShoe = BOY_SHOES[Math.min(Math.max(BW.shoes, 0), BOY_SHOES.length - 1)];

  const mesh = (
    geo: THREE.BufferGeometry,
    m: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
    parent: THREE.Object3D = g,
  ) => {
    const mm = new THREE.Mesh(geo, m);
    mm.position.set(x, y, z);
    mm.castShadow = true;
    parent.add(mm);
    return mm;
  };

  // ---------- 躺姿包裹层 ----------
  const lieWrap = new THREE.Group();
  g.add(lieWrap);

  const skinMat = stdMat(o.skin, 0.62);
  const hairCol = tintHex(o.hair, GT?.hair);
  // v7.2 粗糙度 0.85：太低（0.58~0.7）时低多边形发壳的每片平面各自反光，
  // 灯下会闪出一片碎白点（用户截图反馈）；提高粗糙度后高光变成柔和整体亮部，不再有点点
  const hairMat = stdMat(hairCol, 0.85);
  const topMat = stdMat(isGirl ? topCol : tintHex(bTop.c, BT?.top), 0.82);
  const botMat = stdMat(isGirl ? tintHex(botRec.c, GT?.bottom) : tintHex(bBot.c, BT?.bottom), 0.8); // 分体下装/男裤（自选色）
  const girlSockMat = stdMat('#ffffff', 0.72); // 女主白过膝袜

  // ---------- 腿（髋 pivot → 大腿 → 膝 pivot → 小腿 + 袜 + 圆头鞋） ----------
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  const kneeL = new THREE.Group();
  const kneeR = new THREE.Group();
  for (const [pivot, knee, sx] of [
    [legL, kneeL, -1],
    [legR, kneeR, 1],
  ] as const) {
    pivot.position.set(P.legX * sx, P.hipY, 0);
    lieWrap.add(pivot);
    // 大腿：女主裙/连衣裙露肤、分体裤装上裤色 / 男主裤色（短裤长裤同色，长裤时小腿同色）
    const thigh = mesh(
      new THREE.CapsuleGeometry(P.thighR, P.thighLen - P.thighR * 1.1, 6, 12),
      isGirl ? (legWear === 'skirt' ? skinMat : botMat) : botMat,
      0,
      -P.thighLen / 2,
      0,
      pivot,
    );
    if (isGirl ? legWear !== 'skirt' : true) clothes.push(thigh);
    knee.position.set(0, -P.thighLen, 0);
    pivot.add(knee);
    // 小腿：女主过膝袜（长裤时上裤色）/ 男主肤色（长裤时上裤色）
    const calf = mesh(
      new THREE.CapsuleGeometry(P.calfR, P.calfLen - P.calfR * 1.1, 6, 12),
      isGirl ? (legWear === 'long' ? botMat : girlSockMat) : bBot.kind === 'long' ? botMat : skinMat,
      0,
      -P.calfLen / 2,
      0,
      knee,
    );
    if (isGirl ? legWear === 'long' : bBot.kind === 'long') clothes.push(calf);
    // 男主短袜（脚踝上一小截白；长裤时藏进裤管不渲染）
    if (!isGirl && bBot.kind === 'short') {
      const sock = mesh(
        new THREE.CylinderGeometry(P.calfR * 1.06, P.calfR * 1.1, 0.045, 10),
        stdMat(o.sock, 0.72),
        0,
        -P.calfLen + 0.028,
        0,
        knee,
      );
      clothes.push(sock);
    }
    // 圆头小鞋（椭球，前伸）+ 鞋款配件
    const shoe = mesh(
      new THREE.SphereGeometry(P.calfR * 1.12, 14, 12),
      stdMat(isGirl ? tintHex(shoeRec.c, GT?.shoes) : tintHex(bShoe.c, BT?.shoes), 0.6),
      0,
      -P.calfLen - 0.006,
      0.022,
      knee,
    );
    shoe.scale.set(0.82, 0.62, 1.35);
    clothes.push(shoe);
    // 男生鞋底描边（薄一圈鞋底色，subtle）
    if (!isGirl) {
      const sole = mesh(new THREE.TorusGeometry(P.calfR * 1.0, 0.007, 6, 16), stdMat(tintHex(bShoe.trim, BT?.shoes), 0.7), 0, -P.calfLen - 0.034, 0.024, knee);
      sole.rotation.x = Math.PI / 2;
      sole.scale.set(0.9, 1.35, 1);
      clothes.push(sole);
    }
    // 女主鞋款：帆布鞋包边 / 玛丽珍袢带 / 短靴靴筒
    if (isGirl && W.shoes === 1) {
      const band = mesh(new THREE.TorusGeometry(P.calfR * 1.0, 0.0065, 6, 14), stdMat(shoeRec.trim, 0.72), 0, -P.calfLen + 0.036, 0, knee);
      band.rotation.x = Math.PI / 2;
      clothes.push(band);
    } else if (isGirl && W.shoes === 2) {
      const strap = mesh(new THREE.TorusGeometry(P.calfR * 0.98, 0.0075, 6, 14, Math.PI), stdMat(shoeRec.trim, 0.6), 0, -P.calfLen + 0.056, 0.026, knee);
      strap.rotation.y = Math.PI / 2;
      clothes.push(strap);
    } else if (isGirl && W.shoes === 3) {
      const boot = mesh(new THREE.CylinderGeometry(P.calfR * 1.1, P.calfR * 1.16, 0.058, 12), stdMat(tintHex(shoeRec.c, GT?.shoes), 0.62), 0, -P.calfLen + 0.046, 0, knee);
      clothes.push(boot);
      const bootTrim = mesh(new THREE.CylinderGeometry(P.calfR * 1.18, P.calfR * 1.18, 0.012, 12), stdMat(shoeRec.trim, 0.7), 0, -P.calfLen + 0.081, 0, knee);
      clothes.push(bootTrim);
    }
  }

  // ---------- 裙摆（女主）：连衣裙/半身裙 —— 圆锥裙，走路时后飘 ----------
  let skirt: THREE.Group | null = null;
  if (isGirl && legWear === 'skirt') {
    skirt = new THREE.Group();
    skirt.position.set(0, 0.36, 0);
    lieWrap.add(skirt);
    const skirtCol = dressRec ? dressRec.c : botRec.c;
    const cone = mesh(new THREE.ConeGeometry(0.205, 0.17, 20, 1, true), stdMat(skirtCol, 0.8), 0, -0.085, 0, skirt);
    // 内侧也渲染（从下往上看不穿帮）
    (cone.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    clothes.push(cone);
    // 裙摆白边（连衣裙用裙色配套装饰边）
    const hem = mesh(new THREE.TorusGeometry(0.196, 0.009, 8, 24), stdMat(dressRec ? dressRec.trim : '#ffffff', 0.7), 0, -0.158, 0, skirt);
    hem.rotation.x = Math.PI / 2;
    clothes.push(hem);
    // 连衣裙腰线装饰（分体裙不加）
    if (dressRec) {
      const belt = mesh(new THREE.TorusGeometry(0.172, 0.0075, 8, 22), stdMat(dressRec.trim, 0.7), 0, -0.115, 0, skirt);
      belt.rotation.x = Math.PI / 2;
      clothes.push(belt);
    }
  }

  // ---------- 躯干（上衣）----------
  const torso = mesh(new THREE.CapsuleGeometry(P.torsoR, P.torsoLen, 8, 18), topMat, 0, P.torsoY, 0, lieWrap);
  clothes.push(torso);
  // 男主兜帽（脑后半环；仅连帽款）
  if (!isGirl && bTop.hood) {
    const hood = mesh(new THREE.TorusGeometry(0.098, 0.038, 10, 18, Math.PI * 1.1), topMat, 0, P.torsoY + P.torsoLen / 2 + P.torsoR * 0.42, -P.torsoR * 0.55, lieWrap);
    hood.rotation.x = Math.PI * 0.62;
    hood.rotation.z = Math.PI * 0.45;
    clothes.push(hood);
  } else {
    // 女主胸前小白心
    const heart = new THREE.Group();
    heart.position.set(0, P.torsoY + 0.075, P.torsoR + 0.008);
    const hm = stdMat('#fff5f6', 0.6);
    for (const sx of [-1, 1]) {
      const lob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), hm);
      lob.position.set(0.012 * sx, 0.008, 0);
      lob.castShadow = false;
      heart.add(lob);
    }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.036, 10), hm);
    tip.rotation.z = Math.PI;
    tip.position.y = -0.012;
    tip.castShadow = false;
    heart.add(tip);
    lieWrap.add(heart);
  }
  // 泡澡素体（肤色躯干，平时隐藏）
  const skinTorso = mesh(new THREE.CapsuleGeometry(P.torsoR * 0.94, P.torsoLen, 8, 16), skinMat, 0, P.torsoY, 0, lieWrap);
  skinTorso.visible = false;

  // ---------- 泡澡/淋浴泡泡（脱衣遮挡，平时隐藏） ----------
  const foam = new THREE.Group();
  foam.visible = false;
  lieWrap.add(foam);
  const foamMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.22, transparent: true, opacity: 0.94 });
  const foamAdd = (x: number, y: number, z: number, r: number) => {
    const fm = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), foamMat);
    fm.position.set(x, y, z);
    fm.castShadow = false;
    foam.add(fm);
  };
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    foamAdd(Math.cos(a) * (P.torsoR + 0.03), P.torsoY - P.torsoLen * 0.2 + (i % 2) * 0.04, Math.sin(a) * (P.torsoR + 0.03), 0.05 + (i % 3) * 0.013);
  }
  foamAdd(-P.torsoR * 0.7, P.torsoY + P.torsoLen * 0.4, P.torsoR * 0.6, 0.045);
  foamAdd(P.torsoR * 0.7, P.torsoY + P.torsoLen * 0.4, P.torsoR * 0.6, 0.05);
  foamAdd(-P.headR * 0.42, P.headY + P.headR * 0.72, P.headR * 0.18, 0.05);
  foamAdd(P.headR * 0.46, P.headY + P.headR * 0.78, -P.headR * 0.12, 0.055);
  foamAdd(0, P.headY + P.headR * 0.9, P.headR * 0.28, 0.045);

  // ---------- 睡觉 Zzz（躺床时头在 -z 床头侧，从头上方飘起） ----------
  const zzz = new THREE.Group();
  zzz.visible = false;
  g.add(zzz);
  const zzzTex = makeZzzTexture();
  const zzzSprites: THREE.Sprite[] = [];
  for (let i = 0; i < 3; i++) {
    const sm = new THREE.SpriteMaterial({ map: zzzTex, transparent: true, opacity: 0, depthWrite: false });
    const sp = new THREE.Sprite(sm);
    sp.scale.setScalar(0.1 + i * 0.04);
    sp.position.set(0.15 + i * 0.03, 0.36 + i * 0.14, -(P.headY + 0.08 + i * 0.1));
    zzz.add(sp);
    zzzSprites.push(sp);
  }

  // ---------- 化妆星星 ----------
  const spark = new THREE.Group();
  spark.visible = false;
  g.add(spark);
  const sparkTex = makeSparkTexture();
  const sparkSprites: THREE.Sprite[] = [];
  for (let i = 0; i < 5; i++) {
    const sm = new THREE.SpriteMaterial({ map: sparkTex, transparent: true, opacity: 0, depthWrite: false });
    const sp = new THREE.Sprite(sm);
    sp.scale.setScalar(0.09 + (i % 2) * 0.04);
    spark.add(sp);
    sparkSprites.push(sp);
  }

  // ---------- 手臂（肩 pivot → 上臂(袖) → 肘 pivot → 前臂(肤) + 圆手） ----------
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  const foreL = new THREE.Group();
  const foreR = new THREE.Group();
  for (const [pivot, fore, sx] of [
    [armL, foreL, -1],
    [armR, foreR, 1],
  ] as const) {
    pivot.position.set(P.shoulderX * sx, P.shoulderY, 0);
    pivot.rotation.z = sx * 0.16; // 微微外张
    lieWrap.add(pivot);
    // 泡泡袖（肩头小球，女主）
    if (isGirl) {
      const puff = mesh(new THREE.SphereGeometry(P.upperR * 1.15, 12, 10), topMat, 0, -P.upperR * 0.2, 0, pivot);
      clothes.push(puff);
    }
    const sleeve = mesh(
      new THREE.CapsuleGeometry(P.upperR * (isGirl ? 0.8 : 1), P.upperLen, 6, 10),
      topMat,
      0,
      -P.upperLen / 2 - P.upperR * 0.25,
      0,
      pivot,
    );
    clothes.push(sleeve);
    fore.position.set(0, -P.upperLen - P.upperR * 0.45, 0);
    pivot.add(fore);
    mesh(
      new THREE.CapsuleGeometry(P.foreR, P.foreLen, 6, 10),
      skinMat,
      0,
      -P.foreLen / 2 - P.foreR * 0.2,
      0,
      fore,
    );
    // 圆手（比前臂略大的小球，萌感）
    mesh(new THREE.SphereGeometry(P.foreR * 1.3, 12, 10), skinMat, 0, -P.foreLen - P.foreR * 0.7, 0, fore);
  }

  // ---------- 手持小水杯（挂右前臂手心，平时隐藏） ----------
  const cup = new THREE.Group();
  cup.visible = false;
  const cupGlass = new THREE.MeshStandardMaterial({
    color: '#cfeaf4',
    roughness: 0.2,
    metalness: 0.05,
    transparent: true,
    opacity: 0.62,
  });
  const cupBody = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.024, 0.072, 12), cupGlass);
  cupBody.castShadow = false;
  cup.add(cupBody);
  const cupJuice = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.021, 0.052, 12), stdMat('#f2b7c6', 0.35));
  cupJuice.position.y = -0.004;
  cupJuice.castShadow = false;
  cup.add(cupJuice);
  const cupStraw = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.085, 8), stdMat('#f4a7b9', 0.5));
  cupStraw.position.set(0.012, 0.052, 0);
  cupStraw.rotation.z = 0.18;
  cupStraw.castShadow = false;
  cup.add(cupStraw);
  const cupCoffee = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.021, 0.05, 12), stdMat('#7a4a28', 0.4));
  cupCoffee.position.y = -0.005;
  cupCoffee.visible = false;
  cup.add(cupCoffee);
  const cupHandle = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 6, 12), stdMat('#f7f5ef', 0.5));
  cupHandle.position.set(-0.032, 0.003, 0);
  cupHandle.castShadow = false;
  cupCoffee.add(cupHandle);
  const steamTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const c2 = cv.getContext('2d')!;
    const gr = c2.createRadialGradient(32, 32, 3, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,0.75)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    c2.fillStyle = gr;
    c2.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const cupSteam = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, opacity: 0, depthWrite: false }));
  cupSteam.scale.setScalar(0.05);
  cupSteam.position.set(0.004, 0.07, 0);
  cup.add(cupSteam);
  cup.position.set(0, -P.foreLen - P.foreR * 0.9, 0.03);
  foreR.add(cup);

  // ---------- 看书的书（封面+书页+翻页页角；仅 read 姿势可见） ----------
  const book = new THREE.Group();
  book.visible = false;
  const bookCoverMat = stdMat(isGirl ? '#e8a3b3' : '#7a9ec2', 0.55);
  const bookPaperMat = stdMat('#faf7f0', 0.85);
  const coverL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.14), bookCoverMat);
  coverL.position.set(-0.05, 0, 0);
  coverL.rotation.z = 0.12;
  coverL.castShadow = false;
  book.add(coverL);
  const coverR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.14), bookCoverMat);
  coverR.position.set(0.05, 0, 0);
  coverR.rotation.z = -0.12;
  coverR.castShadow = false;
  book.add(coverR);
  const pageL = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.016, 0.128), bookPaperMat);
  pageL.position.set(-0.045, 0.012, 0);
  pageL.rotation.z = 0.1;
  book.add(pageL);
  const pageR = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.016, 0.128), bookPaperMat);
  pageR.position.set(0.045, 0.012, 0);
  pageR.rotation.z = -0.1;
  book.add(pageR);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.02, 0.142), bookCoverMat);
  spine.position.set(0, 0.006, 0);
  book.add(spine);
  const bookFlip = new THREE.Group();
  bookFlip.position.set(0, 0.024, 0);
  const flipMesh = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.003, 0.126), bookPaperMat);
  flipMesh.position.x = 0.043;
  flipMesh.castShadow = false;
  bookFlip.add(flipMesh);
  book.add(bookFlip);
  book.position.set(0, 0.31, 0.23);
  book.rotation.x = -0.42;
  g.add(book);

  // ---------- 头 + 脸 + 发型 ----------
  const head = new THREE.Group();
  head.position.set(0, P.headY, 0);
  lieWrap.add(head);
  // 大圆头（微扁更萌）
  const skull = mesh(new THREE.SphereGeometry(P.headR, 28, 24), skinMat, 0, 0, 0, head);
  skull.scale.set(1, 0.96, 0.97);

  // —— 眼睛（竖椭圆大眼 + 双层高光 + 上眼线，可眨眼） ——
  const eyeLG = new THREE.Group();
  const eyeRG = new THREE.Group();
  const eyeWhiteMat = stdMat('#ffffff', 0.25);
  const pupilMat = stdMat('#453129', 0.3);
  for (const [eg, sx] of [
    [eyeLG, -1],
    [eyeRG, 1],
  ] as const) {
    eg.position.set(P.eyeX * sx, P.eyeY, P.headR * 0.78);
    head.add(eg);
    // 眼白
    const ew = new THREE.Mesh(new THREE.SphereGeometry(P.eyeR, 14, 12), eyeWhiteMat);
    ew.scale.set(0.95, 1.28, 0.42);
    ew.castShadow = false;
    eg.add(ew);
    // 瞳仁（深棕，偏内下）
    const pu = new THREE.Mesh(new THREE.SphereGeometry(P.eyeR * 0.74, 12, 10), pupilMat);
    pu.scale.set(0.9, 1.18, 0.4);
    pu.position.set(-0.006 * sx, -0.006, 0.016);
    pu.castShadow = false;
    eg.add(pu);
    // 大高光（上内侧）
    const hi1 = new THREE.Mesh(new THREE.SphereGeometry(P.eyeR * 0.3, 8, 8), stdMat('#ffffff', 0.15));
    hi1.position.set(0.016 * sx, 0.02, 0.036);
    hi1.castShadow = false;
    eg.add(hi1);
    // 小高光（下外侧）
    const hi2 = new THREE.Mesh(new THREE.SphereGeometry(P.eyeR * 0.16, 8, 8), stdMat('#ffffff', 0.15));
    hi2.position.set(-0.019 * sx, -0.018, 0.032);
    hi2.castShadow = false;
    eg.add(hi2);
    // 上眼线（细弧，发色）
    const lash = new THREE.Mesh(new THREE.TorusGeometry(P.eyeR * 1.02, 0.0075, 6, 16, Math.PI * 0.72), stdMat(hairCol, 0.5));
    lash.rotation.z = Math.PI * 0.14;
    lash.position.z = 0.008;
    lash.castShadow = false;
    eg.add(lash);
  }

  // —— 眉毛（细弯弧，发色） ——
  for (const sx of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.0058, 6, 14, Math.PI * 0.62), stdMat(hairCol, 0.55));
    brow.position.set(P.eyeX * sx, P.eyeY + 0.085, P.headR * 0.84);
    brow.rotation.z = Math.PI * (sx > 0 ? 0.19 : 0.19);
    // 弧口朝下（拱眉）
    brow.rotation.x = Math.PI;
    brow.rotation.z = Math.PI * 0.81;
    brow.castShadow = false;
    head.add(brow);
  }

  // —— 腮红（径向渐变贴图，柔边） ——
  const blushTex = makeBlushTexture();
  for (const sx of [-1, 1]) {
    const blush = new THREE.Mesh(
      new THREE.CircleGeometry(0.052, 14),
      new THREE.MeshBasicMaterial({ map: blushTex, transparent: true, depthWrite: false }),
    );
    blush.position.set((P.eyeX + 0.075) * sx, -0.095, P.headR * 0.72);
    blush.rotation.y = sx * 0.5;
    head.add(blush);
  }

  // —— 小鼻子 ——
  const nose = mesh(new THREE.SphereGeometry(0.0085, 8, 8), stdMat('#f6c8b2', 0.6), 0, -0.062, P.headR * 0.97, head);
  nose.castShadow = false;

  // —— 嘴（微笑弧线） ——
  const smile = mesh(
    new THREE.TorusGeometry(0.032, 0.0072, 6, 16, Math.PI * 0.8),
    stdMat(isGirl ? '#e08e8e' : '#c98a80', 0.6),
    0,
    -0.108,
    P.headR * 0.9,
    head,
  );
  smile.rotation.x = Math.PI * 0.06;
  smile.rotation.z = Math.PI + Math.PI * 0.1;

  // —— 发型 ——
  const hairDyn = new THREE.Group(); // 动态发（马尾/呆毛）挂这里做摆动
  head.add(hairDyn);

  /** 蝴蝶结（双层翼 + 中心结 + 飘带）：(kx,ky,kz) 结中心，sx = ±1 翼展开向，scale 尺寸系数 */
  const buildBowAt = (parent: THREE.Object3D, kx: number, ky: number, kz: number, sx: number, scale: number, col: string) => {
    const bm = stdMat(col, 0.55);
    const wingA = mesh(new THREE.SphereGeometry(P.headR * 0.145 * scale, 12, 10), bm, kx + sx * P.headR * 0.11, ky + P.headR * 0.02, kz - P.headR * 0.06, parent);
    wingA.scale.set(1.25, 0.85, 0.6);
    wingA.rotation.z = 0.5 * sx;
    wingA.castShadow = false;
    const wingB = mesh(new THREE.SphereGeometry(P.headR * 0.13 * scale, 12, 10), bm, kx - sx * P.headR * 0.11, ky + P.headR * 0.04, kz - P.headR * 0.04, parent);
    wingB.scale.set(1.2, 0.8, 0.6);
    wingB.rotation.z = 0.5 * sx;
    wingB.castShadow = false;
    const knot = mesh(new THREE.SphereGeometry(P.headR * 0.06 * scale, 10, 8), bm, kx, ky, kz, parent);
    knot.castShadow = false;
    const rib = mesh(new THREE.ConeGeometry(P.headR * 0.035 * scale, P.headR * 0.24 * scale, 8), bm, kx + sx * P.headR * 0.02, ky - P.headR * 0.16 * scale, kz + P.headR * 0.02, parent);
    rib.rotation.x = Math.PI;
    rib.rotation.z = 0.25 * sx;
    rib.castShadow = false;
  };

  if (isGirl) {
    // 女主发丝微光泽（0.78：保留一点柔光但不产生低多边形高光白点）
    hairMat.roughness = 0.78;
    hairMat.side = THREE.DoubleSide; // 薄壳发片边缘从缝里看也不穿帮

    // —— v6.7「一体发壳」：球面薄片边贴边精确平铺（同一半径、共享边缘、零重叠 → 无 Z 抖动），
    //   拼成一整片顺滑头发 + 脑后宽发幕/马尾造型。薄片一律不投影（避免薄片自阴影/在额头投出脏斑）。
    const HR = P.headR;
    const d2r = (d: number) => (d * Math.PI) / 180;
    /** 球面发片：phi 起止（°，90°=正前）/ theta 起止（°，0°=头顶），同一半径 → 各片共享边缘成一整壳 */
    const shellPatch = (phi0: number, phi1: number, th0: number, th1: number, mat: THREE.Material) => {
      // v7.2 细分 30×18（原 22×12）：法线过渡更细腻，配合高粗糙度彻底消除灯下白点
      const p = mesh(
        new THREE.SphereGeometry(HR * 1.06, 30, 18, d2r(phi0), d2r(phi1 - phi0), d2r(th0), d2r(th1 - th0)),
        mat,
        0,
        0,
        0,
        head,
      );
      p.castShadow = false;
      return p;
    };

    // —— 平铺：theta 0→57 头顶穹顶（两个半片拼整圆，避免全周接缝自重叠），phi 0→360 依次为
    //   后脑补缝｜左耳后｜左齐刘海｜右齐刘海｜右耳后｜后脑 ——
    shellPatch(0, 180, 0, 57, hairMat); // 头顶穹顶（前缘 57° 接刘海）
    shellPatch(180, 360, 0, 57, hairMat); // 头顶穹顶后半
    shellPatch(0, 4, 57, 100, hairMat); // 后脑补缝（跨 360° 补左耳后与后脑接缝）
    shellPatch(176, 360, 57, 100, hairMat); // 后脑大片区（含后颈上方）
    shellPatch(158, 176, 57, 98, hairMat); // 右耳后侧发（贴头型垂到下颌，绝不前伸挡脸）
    shellPatch(4, 22, 57, 98, hairMat); // 左耳后侧发
    // v7.1 齐刘海：额头整片覆盖（无中分缝），三片下缘同高 → 一条直线齐到眼上再垂长一截（θ85°，仍不遮眼），两侧包住额角同样齐平
    const BANGS: [number, number, number, number][] = [
      [22, 62, 57, 85], // 左齐刘海：与中央同长（θ85° ≈ 眼上缘再往下垂长一点）
      [62, 118, 57, 85], // 中央齐刘海：直线切在眼上偏下
      [118, 158, 57, 85], // 右齐刘海：与中央同长
    ];
    for (const [a0, a1, t0, t1] of BANGS) shellPatch(a0, a1, t0, t1, hairMat);

    // —— 发型分支（发壳之上追加「后半部分造型」；马尾全部垂在脑后） ——
    if (W.hair === 'high') {
      // 高马尾：脑后高扎一束水滴锥形马尾 + 扎点蝴蝶结
      const tail = new THREE.Group();
      tail.position.set(0, HR * 0.92, -HR * 0.52);
      tail.rotation.x = 0.5; // 向后弧线垂落
      hairDyn.add(tail);
      const tie = mesh(new THREE.TorusGeometry(HR * 0.11, HR * 0.032, 8, 14), stdMat(bowCol, 0.55), 0, 0, 0, tail);
      tie.rotation.x = Math.PI / 2.2;
      tie.castShadow = false;
      const strand = mesh(HAIR_LOCK_GEO, hairMat, 0, 0, 0, tail);
      strand.scale.set(HR * 0.4, HR * 2.0, HR * 0.34);
      buildBowAt(tail, 0, HR * 0.02, HR * 0.03, -1, 0.9, bowCol);
    } else if (W.hair === 'bob') {
      // 短发波波头：发壳下缘续一圈齐下颌的圆弧下摆（同半径续接，圆滑内扣不遮脸）；
      // v6.7 发梢小球删除 —— 下摆本身即为干净齐边；v7.1 侧片上缘随加长后的齐刘海缘（θ85°）衔接
      shellPatch(130, 158, 85, 114, hairMat); // 右颊侧（刘海缘到腮）
      shellPatch(22, 50, 85, 114, hairMat); // 左颊侧
      shellPatch(158, 176, 98, 116, hairMat); // 右下摆
      shellPatch(4, 22, 98, 116, hairMat); // 左下摆
      shellPatch(176, 364, 100, 116, hairMat); // 后脑下摆（跨 360° 补齐左接缝）
    } else if (W.hair === 'straight') {
      // 长直发（v6.7 重做）：脑后宽发幕（车床曲面，宽度覆盖整个后脑 → 背后看不再露头皮）
      // 平滑垂到腰际，与发壳下缘无缝衔接；发梢小球删除，发缘平齐收笔
      const fall = new THREE.LatheGeometry(
        (
          [
            [0.55, 0.3], // 顶部收口（藏进头内）
            [0.98, -0.05],
            [1.06, -0.28], // 与发壳下缘（θ≈100°, r≈1.04）衔接并略超出
            [1.07, -0.5],
            [1.02, -0.95],
            [0.95, -1.4],
            [0.88, -1.78],
            [0.8, -2.06],
            [0.66, -2.16], // 底缘
          ] as [number, number][]
        ).map(([r, y]) => new THREE.Vector2(r * HR, y * HR)),
        34,
      );
      const backHair = mesh(fall, hairMat, 0, 0, -HR * 0.4, head);
      backHair.scale.set(1, 1, 0.6);
      backHair.castShadow = false;
    } else if (W.hair === 'wave') {
      // 大波浪（v6.7 重做）：脑后蓬松宽发幕 + 顶点沿高度做正弦起伏 → 发缘呈波浪卷曲轮廓；
      // 发梢小球删除，背后全覆盖不露头皮
      const wavy = new THREE.LatheGeometry(
        (
          [
            [0.55, 0.3],
            [1.0, -0.05],
            [1.09, -0.3],
            [1.11, -0.55],
            [1.06, -1.0],
            [0.99, -1.45],
            [0.93, -1.85],
            [0.86, -2.1],
            [0.7, -2.2],
          ] as [number, number][]
        ).map(([r, y]) => new THREE.Vector2(r * HR, y * HR)),
        34,
      );
      { // 半径按 y 正弦调制：下摆呈大波浪卷边（两段频率叠加更蓬松自然）
        const pos = wavy.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          const k = 1 + Math.sin(y * 21 / HR) * 0.032 + Math.sin(y * 8.5 / HR + 1.7) * 0.022;
          pos.setX(i, pos.getX(i) * k);
          pos.setZ(i, pos.getZ(i) * k);
        }
        pos.needsUpdate = true;
      }
      const backHair = mesh(wavy, hairMat, 0, 0, -HR * 0.4, head);
      backHair.scale.set(1, 1, 0.64);
      backHair.castShadow = false;
    } else {
      // 双马尾（默认）：脑后两侧两束水滴马尾（垂在背后，不挡脸不挡胸）+ 扎点小蝴蝶结 + 小呆毛
      for (const sx of [-1, 1]) {
        const tail = new THREE.Group();
        tail.position.set(HR * 0.68 * sx, HR * 0.12, -HR * 0.7);
        tail.rotation.z = sx * 0.3;
        tail.rotation.x = 0.35; // 向后弧线垂落
        hairDyn.add(tail);
        buildBowAt(tail, 0, HR * 0.02, HR * 0.02, sx, 0.7, bowCol);
        const strand = mesh(HAIR_LOCK_GEO, hairMat, 0, 0, 0, tail);
        strand.scale.set(HR * 0.3, HR * 1.5, HR * 0.26);
      }
      const curl = mesh(new THREE.TorusGeometry(HR * 0.075, HR * 0.02, 8, 16, Math.PI * 1.5), hairMat, HR * 0.03, HR * 1.06, -HR * 0.02, hairDyn);
      curl.rotation.set(0.5, 0.3, 0.6);
      curl.castShadow = false;
    }
  } else {
    // —— 男主发型（衣柜 v6.3：顺滑 / 蓬松卷 / 中分 / 刺猬；全部进 head，呆毛挂 hairDyn） ——
    if (BW.hair === 'fluffy') {
      // 蓬松卷发：加大头盖 + 抱团圆润发团（压扁更软）+ 小卷弧 + 微呆毛
      const cap = mesh(new THREE.SphereGeometry(P.headR * 1.12, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat, 0, P.headR * 0.07, -P.headR * 0.04, head);
      cap.rotation.x = -0.16;
      const puffs: [number, number, number, number][] = [
        [-0.52, 0.92, 0.42, 0.19],
        [0.52, 0.92, 0.42, 0.19],
        [-0.98, 0.5, 0.05, 0.18],
        [0.98, 0.5, 0.05, 0.18],
        [0, 1.12, 0, 0.2],
        [0, 0.62, 0.78, 0.16],
      ];
      for (const [px, py, pz, pr] of puffs) {
        const p = mesh(new THREE.SphereGeometry(P.headR * pr, 12, 10), hairMat, px * P.headR, py * P.headR, pz * P.headR, head);
        p.scale.set(1, 0.8, 0.9);
      }
      // 小卷弧（顶上 2 圈 + 侧后 1 圈）
      for (const [cx, cy, cz, cr] of [
        [-0.42, 1.2, 0.28, 0.11],
        [0.46, 1.12, 0.34, 0.1],
        [-0.88, 0.88, -0.22, 0.09],
      ] as const) {
        const curl = mesh(new THREE.TorusGeometry(P.headR * cr, P.headR * 0.024, 8, 14, Math.PI * 1.25), hairMat, cx * P.headR, cy * P.headR, cz * P.headR, head);
        curl.rotation.set(0.6, 0.4, -0.5);
        curl.castShadow = false;
      }
      for (const sx of [-1, 1]) {
        const sb = mesh(new THREE.SphereGeometry(P.headR * 0.14, 10, 8), hairMat, P.headR * 0.94 * sx, -P.headR * 0.1, -P.headR * 0.04, head);
        sb.scale.set(0.5, 1.3, 0.7);
        sb.rotation.z = sx * 0.1;
      }
      const back = mesh(new THREE.SphereGeometry(P.headR * 0.99, 18, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.44), hairMat, 0, 0, -P.headR * 0.04, head);
      back.rotation.x = -0.08;
      const ahoge = new THREE.Group();
      ahoge.position.set(0.05, P.headR * 1.18, 0.02);
      hairDyn.add(ahoge);
      const aCone = mesh(new THREE.ConeGeometry(0.016, 0.08, 8), hairMat, 0.012, 0.04, 0.008, ahoge);
      aCone.rotation.z = -0.5;
      aCone.rotation.x = 0.15;
    } else if (BW.hair === 'middle') {
      // 中分刘海：圆盖 + 两侧各 2 撮粗短中分刘海（干净中缝）+ 鬓角 + 后脑补发（无呆毛）
      const cap = mesh(new THREE.SphereGeometry(P.headR * 1.08, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.56), hairMat, 0, P.headR * 0.07, -P.headR * 0.04, head);
      cap.rotation.x = -0.16;
      const curtain: [number, number, number, number][] = [
        [0.15, 0.14, 0.205, 0.046],
        [0.235, 0.055, 0.16, 0.047],
      ];
      for (const sx of [-1, 1]) {
        for (const [fx, fy, fz, fr] of curtain) {
          const b = mesh(new THREE.SphereGeometry(fr, 12, 12), hairMat, fx * sx, fy, fz, head);
          b.scale.set(0.85, 1.5, 0.6);
          b.rotation.z = sx * 0.8;
          b.rotation.x = 0.12;
        }
        const sb = mesh(new THREE.SphereGeometry(P.headR * 0.15, 10, 8), hairMat, P.headR * 0.94 * sx, -P.headR * 0.12, -P.headR * 0.06, head);
        sb.scale.set(0.5, 1.6, 0.7);
        sb.rotation.z = sx * 0.1;
      }
      const back = mesh(new THREE.SphereGeometry(P.headR * 0.99, 18, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.44), hairMat, 0, 0, -P.headR * 0.04, head);
      back.rotation.x = -0.08;
    } else if (BW.hair === 'spiky') {
      // 活力刺猬：圆盖 + 前顶一圈外翘小尖刺 + 鬓角 + 后脑补发
      const cap = mesh(new THREE.SphereGeometry(P.headR * 1.08, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat, 0, P.headR * 0.07, -P.headR * 0.04, head);
      cap.rotation.x = -0.16;
      const spikes: [number, number, number][] = [
        [-0.68, 0.72, 0.52],
        [-0.34, 0.9, 0.62],
        [0, 1.0, 0.66],
        [0.34, 0.9, 0.62],
        [0.68, 0.72, 0.52],
        [0.88, 0.52, 0.05],
      ];
      for (const [px, py, pz] of spikes) {
        const sp = mesh(new THREE.ConeGeometry(0.024, 0.1, 7), hairMat, px * P.headR, py * P.headR, pz * P.headR, head);
        sp.rotation.z = -px * 0.85; // 尖端向外翘
        sp.rotation.x = -0.3; // 稍向前仰
      }
      for (const sx of [-1, 1]) {
        const sb = mesh(new THREE.SphereGeometry(P.headR * 0.14, 10, 8), hairMat, P.headR * 0.94 * sx, -P.headR * 0.12, -P.headR * 0.06, head);
        sb.scale.set(0.5, 1.5, 0.7);
        sb.rotation.z = sx * 0.1;
      }
      const back = mesh(new THREE.SphereGeometry(P.headR * 0.99, 18, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.44), hairMat, 0, 0, -P.headR * 0.04, head);
      back.rotation.x = -0.08;
    } else {
      // 顺滑短发（默认）：圆盖 + 前帘刘海 + 鬓角 + 后脑补发 + 小呆毛（v6.2 造型）
      const cap = mesh(new THREE.SphereGeometry(P.headR * 1.08, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat, 0, P.headR * 0.07, -P.headR * 0.04, head);
      cap.rotation.x = -0.16;
      // 前帘刘海（4 撮扁宽发束勾出刘海线）
      const fringe: [number, number, number][] = [
        [-0.42, 0.48, 0.68],
        [-0.14, 0.53, 0.74],
        [0.14, 0.53, 0.74],
        [0.42, 0.48, 0.68],
      ];
      for (const [fx, fy, fz] of fringe) {
        const f = mesh(new THREE.SphereGeometry(P.headR * 0.16, 10, 8), hairMat, fx * P.headR, fy * P.headR, fz * P.headR, head);
        f.scale.set(1.2, 0.62, 0.6);
      }
      // 鬓角（贴面扁发束，不再是小球）
      for (const sx of [-1, 1]) {
        const sb = mesh(new THREE.SphereGeometry(P.headR * 0.15, 10, 8), hairMat, P.headR * 0.94 * sx, -P.headR * 0.12, -P.headR * 0.06, head);
        sb.scale.set(0.5, 1.6, 0.7);
        sb.rotation.z = sx * 0.1;
      }
      // 后脑补发
      const back = mesh(new THREE.SphereGeometry(P.headR * 0.99, 18, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.44), hairMat, 0, 0, -P.headR * 0.04, head);
      back.rotation.x = -0.08;
      // 头顶呆毛（小锥；挂 hairDyn 做弹跳）
      const ahoge = new THREE.Group();
      ahoge.position.set(0.06, P.headR * 1.04, 0.02);
      hairDyn.add(ahoge);
      const aCone = mesh(new THREE.ConeGeometry(0.02, 0.11, 8), hairMat, 0.012, 0.055, 0.008, ahoge);
      aCone.rotation.z = -0.5;
      aCone.rotation.x = 0.15;
    }
  }

  return { root: g, lieWrap, armL, armR, foreL, foreR, legL, legR, kneeL, kneeR, head, eyeL: eyeLG, eyeR: eyeRG, hairDyn, skirt, hipY: P.hipY, clothes, skinTorso, foam, zzz, zzzSprites, spark, sparkSprites, cup, cupCoffee, cupJuice, cupStraw, cupSteam, book, bookFlip };
}

const dampN = THREE.MathUtils.damp;

export default function CharChibi3D({ rt, who, hide, poseRef, poseRef2, carryRef, guestName, wear, wear2, onTap, onLongPress }: CharChibi3DProps) {
  // v11 长按检测状态：pointerdown 起 550ms 计时；期间抬起 / 移出热区 / 移动超阈值取消；
  // 长按已触发则置 suppress，本轮 pointerup 不再触发 onTap
  const pressRef = useRef<{ timer: number | null; x: number; y: number; suppress: boolean }>({
    timer: null,
    x: 0,
    y: 0,
    suppress: false,
  });
  const clearPress = () => {
    if (pressRef.current.timer !== null) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current.timer = null;
    }
  };
  useEffect(() => clearPress, []);
  // 访客按名牌哈希固定取一套配色（同一人每次来访穿同色）
  const guestOutfit = useMemo(() => {
    if (who !== 'guest' || !guestName) return 0;
    let h = 0;
    for (let i = 0; i < guestName.length; i++) h = (h * 31 + guestName.charCodeAt(i)) >>> 0;
    return h % 4;
  }, [who, guestName]);
  // 配色板索引：guest 哈希取色 / partner 默认 / me 走 wear 衣柜（不走色板）
  const effOutfit = who === 'guest' ? guestOutfit : 0;
  const rig = useMemo(
    () => buildChar(who, effOutfit, who === 'me' ? wear : undefined, who === 'partner' ? wear2 : undefined),
    [who, effOutfit, wear, wear2],
  );
  const holder = useRef<THREE.Group>(null);
  /** 音符事件（弹琴/扫弦的手部脉冲同步） */
  const noteFx = useRef({ pianoSide: 1, pianoAt: 0, guitarAt: 0 });
  useEffect(() => {
    if (who !== 'me') return;
    return onNote((e) => {
      if (e.kind === 'piano') {
        noteFx.current.pianoSide *= -1;
        noteFx.current.pianoAt = performance.now();
      } else {
        noteFx.current.guitarAt = performance.now();
      }
    });
  }, [who]);
  /** 看书翻页计时 */
  const flipAt = useRef(0);
  /** 眨眼节律 */
  const blink = useRef({ next: 2 + Math.random() * 2, at: -10 });
  /** 待机歪头节律 */
  const tilt = useRef({ next: 5 + Math.random() * 3, v: 0 });

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const h = holder.current;
    if (!h || !rt) return;
    h.visible = !hide;
    h.position.set(rt.x, 0, rt.z);
    h.rotation.y = rt.heading;

    const t = state.clock.elapsedTime;
    const { root, lieWrap, armL, armR, foreL, foreR, legL, legR, kneeL, kneeR, head, eyeL, eyeR, hairDyn, skirt, clothes, skinTorso, foam, zzz, zzzSprites, spark, sparkSprites, hipY, cup, cupCoffee, cupJuice, cupStraw, cupSteam, book, bookFlip } = rig;
    const pose: CharPose = who === 'me' ? (poseRef?.current?.pose ?? 'stand') : who === 'partner' ? (poseRef2?.current?.pose ?? 'stand') : 'stand';
    const poseY = who === 'me' ? (poseRef?.current?.y ?? 0) : (poseRef2?.current?.y ?? 0);

    // —— 眨眼（随机 2.5~5.5s 一次，120ms 完成） ——
    const bl = blink.current;
    if (t >= bl.next) {
      bl.at = t;
      bl.next = t + 2.5 + Math.random() * 3;
    }
    const bph = t - bl.at;
    const blinkScale = bph < 0.055 ? 1 - (bph / 0.055) * 0.94 : bph < 0.13 ? 0.06 + ((bph - 0.055) / 0.075) * 0.94 : 1;
    eyeL.scale.y = blinkScale;
    eyeR.scale.y = blinkScale;

    // —— 手持水杯 / 怀抱小猫 ——
    const carry = who === 'me' && carryRef?.current?.cup === true;
    const carryCoffee = carry && carryRef?.current?.coffee === true;
    const petCarry = who === 'me' && carryRef?.current?.pet === true; // v7.2 抱着宠物：双臂环抱，与端杯互斥
    cup.visible = carry && pose !== 'lie' && pose !== 'bath' && pose !== 'shower';
    cupCoffee.visible = carryCoffee;
    cupJuice.visible = !carryCoffee;
    cupStraw.visible = !carryCoffee;
    if (carryCoffee) {
      const sp = cupSteam.material as THREE.SpriteMaterial;
      const ph = (t * 0.55) % 1;
      cupSteam.position.y = 0.06 + ph * 0.1;
      cupSteam.scale.setScalar(0.04 + ph * 0.05);
      sp.opacity = Math.sin(ph * Math.PI) * 0.6;
    } else {
      (cupSteam.material as THREE.SpriteMaterial).opacity = 0;
    }
    // —— 看书翻页 ——
    book.visible = pose === 'read';
    if (pose === 'read') {
      if (t - flipAt.current > 2.8) flipAt.current = t;
      const fp = Math.min(1, Math.max(0, (t - flipAt.current) / 0.55));
      bookFlip.rotation.z = fp < 1 ? -Math.PI * (1 - Math.cos(fp * Math.PI)) / 2 : 0;
    }
    // —— 化妆星星 ——
    spark.visible = pose === 'makeup';
    if (pose === 'makeup') {
      sparkSprites.forEach((sp, i) => {
        const a = t * 1.25 + (i / sparkSprites.length) * Math.PI * 2;
        sp.position.set(Math.cos(a) * 0.3, 0.78 + Math.sin(t * 2.1 + i * 1.4) * 0.055, Math.sin(a) * 0.3);
        (sp.material as THREE.SpriteMaterial).opacity = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.2 + i * 1.9));
      });
    }
    // —— 泡澡/淋浴脱衣 ——
    const undressed = pose === 'bath' || pose === 'shower';
    for (const m of clothes) m.visible = !undressed;
    skinTorso.visible = undressed;
    foam.visible = undressed;
    // —— 睡觉 Zzz ——
    zzz.visible = pose === 'lie';
    if (pose === 'lie') {
      zzzSprites.forEach((sp, i) => {
        const ph = (t * 0.42 + i * 0.34) % 1;
        sp.position.y = 0.36 + i * 0.14 + ph * 0.3;
        (sp.material as THREE.SpriteMaterial).opacity = Math.sin(ph * Math.PI) * 0.95;
      });
    }

    if (pose === 'stand') {
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      if (rt.moving) {
        // —— 走路：迈腿摆臂 + 大弹跳 + 头微晃 + 裙摆后飘 + 马尾/呆毛摇摆 ——
        const s = Math.sin(t * 10);
        legL.rotation.x = dampN(legL.rotation.x, s * 0.66, 22, dt);
        legR.rotation.x = dampN(legR.rotation.x, -s * 0.66, 22, dt);
        kneeL.rotation.x = dampN(kneeL.rotation.x, Math.max(0, -s) * 0.92, 22, dt);
        kneeR.rotation.x = dampN(kneeR.rotation.x, Math.max(0, s) * 0.92, 22, dt);
        armL.rotation.x = dampN(armL.rotation.x, -s * 0.6, 20, dt);
        armL.rotation.z = dampN(armL.rotation.z, -0.16, 14, dt);
        foreL.rotation.x = dampN(foreL.rotation.x, -0.38, 14, dt);
        armR.rotation.z = dampN(armR.rotation.z, 0.16, 14, dt);
        foreR.rotation.x = dampN(foreR.rotation.x, -0.38, 14, dt);
        if (petCarry) {
          // 怀抱小猫走路：双臂收拢环抱（随步子轻轻颠）
          const sb = Math.sin(t * 10);
          armL.rotation.x = dampN(armL.rotation.x, -0.62 + sb * 0.035, 12, dt);
          armL.rotation.z = dampN(armL.rotation.z, -0.4, 12, dt);
          foreL.rotation.x = dampN(foreL.rotation.x, -1.42, 12, dt);
          armR.rotation.x = dampN(armR.rotation.x, -0.62 - sb * 0.035, 12, dt);
          armR.rotation.z = dampN(armR.rotation.z, 0.4, 12, dt);
          foreR.rotation.x = dampN(foreR.rotation.x, -1.42, 12, dt);
        }
        root.position.y = Math.abs(Math.sin(t * 10)) * 0.042;
        root.rotation.x = dampN(root.rotation.x, 0.06, 12, dt);
        root.rotation.z = dampN(root.rotation.z, s * 0.04, 14, dt);
        head.rotation.x = dampN(head.rotation.x, 0.03, 12, dt);
        head.rotation.z = dampN(head.rotation.z, -s * 0.05, 12, dt);
        if (skirt) {
          skirt.rotation.x = dampN(skirt.rotation.x, -0.14, 10, dt);
          skirt.rotation.z = dampN(skirt.rotation.z, s * 0.05, 12, dt);
        }
        hairDyn.rotation.z = dampN(hairDyn.rotation.z, s * 0.07, 12, dt);
        hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0.05, 12, dt);
        if (!petCarry) {
          if (carry) {
            armR.rotation.x = dampN(armR.rotation.x, -0.68, 14, dt);
            armR.rotation.z = dampN(armR.rotation.z, 0.2, 12, dt);
            foreR.rotation.x = dampN(foreR.rotation.x, -1.04, 14, dt);
          } else {
            armR.rotation.x = dampN(armR.rotation.x, s * 0.6, 20, dt);
          }
        }
      } else {
        // —— 待机：呼吸 + 手臂微晃 + 随机歪头 + 头发轻摆 ——
        const tl = tilt.current;
        if (t >= tl.next) {
          tl.v = (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.07);
          tl.next = t + 4 + Math.random() * 4;
        }
        legL.rotation.x = dampN(legL.rotation.x, 0, 10, dt);
        legR.rotation.x = dampN(legR.rotation.x, 0, 10, dt);
        kneeL.rotation.x = dampN(kneeL.rotation.x, 0, 10, dt);
        kneeR.rotation.x = dampN(kneeR.rotation.x, 0, 10, dt);
        if (petCarry) {
          // 怀抱小猫站定：双臂稳稳环住 + 低头看看怀里的小家伙
          armL.rotation.x = dampN(armL.rotation.x, -0.62, 8, dt);
          armL.rotation.z = dampN(armL.rotation.z, -0.4, 10, dt);
          foreL.rotation.x = dampN(foreL.rotation.x, -1.42 + Math.sin(t * 2.2) * 0.03, 8, dt);
          armR.rotation.x = dampN(armR.rotation.x, -0.62, 8, dt);
          armR.rotation.z = dampN(armR.rotation.z, 0.4, 10, dt);
          foreR.rotation.x = dampN(foreR.rotation.x, -1.42 - Math.sin(t * 2.2) * 0.03, 8, dt);
          head.rotation.x = dampN(head.rotation.x, 0.09, 6, dt);
        } else {
          armL.rotation.x = dampN(armL.rotation.x, Math.sin(t * 1.7) * 0.05, 8, dt);
          armL.rotation.z = dampN(armL.rotation.z, -0.16, 10, dt);
          foreL.rotation.x = dampN(foreL.rotation.x, -0.14, 8, dt);
          armR.rotation.z = dampN(armR.rotation.z, 0.16, 10, dt);
          foreR.rotation.x = dampN(foreR.rotation.x, -0.14, 8, dt);
        }
        root.position.y = Math.sin(t * 2.2) * 0.009 + 0.004;
        root.rotation.x = dampN(root.rotation.x, 0, 10, dt);
        root.rotation.z = dampN(root.rotation.z, 0, 10, dt);
        head.rotation.x = dampN(head.rotation.x, petCarry ? 0.09 : 0, 8, dt); // 抱着小猫：低头看看怀里
        head.rotation.z = dampN(head.rotation.z, tl.v, 2.2, dt);
        if (skirt) {
          skirt.rotation.x = dampN(skirt.rotation.x, 0, 10, dt);
          skirt.rotation.z = dampN(skirt.rotation.z, 0, 10, dt);
        }
        hairDyn.rotation.z = dampN(hairDyn.rotation.z, Math.sin(t * 1.3) * 0.03, 8, dt);
        hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0, 8, dt);
        if (petCarry) {
          // 怀里抱着小猫：不喝杯里的东西（双臂被占用，目标姿态已在上方环抱分支给定）
        } else if (carry) {
          // 站着端杯：周期性举到嘴边咪一小口再放回来
          const ph = (t % 4.8) / 4.8;
          const sip = ph > 0.52 ? Math.sin(((ph - 0.52) / 0.48) * Math.PI) : 0;
          armR.rotation.x = dampN(armR.rotation.x, -0.28 - sip * 1.78, 9, dt);
          armR.rotation.z = dampN(armR.rotation.z, 0.2, 10, dt);
          foreR.rotation.x = dampN(foreR.rotation.x, -0.5 - sip * 0.72, 9, dt);
          head.rotation.x = dampN(head.rotation.x, -sip * 0.16, 7, dt);
        } else {
          armR.rotation.x = dampN(armR.rotation.x, -Math.sin(t * 1.7) * 0.05, 8, dt);
        }
      }
      return;
    }

    // —— 姿势（坐下 / 躺床 / 泡澡） ——
    if (pose === 'lie') {
      // 躺平：头朝家具 -z（床头/枕头侧），脸朝天
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, -Math.PI / 2, 8, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 8, dt);
      root.position.y = dampN(root.position.y, poseY + 0.07, 8, dt);
      root.rotation.x = dampN(root.rotation.x, 0, 8, dt);
      root.rotation.z = dampN(root.rotation.z, 0, 8, dt);
      legL.rotation.x = dampN(legL.rotation.x, 0.06, 8, dt);
      legR.rotation.x = dampN(legR.rotation.x, -0.04, 8, dt);
      kneeL.rotation.x = dampN(kneeL.rotation.x, 0.1, 8, dt);
      kneeR.rotation.x = dampN(kneeR.rotation.x, 0.1, 8, dt);
      armL.rotation.x = dampN(armL.rotation.x, 0.1, 8, dt);
      armR.rotation.x = dampN(armR.rotation.x, 0.1, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, 0.35, 8, dt);
      armR.rotation.z = dampN(armR.rotation.z, -0.35, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.15, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.15, 8, dt);
      head.rotation.x = dampN(head.rotation.x, 0, 8, dt);
      head.rotation.z = dampN(head.rotation.z, 0, 8, dt);
      root.position.y += Math.sin(t * 1.6) * 0.006;
      return;
    }

    if (pose === 'shower') {
      // —— 站姿淋浴：双臂抬搓头发 + 微微仰头 + 身体轻晃 ——
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      root.position.y = dampN(root.position.y, Math.max(0.02, poseY), 9, dt);
      root.rotation.x = dampN(root.rotation.x, 0, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 1.4) * 0.035, 8, dt);
      legL.rotation.x = dampN(legL.rotation.x, 0.03, 8, dt);
      legR.rotation.x = dampN(legR.rotation.x, -0.03, 8, dt);
      kneeL.rotation.x = dampN(kneeL.rotation.x, 0, 8, dt);
      kneeR.rotation.x = dampN(kneeR.rotation.x, 0, 8, dt);
      const washUp = -2.45 + Math.sin(t * 2.1) * 0.07;
      armL.rotation.x = dampN(armL.rotation.x, washUp, 7, dt);
      armR.rotation.x = dampN(armR.rotation.x, washUp + Math.sin(t * 2.3) * 0.06, 7, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.3, 7, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.3, 7, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.55, 7, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.62, 7, dt);
      head.rotation.x = dampN(head.rotation.x, -0.16, 6, dt);
      head.rotation.z = dampN(head.rotation.z, 0, 6, dt);
      foam.children.forEach((f, i) => {
        f.position.y += Math.sin(t * 2.2 + i * 1.3) * 0.00035;
      });
      return;
    }

    // —— v5.6 姿势（做饭 / 吃饭 / 喝东西 / 弹琴 / 弹吉他 / 化妆 / 照镜子 / 看书） ——
    const standBase = () => {
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      root.position.y = dampN(root.position.y, Math.sin(t * 2.2) * 0.009 + 0.004, 10, dt);
      root.rotation.x = dampN(root.rotation.x, 0, 10, dt);
      legL.rotation.x = dampN(legL.rotation.x, 0, 10, dt);
      legR.rotation.x = dampN(legR.rotation.x, 0, 10, dt);
      kneeL.rotation.x = dampN(kneeL.rotation.x, 0, 10, dt);
      kneeR.rotation.x = dampN(kneeR.rotation.x, 0, 10, dt);
      if (skirt) {
        skirt.rotation.x = dampN(skirt.rotation.x, 0, 10, dt);
        skirt.rotation.z = dampN(skirt.rotation.z, 0, 10, dt);
      }
      hairDyn.rotation.z = dampN(hairDyn.rotation.z, 0, 8, dt);
      hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0, 8, dt);
    };
    const sitBase = () => {
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      root.position.y = dampN(root.position.y, Math.max(0.02, poseY - hipY), 9, dt);
      root.rotation.x = dampN(root.rotation.x, 0.03, 8, dt);
      root.rotation.z = dampN(root.rotation.z, 0, 8, dt);
      legL.rotation.x = dampN(legL.rotation.x, -1.55, 10, dt);
      legR.rotation.x = dampN(legR.rotation.x, -1.55, 10, dt);
      kneeL.rotation.x = dampN(kneeL.rotation.x, 1.48, 10, dt);
      kneeR.rotation.x = dampN(kneeR.rotation.x, 1.48, 10, dt);
      if (skirt) {
        skirt.rotation.x = dampN(skirt.rotation.x, -0.08, 10, dt);
        skirt.rotation.z = dampN(skirt.rotation.z, 0, 10, dt);
      }
      hairDyn.rotation.z = dampN(hairDyn.rotation.z, 0, 8, dt);
      hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0, 8, dt);
    };

    if (pose === 'cook') {
      // —— 做饭：站灶台前，一手持铲推拉颠勺，一手叉腰，微前倾 ——
      standBase();
      root.rotation.x = dampN(root.rotation.x, 0.1, 8, dt);
      armL.rotation.x = dampN(armL.rotation.x, -1.02 + Math.sin(t * 5.2) * 0.3, 12, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.14, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.4 + Math.sin(t * 5.2 + 0.6) * 0.16, 12, dt);
      armR.rotation.x = dampN(armR.rotation.x, -0.22, 8, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.92, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.55, 8, dt);
      head.rotation.x = dampN(head.rotation.x, -0.12, 8, dt);
      head.rotation.z = dampN(head.rotation.z, 0, 8, dt);
      return;
    }
    if (pose === 'eat') {
      // —— 吃饭：坐餐桌边，一手循环舀饭送嘴 + 咀嚼 ——
      sitBase();
      const lift = Math.max(0, Math.sin(((t * 0.82) % 1) * Math.PI));
      armR.rotation.x = dampN(armR.rotation.x, -0.5 - lift * 1.42, 14, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.16, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.5 - lift * 0.78, 14, dt);
      armL.rotation.x = dampN(armL.rotation.x, -0.35, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.18, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.85, 8, dt);
      head.rotation.x = dampN(head.rotation.x, 0.14 - lift * 0.16, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 7) * 0.02, 10, dt);
      return;
    }
    if (pose === 'drink') {
      // —— 喝东西：站冰箱前举杯仰头咕咚咕咚 ——
      standBase();
      armR.rotation.x = dampN(armR.rotation.x, -2.02, 9, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.2, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.88, 9, dt);
      armL.rotation.x = dampN(armL.rotation.x, -0.08, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.12, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.14, 8, dt);
      head.rotation.x = dampN(head.rotation.x, -0.1 + Math.sin(t * 6) * 0.012, 8, dt);
      head.rotation.z = dampN(head.rotation.z, 0, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 1.6) * 0.02, 8, dt);
      return;
    }
    if (pose === 'piano') {
      // —— 弹钢琴：坐琴凳，双臂前伸，前臂交替敲键；音符驱动对应侧手 ——
      sitBase();
      const nowMs = performance.now();
      const sinceNote = nowMs - noteFx.current.pianoAt;
      const pulse = sinceNote < 220 ? 1 - sinceNote / 220 : 0;
      const noteSideL = noteFx.current.pianoSide > 0;
      const kL = Math.max(Math.max(0, Math.sin(t * 5.4)) * 0.55, pulse * (noteSideL ? 1 : 0));
      const kR = Math.max(Math.max(0, Math.sin(t * 5.4 + Math.PI)) * 0.55, pulse * (noteSideL ? 0 : 1));
      armL.rotation.x = dampN(armL.rotation.x, -1.26, 10, dt);
      armR.rotation.x = dampN(armR.rotation.x, -1.26, 10, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.22, 8, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.22, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.44 - kL * 0.4, 20, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.44 - kR * 0.4, 20, dt);
      head.rotation.x = dampN(head.rotation.x, 0.18, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 2.6) * 0.03, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 2.6) * 0.028, 8, dt);
      return;
    }
    if (pose === 'guitar') {
      // —— 弹吉他：站姿抱琴，一手扫弦一手按弦，扫弦音符驱动右手 ——
      standBase();
      const nowMs = performance.now();
      const sinceStrum = nowMs - noteFx.current.guitarAt;
      const strum = sinceStrum < 260 ? Math.sin((1 - sinceStrum / 260) * Math.PI) : 0;
      armR.rotation.x = dampN(armR.rotation.x, -0.88, 10, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.34, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -1.12 + Math.sin(t * 7.2) * 0.16 - strum * 0.34, 22, dt);
      armL.rotation.x = dampN(armL.rotation.x, -0.78, 10, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.52, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.5, 10, dt);
      head.rotation.x = dampN(head.rotation.x, 0, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 3.4) * 0.06, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 3.4) * 0.035, 8, dt);
      root.position.y = dampN(root.position.y, Math.abs(Math.sin(t * 3.4)) * 0.012 + 0.004, 10, dt);
      return;
    }
    if (pose === 'read') {
      // —— 看书：坐姿抱书，双手托书，偶尔翻页 ——
      sitBase();
      armL.rotation.x = dampN(armL.rotation.x, -1.08, 10, dt);
      armR.rotation.x = dampN(armR.rotation.x, -1.08, 10, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.3, 8, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.3, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.86, 10, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.86, 10, dt);
      head.rotation.x = dampN(head.rotation.x, 0.32, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 0.7) * 0.03, 8, dt);
      book.position.y = 0.31 + Math.sin(t * 1.8) * 0.006;
      return;
    }
    if (pose === 'makeup') {
      // —— 化妆：坐梳妆台小凳，一手持粉扑轻拍脸颊，歪头照镜子 ——
      sitBase();
      armR.rotation.x = dampN(armR.rotation.x, -1.6 + Math.sin(t * 2.9) * 0.16, 12, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.3, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -1.02, 10, dt);
      armL.rotation.x = dampN(armL.rotation.x, -0.3, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.16, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.72, 8, dt);
      head.rotation.x = dampN(head.rotation.x, 0.05, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 1.9) * 0.1, 8, dt);
      return;
    }
    if (pose === 'mirror') {
      // —— 照镜子：一手叉腰一手撩头发，左右打量自己 ——
      standBase();
      armL.rotation.x = dampN(armL.rotation.x, -0.2, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.98, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.6, 8, dt);
      armR.rotation.x = dampN(armR.rotation.x, -1.52 + Math.sin(t * 1.8) * 0.12, 9, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.34, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.92, 9, dt);
      head.rotation.x = dampN(head.rotation.x, 0, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 1.4) * 0.12, 8, dt);
      root.rotation.z = dampN(root.rotation.z, Math.sin(t * 0.9) * 0.04, 8, dt);
      return;
    }
    if (pose === 'petcare') {
      // —— 照顾宠物（v6.9）：屈膝微蹲 + 右手前伸向下（摸头/递碗），手随节奏轻摆 ——
      standBase();
      root.position.y = dampN(root.position.y, -0.055 + Math.sin(t * 2.2) * 0.005, 9, dt);
      root.rotation.x = dampN(root.rotation.x, 0.06, 8, dt);
      legL.rotation.x = dampN(legL.rotation.x, -0.52, 9, dt);
      legR.rotation.x = dampN(legR.rotation.x, -0.52, 9, dt);
      kneeL.rotation.x = dampN(kneeL.rotation.x, 0.5, 9, dt);
      kneeR.rotation.x = dampN(kneeR.rotation.x, 0.5, 9, dt);
      armR.rotation.x = dampN(armR.rotation.x, -1.14 + Math.sin(t * 3.2) * 0.1, 9, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.18, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.34 + Math.sin(t * 3.2 + 0.9) * 0.12, 9, dt);
      armL.rotation.x = dampN(armL.rotation.x, -0.18, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.3, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.5, 8, dt);
      head.rotation.x = dampN(head.rotation.x, 0.2, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 1.6) * 0.04, 8, dt);
      return;
    }
    if (pose === 'dance') {
      // —— 跳舞（v10 决策大脑）：双臂上举随节拍摆动，踮脚轻跳，身子左右扭 ——
      standBase();
      const beat = Math.sin(t * 4.6);
      const beat2 = Math.sin(t * 2.3);
      armL.rotation.x = dampN(armL.rotation.x, -2.2, 10, dt);
      armR.rotation.x = dampN(armR.rotation.x, -2.2, 10, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.5 + beat * 0.42, 12, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.5 + beat * 0.42, 12, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.5 + beat * 0.24, 12, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.5 - beat * 0.24, 12, dt);
      root.position.y = dampN(root.position.y, Math.abs(Math.sin(t * 4.6)) * 0.038, 12, dt);
      root.rotation.z = dampN(root.rotation.z, beat2 * 0.075, 10, dt);
      head.rotation.x = dampN(head.rotation.x, -0.06, 8, dt);
      head.rotation.z = dampN(head.rotation.z, -beat2 * 0.09, 10, dt);
      return;
    }
    if (pose === 'stretch') {
      // —— 伸懒腰（v10 决策大脑）：双臂高举过头 + 挺腰仰头，呼吸式使劲 ——
      standBase();
      const k = (Math.sin(t * 1.35) + 1) / 2;
      armL.rotation.x = dampN(armL.rotation.x, -2.75, 8, dt);
      armR.rotation.x = dampN(armR.rotation.x, -2.75, 8, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.14, 8, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.14, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.08, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.08, 8, dt);
      root.rotation.x = dampN(root.rotation.x, -0.07 - k * 0.05, 8, dt);
      root.position.y = dampN(root.position.y, k * 0.016, 8, dt);
      head.rotation.x = dampN(head.rotation.x, -0.2 - k * 0.1, 8, dt);
      head.rotation.z = dampN(head.rotation.z, 0, 8, dt);
      return;
    }
    if (pose === 'water') {
      // —— 浇花（v10 决策大脑）：双手前伸持壶，身体前倾随节奏倾斜壶口 ——
      standBase();
      const tilt = (Math.sin(t * 1.5) + 1) / 2;
      root.rotation.x = dampN(root.rotation.x, 0.12, 9, dt);
      armL.rotation.x = dampN(armL.rotation.x, -1.28, 10, dt);
      armR.rotation.x = dampN(armR.rotation.x, -1.22, 10, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.3, 8, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.34, 8, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -0.5 + tilt * 0.22, 10, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.46 + tilt * 0.22, 10, dt);
      head.rotation.x = dampN(head.rotation.x, 0.22, 8, dt);
      head.rotation.z = dampN(head.rotation.z, Math.sin(t * 1.2) * 0.03, 8, dt);
      return;
    }

    if (pose === 'hug') {
      // —— 拥抱（v8.0 陪伴交互）：双臂前伸环抱 + 身体前倾 + 头轻靠，随呼吸轻晃 ——
      standBase();
      root.rotation.x = dampN(root.rotation.x, 0.09, 9, dt);
      const sway = Math.sin(t * 2.1) * 0.02;
      armL.rotation.x = dampN(armL.rotation.x, -1.32, 9, dt);
      armL.rotation.z = dampN(armL.rotation.z, -0.42 + sway, 9, dt);
      foreL.rotation.x = dampN(foreL.rotation.x, -1.36, 9, dt);
      armR.rotation.x = dampN(armR.rotation.x, -1.32, 9, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.42 - sway, 9, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -1.36, 9, dt);
      head.rotation.x = dampN(head.rotation.x, 0.1, 8, dt);
      head.rotation.z = dampN(head.rotation.z, sway * 1.4, 8, dt);
      root.position.y = dampN(root.position.y, Math.sin(t * 2.2) * 0.007 + 0.004, 10, dt);
      return;
    }
    if (pose === 'holdhand') {
      // —— 牵手（v8.0 陪伴交互）：右手抬起伸向用户（牵着），左手/腿随走摆或待机 ——
      lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
      lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
      // 被牵住的手臂：抬起朝向用户侧（牵手姿势恒定，走路也牵着）
      armR.rotation.x = dampN(armR.rotation.x, -0.92, 10, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.52, 10, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.26, 10, dt);
      if (rt.moving) {
        // —— 牵手同行：迈腿 + 自由手臂摆 + 小弹跳（牵手手稳稳抬起） ——
        const s = Math.sin(t * 10);
        legL.rotation.x = dampN(legL.rotation.x, s * 0.62, 22, dt);
        legR.rotation.x = dampN(legR.rotation.x, -s * 0.62, 22, dt);
        kneeL.rotation.x = dampN(kneeL.rotation.x, Math.max(0, -s) * 0.86, 22, dt);
        kneeR.rotation.x = dampN(kneeR.rotation.x, Math.max(0, s) * 0.86, 22, dt);
        armL.rotation.x = dampN(armL.rotation.x, -s * 0.52, 20, dt);
        armL.rotation.z = dampN(armL.rotation.z, -0.16, 14, dt);
        foreL.rotation.x = dampN(foreL.rotation.x, -0.36, 14, dt);
        root.position.y = Math.abs(Math.sin(t * 10)) * 0.034;
        root.rotation.x = dampN(root.rotation.x, 0.05, 12, dt);
        root.rotation.z = dampN(root.rotation.z, s * 0.035, 14, dt);
        head.rotation.x = dampN(head.rotation.x, 0.02, 12, dt);
        head.rotation.z = dampN(head.rotation.z, -s * 0.04, 12, dt);
        if (skirt) {
          skirt.rotation.x = dampN(skirt.rotation.x, -0.13, 10, dt);
          skirt.rotation.z = dampN(skirt.rotation.z, s * 0.05, 12, dt);
        }
        hairDyn.rotation.z = dampN(hairDyn.rotation.z, s * 0.07, 12, dt);
        hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0.05, 12, dt);
      } else {
        // —— 牵手站定：面向用户 + 满足轻晃 ——
        legL.rotation.x = dampN(legL.rotation.x, 0, 10, dt);
        legR.rotation.x = dampN(legR.rotation.x, 0, 10, dt);
        kneeL.rotation.x = dampN(kneeL.rotation.x, 0, 10, dt);
        kneeR.rotation.x = dampN(kneeR.rotation.x, 0, 10, dt);
        armL.rotation.x = dampN(armL.rotation.x, Math.sin(t * 1.7) * 0.05, 8, dt);
        armL.rotation.z = dampN(armL.rotation.z, -0.16, 10, dt);
        foreL.rotation.x = dampN(foreL.rotation.x, -0.14, 8, dt);
        root.position.y = Math.sin(t * 2.2) * 0.009 + 0.004;
        root.rotation.x = dampN(root.rotation.x, 0.02, 10, dt);
        root.rotation.z = dampN(root.rotation.z, 0, 10, dt);
        head.rotation.x = dampN(head.rotation.x, 0.03, 8, dt);
        head.rotation.z = dampN(head.rotation.z, Math.sin(t * 1.5) * 0.05, 10, dt);
        if (skirt) skirt.rotation.z = dampN(skirt.rotation.z, 0, 10, dt);
        hairDyn.rotation.z = dampN(hairDyn.rotation.z, 0, 8, dt);
        hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0, 8, dt);
      }
      return;
    }

    // sit / bath：屈髋屈膝坐姿
    lieWrap.rotation.x = dampN(lieWrap.rotation.x, 0, 10, dt);
    lieWrap.rotation.y = dampN(lieWrap.rotation.y, 0, 10, dt);
    const baseY = pose === 'bath' ? poseY : Math.max(0.02, poseY - hipY);
    root.position.y = dampN(root.position.y, baseY, 9, dt);
    root.rotation.x = dampN(root.rotation.x, pose === 'bath' ? 0.12 : 0.03, 8, dt);
    root.rotation.z = dampN(root.rotation.z, 0, 8, dt);
    const thigh = pose === 'bath' ? -1.38 : -1.55;
    legL.rotation.x = dampN(legL.rotation.x, thigh, 10, dt);
    legR.rotation.x = dampN(legR.rotation.x, thigh, 10, dt);
    kneeL.rotation.x = dampN(kneeL.rotation.x, -thigh * 0.95, 10, dt);
    kneeR.rotation.x = dampN(kneeR.rotation.x, -thigh * 0.95, 10, dt);
    const armX = pose === 'bath' ? -1.05 : -0.4;
    armL.rotation.x = dampN(armL.rotation.x, armX, 9, dt);
    armR.rotation.x = dampN(armR.rotation.x, armX, 9, dt);
    armL.rotation.z = dampN(armL.rotation.z, -0.12, 8, dt);
    armR.rotation.z = dampN(armR.rotation.z, 0.12, 8, dt);
    foreL.rotation.x = dampN(foreL.rotation.x, pose === 'bath' ? -0.5 : -0.7, 9, dt);
    foreR.rotation.x = dampN(foreR.rotation.x, pose === 'bath' ? -0.5 : -0.7, 9, dt);
    head.rotation.x = dampN(head.rotation.x, 0, 8, dt);
    head.rotation.z = dampN(head.rotation.z, 0, 8, dt);
    if (skirt) {
      skirt.rotation.x = dampN(skirt.rotation.x, pose === 'bath' ? -0.12 : -0.08, 10, dt);
      skirt.rotation.z = dampN(skirt.rotation.z, 0, 10, dt);
    }
    hairDyn.rotation.z = dampN(hairDyn.rotation.z, 0, 8, dt);
    hairDyn.rotation.x = dampN(hairDyn.rotation.x, 0, 8, dt);
    // 坐着端杯：右手把杯子端在胸前（只对 sit）
    if (pose === 'sit' && carry) {
      armR.rotation.x = dampN(armR.rotation.x, -1.02, 9, dt);
      armR.rotation.z = dampN(armR.rotation.z, 0.18, 8, dt);
      foreR.rotation.x = dampN(foreR.rotation.x, -0.95, 9, dt);
    }
    // 泡澡轻轻晃悠
    if (pose === 'bath') {
      root.position.y += Math.sin(t * 2.4) * 0.006;
      foam.children.forEach((f, i) => {
        f.position.y += Math.sin(t * 2.2 + i * 1.3) * 0.00035;
      });
    }
  });

  return (
    <group ref={holder} scale={1}>
      <primitive object={rig.root} />
      {/* 访客名牌：头顶浮名字牌 */}
      {who === 'guest' && guestName && <GuestTag name={guestName} />}
      {/* v8.0 点击热区（透明大球，盖住小人全身 + 富余；点小人 → 拥抱/牵手环形菜单）
          v11 长按：按下 550ms 触发 onLongPress（生活模式陪伴小人专属）；期间移出/拖动/抬起取消，
          触发过长按后本轮抬起不再触发 onTap */}
      {(onTap || onLongPress) && (
        <mesh
          position={[0, 0.52, 0]}
          onPointerDown={(e) => {
            e.stopPropagation();
            clearPress();
            pressRef.current.x = e.nativeEvent.clientX;
            pressRef.current.y = e.nativeEvent.clientY;
            pressRef.current.suppress = false;
            if (onLongPress) {
              pressRef.current.timer = window.setTimeout(() => {
                pressRef.current.timer = null;
                pressRef.current.suppress = true; // 本轮抬起不再触发 onTap
                onLongPress();
              }, 550);
            }
          }}
          onPointerUp={() => {
            const wasLong = pressRef.current.suppress;
            clearPress();
            pressRef.current.suppress = false;
            if (onTap && !wasLong) onTap();
          }}
          onPointerLeave={() => {
            // 移出热区：长按计时取消
            clearPress();
            pressRef.current.suppress = false;
          }}
          onPointerMove={(e) => {
            if (pressRef.current.timer === null) return;
            const dx = e.nativeEvent.clientX - pressRef.current.x;
            const dy = e.nativeEvent.clientY - pressRef.current.y;
            if (dx * dx + dy * dy > 144) {
              // 移动超阈值（≈12px）：视为拖动视角，取消长按
              clearPress();
              pressRef.current.suppress = false;
            }
          }}
        >
          <sphereGeometry args={[0.58, 12, 10]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** 访客头顶名牌（canvas 纹理） */
function GuestTag({ name }: { name: string }) {
  const tex = useMemo(() => {
    const W = 256;
    const H = 96;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    const r = 24;
    ctx.fillStyle = 'rgba(255,253,248,0.94)';
    ctx.strokeStyle = '#f2b3c2';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(r + 3, 3);
    ctx.arcTo(W - 3, 3, W - 3, H - 3, r);
    ctx.arcTo(W - 3, H - 3, 3, H - 3, r);
    ctx.arcTo(3, H - 3, 3, 3, r);
    ctx.arcTo(3, 3, W - 3, 3, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4a4a4e';
    ctx.font = '600 46px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name.slice(0, 6), W / 2, H / 2 + 3);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [name]);
  return (
    <group position={[0, 1.08, 0]}>
      <sprite scale={[0.5, 0.19, 1]}>
        <spriteMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
      </sprite>
    </group>
  );
}
