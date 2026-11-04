'use client';

/**
 * 情侣小家 3D —— 暖奶油风新家具「Cozy 系列」（15 件程序化模型，无 GLB）
 *
 * - Curtain3D 落地窗帘（开合 damp）/ Fireplace3D 壁炉（火焰抖动 + 余烬光 flicker + 火星粒子飘升）；
 * - Fishtank3D 鱼缸（三鱼椭圆巡游 + 气泡 + 投食加速聚食）/ Beanbag3D 懒人沙发；
 * - Piano3D 立式钢琴 + 琴凳（随机琴键按压 + 音符精灵上浮）/ Guitar3D 木吉他斜倚（振动 + 音符）；
 * - StandingMirror3D 穿衣落地镜 / StarProjector3D 星空投影灯（天花板星点 THREE.Points 自转）；
 * - Canopy3D 床幔四柱纱帐（垂纱风摆）/ CoffeeMaker3D 咖啡机（蒸汽精灵 + 指示灯）；
 * - FruitBowl3D 果盘 / WallShelf3D 挂墙置物架（原点 = 挂板背面中心）/ BathCurtain3D 浴帘；
 * - Toiletries3D 洗漱套装 / Scale3D 体重秤。
 *
 * 约定：所有组件原点 = 底部中心、贴地 y=0（WallShelf3D 例外：挂板背面中心）；
 * 配色全屋暖奶油系；动画一律 useFrame + THREE.MathUtils.damp / sin 摆动；
 * 尺寸单位 = 米（世界坐标，MODEL_SCALE 由接线方处理）。
 */

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/** 共享 props：接线方按家具类型透传 */
export interface CozyProps {
  col?: string;      // 用户调色主色
  on?: boolean;      // 开关状态（fireplace/starLamp）
  open?: boolean;    // 窗帘开合（curtain/bathCurtain）
  playing?: boolean; // 演奏中（piano/guitar）
  brewing?: boolean; // 咖啡机工作中
  fedAt?: number;    // 鱼缸投喂时间戳（Date.now()），elapsed<6s 判定鱼加速+食物下沉
}

const mat = (c: string, rough = 0.85, extra?: Partial<THREE.MeshStandardMaterialParameters>) => (
  <meshStandardMaterial color={c} roughness={rough} metalness={0} {...extra} />
);

/** 同色系加深（制造凹陷/裙边阴影感） */
const shade = (hex: string, f: number) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();

/** 音符精灵贴图（canvas 画 ♪ ♫ ♬） */
function makeNoteTexture(ch: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, 96, 96);
  ctx.fillStyle = '#8a6a48';
  ctx.font = '64px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, 48, 52);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 白色蒸汽雾贴图（径向渐变；export 供 Furn3D 微波炉蒸汽复用） */
export function makeSteamTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------- 1. 落地窗帘 ----------------

export function Curtain3D({ col, open }: CozyProps) {
  const fabric = col ?? '#f5efe6';
  const brass = '#d9b36c';
  const panels = useRef<(THREE.Group | null)[]>([]); // [左(-1), 右(+1)]

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    const t = performance.now() / 1000;
    // open=true：收拢到两侧（30% 宽、x=±0.95）；false：两片布面在中线相接（各 0.78 宽 → 合拢共 1.56m，把窗户全部遮住）
    panels.current.forEach((g, i) => {
      if (!g) return;
      const s = i === 0 ? -1 : 1;
      g.position.x = THREE.MathUtils.damp(g.position.x, s * (open ? 0.95 : 0.39), 5, d);
      g.scale.x = THREE.MathUtils.damp(g.scale.x, open ? 0.3 : 1, 5, d);
      // 微风摆动（布料垂坠的轻柔呼吸感）
      g.rotation.y = Math.sin(t * 0.9 + i * 1.7) * 0.012;
    });
  });

  return (
    <group>
      {/* 黄铜横杆 + 两端球形头 */}
      <mesh position={[0, 2.25, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.015, 0.015, 2.36, 12]} />
        {mat(brass, 0.3, { metalness: 0.75 })}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[1.19 * s, 2.25, 0]}>
          <sphereGeometry args={[0.038, 12, 10]} />
          {mat(brass, 0.3, { metalness: 0.75 })}
        </mesh>
      ))}
      {/* 左右两片布艺窗帘（v6.4：实心布面替代旧款胶囊柱——合拢时是一整块不透窗的布，竖向压褶 + 波浪底摆 + 穿杆帘头） */}
      {[-1, 1].map((s, si) => (
        <group key={s} ref={(g) => { panels.current[si] = g; }} position={[s * 0.39, 0, 0]}>
          {/* 布面主体（实心板，合拢时不透窗） */}
          <mesh position={[0, 1.1, 0]} castShadow>
            <boxGeometry args={[0.78, 2.12, 0.02]} />
            {mat(fabric, 0.95)}
          </mesh>
          {/* 竖向压褶（压扁胶囊凸出布面，长短交替营造自然褶皱） */}
          {[-0.29, -0.145, 0, 0.145, 0.29].map((px, i) => (
            <mesh
              key={px}
              position={[px, 1.09, 0.016]}
              scale={[1, 1, 0.3]}
              castShadow={i === 0 || i === 4}
            >
              <capsuleGeometry args={[0.042, 2 - (i % 2) * 0.07, 4, 10]} />
              {mat(fabric, 0.98)}
            </mesh>
          ))}
          {/* 底摆微波浪（小球收边，布料垂感） */}
          {[-0.26, -0.09, 0.09, 0.26].map((px, i) => (
            <mesh key={px} position={[px, 0.048 + (i % 2) * 0.02, 0.014]}>
              <sphereGeometry args={[0.036, 10, 8]} />
              {mat(fabric, 0.95)}
            </mesh>
          ))}
          {/* 顶部穿杆帘头（盖住布面顶端与横杆衔接） */}
          <mesh position={[0, 2.16, 0.008]} castShadow>
            <boxGeometry args={[0.8, 0.1, 0.036]} />
            {mat(fabric, 0.9)}
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------- 2. 壁炉 ----------------

const FIRE_FLAMES = [
  { pos: [-0.1, 0.31, -0.02] as [number, number, number], r: 0.075, h: 0.24, c: '#ff9a3d' },
  { pos: [0.07, 0.3, 0.02] as [number, number, number], r: 0.06, h: 0.2, c: '#ff9a3d' },
  { pos: [-0.01, 0.34, 0.04] as [number, number, number], r: 0.055, h: 0.18, c: '#ffd166' },
];

/** 火星粒子：各自随机相位，从炉膛向上飘 0.5m 渐隐循环（v5.9 F2） */
const FIRE_SPARKS = [0.07, 0.23, 0.41, 0.57, 0.74, 0.9];

/** 火星贴图（橙黄径向光斑，加法混合发亮） */
function makeEmberTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 32;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,230,150,1)');
  g.addColorStop(0.4, 'rgba(255,160,60,0.8)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function Fireplace3D({ on }: CozyProps) {
  const cream = '#f6f2ea';
  const flames = useRef<(THREE.Mesh | null)[]>([]);
  const light = useRef<THREE.PointLight>(null);
  const sparks = useRef<(THREE.Sprite | null)[]>([]);
  const sparkTex = useMemo(() => makeEmberTexture(), []);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const t = state.clock.elapsedTime;
    flames.current.forEach((f, i) => {
      if (!f) return;
      f.visible = !!on;
      if (on) {
        const s = 1 + Math.sin(t * 7 + i * 2.1) * 0.16;
        f.scale.set(s, 1 + Math.sin(t * 9 + i * 1.6) * 0.24, s);
        f.rotation.z = Math.sin(t * 5 + i * 2.4) * 0.12;
        f.rotation.x = Math.sin(t * 6.3 + i) * 0.06;
      }
    });
    if (light.current) {
      // 余烬光 flicker：damp 往返 0.9 ~ 1.4，关火 damp 回 0
      const target = on ? 1.15 + Math.sin(t * 9.3) * 0.25 : 0;
      light.current.intensity = THREE.MathUtils.damp(light.current.intensity, target, 8, d);
    }
    // 火星粒子：仅开火时从炉膛向上飘 0.5m 渐隐循环（visible=false 省渲染）
    sparks.current.forEach((sp, i) => {
      if (!sp) return;
      sp.visible = !!on;
      if (!on) return;
      const s = FIRE_SPARKS[i];
      const life = (t * 0.5 + s) % 1;
      sp.position.set(
        Math.sin(s * 43 + t * 1.4) * 0.1,
        0.36 + life * 0.5,
        Math.cos(s * 29 + t) * 0.05,
      );
      const sc = 0.028 + (1 - life) * 0.02;
      sp.scale.set(sc, sc, 1);
      (sp.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.95 * (1 - life));
    });
  });

  return (
    <group>
      {/* 炉底基座（炭灰炉膛口沿） */}
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[1.4, 0.16, 0.44]} />
        {mat('#4a4a50', 0.9)}
      </mesh>
      {/* 内腔（黑） */}
      <mesh position={[0, 0.45, -0.03]}>
        <boxGeometry args={[1.02, 0.58, 0.36]} />
        {mat('#17171a', 0.95)}
      </mesh>
      {/* 左右炉柱（奶白炉体） */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.605 * s, 0.53, 0]} castShadow>
          <boxGeometry args={[0.19, 0.74, 0.42]} />
          {mat(cream, 0.85)}
        </mesh>
      ))}
      {/* 顶带 */}
      <mesh position={[0, 0.895, 0]} castShadow>
        <boxGeometry args={[1.4, 0.31, 0.42]} />
        {mat(cream, 0.85)}
      </mesh>
      {/* 顶部横梁搁板（木色） */}
      <mesh position={[0, 1.075, 0.01]} castShadow>
        <boxGeometry args={[1.58, 0.05, 0.5]} />
        {mat('#d9c7ae', 0.8)}
      </mesh>
      {/* 交叉木柴 ×2 */}
      <mesh position={[-0.05, 0.26, 0]} rotation={[0, 0.35, 0.55]} castShadow>
        <cylinderGeometry args={[0.028, 0.028, 0.5, 8]} />
        {mat('#6b4a32', 0.95)}
      </mesh>
      <mesh position={[0.05, 0.26, 0.02]} rotation={[0, -0.3, -0.55]} castShadow>
        <cylinderGeometry args={[0.028, 0.028, 0.5, 8]} />
        {mat('#7a563c', 0.95)}
      </mesh>
      {/* 火焰 ×3（on 时可见，每帧 sin 抖动） */}
      {FIRE_FLAMES.map((fl, i) => (
        <mesh key={i} ref={(m) => { flames.current[i] = m; }} position={fl.pos} visible={false}>
          <coneGeometry args={[fl.r, fl.h, 8]} />
          {mat(fl.c, 0.5, { emissive: fl.c, emissiveIntensity: 0.9, transparent: true, opacity: 0.9, depthWrite: false })}
        </mesh>
      ))}
      {/* 余烬光 */}
      <pointLight ref={light} position={[0, 0.42, 0.05]} color="#ff9a3d" intensity={0} distance={3} />
      {/* 火星粒子 ×6（仅开火可见，加法混合橙黄光斑） */}
      {FIRE_SPARKS.map((_, i) => (
        <sprite
          key={i}
          ref={(el) => { sparks.current[i] = el; }}
          position={[0, 0.4, 0]}
          visible={false}
        >
          <spriteMaterial
            map={sparkTex}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}

// ---------------- 3. 鱼缸 ----------------

const FISH_CFG = [
  { c: '#f2a9bc', rx: 0.3, rz: 0.1, w: 1.6, phase: 0, h: 0.88 },
  { c: '#f7c66b', rx: 0.24, rz: 0.14, w: 2.1, phase: 2.1, h: 0.94 },
  { c: '#9fd8cf', rx: 0.33, rz: 0.08, w: 1.25, phase: 4.2, h: 0.99 },
];
const BUBBLE_XZ: [number, number][] = [
  [-0.25, -0.08], [0.15, 0.1], [0.28, -0.12], [-0.05, 0.14], [0.05, -0.05],
];
const FOOD_XZ: [number, number][] = [
  [-0.2, 0.05], [-0.12, -0.1], [0, 0.08], [0.12, -0.05], [0.2, 0.02], [0.08, -0.12], [-0.08, 0.12], [0.16, -0.02],
];

export function Fishtank3D({ fedAt }: CozyProps) {
  const fish = useRef<(THREE.Group | null)[]>([]);
  const weeds = useRef<(THREE.Mesh | null)[]>([]);
  const bubbles = useRef<THREE.Group>(null);
  const food = useRef<THREE.Group>(null);
  const feed = useRef(0); // 0~1 聚食程度（damp 过渡）

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const t = state.clock.elapsedTime;
    const feeding = !!fedAt && Date.now() - fedAt < 6000;
    feed.current = THREE.MathUtils.damp(feed.current, feeding ? 1 : 0, 3.5, d);
    const f = feed.current;
    // 三条小鱼：各自椭圆轨道，速度/半径随聚食变化，朝向速度方向
    fish.current.forEach((g, i) => {
      if (!g) return;
      const cfg = FISH_CFG[i];
      const speed = cfg.w * (1 + 1.2 * f); // 投食时 ×2.2
      const a = t * speed + cfg.phase;
      const rx = cfg.rx * (1 - 0.45 * f); // 轨道缩小（聚食）
      const rz = cfg.rz * (1 - 0.45 * f);
      g.position.set(rx * Math.cos(a), cfg.h + Math.sin(a * 2 + i) * 0.02, rz * Math.sin(a));
      const vx = -rx * Math.sin(a) * speed;
      const vz = rz * Math.cos(a) * speed;
      g.rotation.y = Math.atan2(-vz, vx);
    });
    // 水草摆动
    weeds.current.forEach((w, i) => {
      if (w) w.rotation.z = Math.sin(t * 1.2 + i * 1.9) * 0.1;
    });
    // 气泡循环上浮
    if (bubbles.current) {
      bubbles.current.children.forEach((b, i) => {
        const p = BUBBLE_XZ[i % BUBBLE_XZ.length];
        b.position.y = 0.68 + ((t * 0.13 + i * 0.14) % 0.35);
        b.position.x = p[0] + Math.sin(t * 2 + i) * 0.012;
      });
    }
    // 投食：食物颗粒从水面缓慢下沉
    if (food.current) {
      food.current.visible = f > 0.4;
      food.current.children.forEach((p, i) => {
        p.position.y = 1.02 - ((t * 0.09 + i * 0.09) % 0.33);
        p.position.x = FOOD_XZ[i][0] + Math.sin(t * 1.5 + i) * 0.01;
      });
    }
  });

  const wood = '#d9c7ae';
  return (
    <group>
      {/* 木色柜座 + 柜门 */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.9, 0.6, 0.45]} />
        {mat(wood, 0.8)}
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[0.21 * s, 0.3, 0.235]}>
          <mesh>
            <boxGeometry args={[0.4, 0.52, 0.016]} />
            {mat('#c8b49a', 0.8)}
          </mesh>
          <mesh position={[0.14 * s, 0, 0.012]}>
            <sphereGeometry args={[0.014, 8, 8]} />
            {mat('#d9b36c', 0.3, { metalness: 0.75 })}
          </mesh>
        </group>
      ))}
      {/* 玻璃缸 */}
      <mesh position={[0, 0.85, 0]}>
        <boxGeometry args={[0.86, 0.5, 0.42]} />
        {mat('#d8ecf2', 0.05, { transparent: true, opacity: 0.18 })}
      </mesh>
      {/* 缸内水体（顶部留 0.06 空气） */}
      <mesh position={[0, 0.83, 0]}>
        <boxGeometry args={[0.82, 0.42, 0.38]} />
        {mat('#bfe3f2', 0.25, { transparent: true, opacity: 0.45 })}
      </mesh>
      {/* 底部砂砾 */}
      <mesh position={[0, 0.645, 0]}>
        <boxGeometry args={[0.82, 0.05, 0.38]} />
        {mat('#e8dcc8', 0.95)}
      </mesh>
      {/* 小水草 ×2 */}
      {[[-0.22, -0.1], [0.24, 0.08]].map((p, i) => (
        <mesh
          key={i}
          ref={(m) => { weeds.current[i] = m; }}
          position={[p[0], 0.8, p[1]]}
        >
          <coneGeometry args={[0.028, 0.26, 6]} />
          {mat(i === 0 ? '#7fb069' : '#8fbe7a', 0.8)}
        </mesh>
      ))}
      {/* 小鱼 ×3（压扁球身 + 三角尾鳍） */}
      {FISH_CFG.map((cfg, i) => (
        <group key={i} ref={(g) => { fish.current[i] = g; }} position={[0, cfg.h, 0]}>
          <mesh scale={[1.5, 0.85, 0.6]}>
            <sphereGeometry args={[0.032, 12, 10]} />
            {mat(cfg.c, 0.6)}
          </mesh>
          <mesh position={[-0.05, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.5]}>
            <coneGeometry args={[0.02, 0.05, 4]} />
            {mat(cfg.c, 0.6)}
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0.03, 0.008, 0.014 * s]}>
              <sphereGeometry args={[0.005, 6, 6]} />
              {mat('#3a3a40', 0.4)}
            </mesh>
          ))}
        </group>
      ))}
      {/* 气泡 ×5 */}
      <group ref={bubbles}>
        {BUBBLE_XZ.map((p, i) => (
          <mesh key={i} position={[p[0], 0.7, p[1]]}>
            <sphereGeometry args={[0.007 + (i % 3) * 0.002, 8, 8]} />
            {mat('#ffffff', 0.1, { transparent: true, opacity: 0.65 })}
          </mesh>
        ))}
      </group>
      {/* 食物颗粒 ×8（投喂时从水面下沉） */}
      <group ref={food} visible={false}>
        {FOOD_XZ.map((p, i) => (
          <mesh key={i} position={[p[0], 1.0, p[1]]}>
            <sphereGeometry args={[0.012, 6, 6]} />
            {mat('#c98d5a', 0.9)}
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------- 4. 懒人沙发 ----------------

export function Beanbag3D({ col }: CozyProps) {
  const base = col ?? '#f2c7cf';
  const dent = useMemo(() => shade(base, 0.88), [base]);
  const skirt = useMemo(() => shade(base, 0.93), [base]);
  return (
    <group>
      {/* 大压扁球主体 */}
      <mesh position={[0, 0.26, 0]} scale={[1.15, 0.62, 1.05]} castShadow>
        <sphereGeometry args={[0.42, 24, 18]} />
        {mat(base, 0.95)}
      </mesh>
      {/* 顶部坐坑（更小更暗的同色球） */}
      <mesh position={[0, 0.4, 0.02]} scale={[1.05, 0.42, 0.92]}>
        <sphereGeometry args={[0.28, 18, 14]} />
        {mat(dent, 0.95)}
      </mesh>
      {/* 底部裙边 */}
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.36, 0.44, 0.12, 22]} />
        {mat(skirt, 0.95)}
      </mesh>
    </group>
  );
}

// ---------------- 5. 立式钢琴 + 琴凳 ----------------

const KEY_Y = 0.775;
const PIANO_NOTES_X = [-0.35, 0.05, 0.35];

export function Piano3D({ col, playing }: CozyProps) {
  const body = col ?? '#f6f2ea';
  const wood = '#c8b49a';
  const keys = useRef<(THREE.Mesh | null)[]>([]);
  const notes = useRef<(THREE.Sprite | null)[]>([]);
  const acc = useRef(0);
  const active = useRef<number[]>([]);
  const noteTex = useMemo(() => ['♪', '♫', '♬'].map(makeNoteTexture), []);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const t = state.clock.elapsedTime;
    // 每 0.16s 轮换随机 2~3 根按下中的白键
    acc.current += d;
    if (acc.current > 0.16) {
      acc.current = 0;
      const n = 2 + Math.floor(Math.random() * 2);
      const set = new Set<number>();
      while (set.size < n) set.add(Math.floor(Math.random() * 14));
      active.current = [...set];
    }
    keys.current.forEach((k, i) => {
      if (!k) return;
      const target = playing && active.current.includes(i) ? KEY_Y - 0.012 : KEY_Y;
      k.position.y = THREE.MathUtils.damp(k.position.y, target, 20, d);
    });
    // 音符精灵：循环上浮 + 随高度淡出
    notes.current.forEach((sp, i) => {
      if (!sp) return;
      const p = (t * 0.35 + i / 3) % 1;
      sp.position.set(PIANO_NOTES_X[i], 1.3 + p * 0.55, 0.18);
      const m = sp.material as THREE.SpriteMaterial;
      m.opacity = playing ? (p < 0.15 ? p / 0.15 : (1 - p) * 0.9) : 0;
      sp.visible = !!playing && p < 0.97;
    });
  });

  // 白键 14 根，黑键跟在 0,1,3,4,5 / 7,8,10,11,12 缝后（两个八度）
  const blacks = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12];

  return (
    <group>
      {/* 主体（下半 + 上半） */}
      <mesh position={[0, 0.39, 0]} castShadow>
        <boxGeometry args={[1.45, 0.78, 0.58]} />
        {mat(body, 0.7)}
      </mesh>
      <mesh position={[0, 0.93, -0.02]} castShadow>
        <boxGeometry args={[1.45, 0.3, 0.54]} />
        {mat(body, 0.7)}
      </mesh>
      {/* 上盖斜面 */}
      <mesh position={[0, 1.16, -0.05]} rotation={[0.42, 0, 0]} castShadow>
        <boxGeometry args={[1.45, 0.05, 0.42]} />
        {mat(body, 0.65)}
      </mesh>
      {/* 键盘托（向前伸出） */}
      <mesh position={[0, 0.745, 0.4]} castShadow>
        <boxGeometry args={[1.42, 0.05, 0.22]} />
        {mat(wood, 0.75)}
      </mesh>
      {/* 键盘盖沿红色细毡条 */}
      <mesh position={[0, 0.768, 0.345]}>
        <boxGeometry args={[1.42, 0.014, 0.012]} />
        {mat('#b8434e', 0.9)}
      </mesh>
      {/* 白键 ×14 */}
      {Array.from({ length: 14 }, (_, i) => (
        <mesh
          key={`w${i}`}
          ref={(m) => { keys.current[i] = m; }}
          position={[(i - 6.5) * 0.056, KEY_Y, 0.44]}
        >
          <boxGeometry args={[0.048, 0.022, 0.15]} />
          {mat('#fdfaf4', 0.4)}
        </mesh>
      ))}
      {/* 黑键 ×10（higher / shorter） */}
      {blacks.map((i) => (
        <mesh key={`b${i}`} position={[(i - 6) * 0.056, 0.792, 0.405]}>
          <boxGeometry args={[0.03, 0.032, 0.095]} />
          {mat('#3a3a40', 0.5)}
        </mesh>
      ))}
      {/* 两条前腿 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.62 * s, 0.35, 0.44]} castShadow>
          <boxGeometry args={[0.09, 0.7, 0.09]} />
          {mat(body, 0.7)}
        </mesh>
      ))}
      {/* 踏板琴柱 + 黄铜踏板 ×3 */}
      <mesh position={[0, 0.16, 0.33]}>
        <boxGeometry args={[0.05, 0.12, 0.04]} />
        {mat(body, 0.7)}
      </mesh>
      {[-0.12, 0, 0.12].map((x) => (
        <mesh key={x} position={[x, 0.09, 0.36]}>
          <boxGeometry args={[0.05, 0.014, 0.09]} />
          {mat('#d9b36c', 0.3, { metalness: 0.75 })}
        </mesh>
      ))}
      {/* 配套琴凳（z=+0.72） */}
      <group position={[0, 0, 0.72]}>
        <mesh position={[0, 0.415, 0]} castShadow>
          <boxGeometry args={[0.85, 0.07, 0.3]} />
          {mat('#d9c7ae', 0.75)}
        </mesh>
        {[[-0.36, -0.1], [0.36, -0.1], [-0.36, 0.1], [0.36, 0.1]].map((p, i) => (
          <mesh key={i} position={[p[0], 0.19, p[1]]}>
            <cylinderGeometry args={[0.02, 0.022, 0.38, 8]} />
            {mat('#c8b49a', 0.75)}
          </mesh>
        ))}
      </group>
      {/* 音符精灵 ×3 */}
      {PIANO_NOTES_X.map((_, i) => (
        <sprite key={i} ref={(sp) => { notes.current[i] = sp; }} position={[0, 1.3, 0.18]} scale={[0.16, 0.16, 1]} visible={false}>
          <spriteMaterial map={noteTex[i]} transparent depthWrite={false} opacity={0} />
        </sprite>
      ))}
    </group>
  );
}

// ---------------- 6. 木吉他斜倚 ----------------

const GUITAR_NOTES_X = [-0.05, 0.0, 0.05];

export function Guitar3D({ col, playing }: CozyProps) {
  const wood = col ?? '#d9a86b';
  const tilt = useRef<THREE.Group>(null);
  const notes = useRef<(THREE.Sprite | null)[]>([]);
  const noteTex = useMemo(() => ['♪', '♫', '♬'].map(makeNoteTexture), []);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const t = state.clock.elapsedTime;
    // 演奏时琴身轻微振动
    if (tilt.current) {
      if (playing) tilt.current.position.x = Math.sin(t * 42) * 0.003;
      else tilt.current.position.x = THREE.MathUtils.damp(tilt.current.position.x, 0, 8, d);
    }
    // 音符精灵从音孔上浮
    notes.current.forEach((sp, i) => {
      if (!sp) return;
      const p = (t * 0.4 + i / 3) % 1;
      sp.position.set(GUITAR_NOTES_X[i], 0.55 + p * 0.6, 0.1);
      const m = sp.material as THREE.SpriteMaterial;
      m.opacity = playing ? (p < 0.15 ? p / 0.15 : (1 - p) * 0.9) : 0;
      sp.visible = !!playing && p < 0.97;
    });
  });

  return (
    <group>
      {/* 整体后仰 12°（底部贴地） */}
      <group ref={tilt} rotation={[-0.21, 0, 0]}>
        {/* 琴身 8 字形（下腰身 + 上腰身拼接） */}
        <mesh position={[0, 0.16, 0]} scale={[1, 1, 0.55]} castShadow>
          <sphereGeometry args={[0.16, 20, 16]} />
          {mat(wood, 0.6)}
        </mesh>
        <mesh position={[0, 0.415, 0]} scale={[1, 1, 0.5]} castShadow>
          <sphereGeometry args={[0.12, 18, 14]} />
          {mat(wood, 0.6)}
        </mesh>
        {/* 音孔（黑圆片 + 黄铜圈） */}
        <mesh position={[0, 0.3, 0.043]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.004, 20]} />
          {mat('#2e2620', 0.7)}
        </mesh>
        <mesh position={[0, 0.3, 0.046]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.055, 0.006, 8, 24]} />
          {mat('#d9b36c', 0.3, { metalness: 0.75 })}
        </mesh>
        {/* 琴桥 */}
        <mesh position={[0, 0.13, 0.088]}>
          <boxGeometry args={[0.1, 0.018, 0.014]} />
          {mat('#4a3a2a', 0.7)}
        </mesh>
        {/* 琴颈 + 深色指板 + 品丝 */}
        <mesh position={[0, 0.735, 0.045]} castShadow>
          <boxGeometry args={[0.055, 0.5, 0.024]} />
          {mat('#8a6a48', 0.7)}
        </mesh>
        <mesh position={[0, 0.735, 0.058]}>
          <boxGeometry args={[0.05, 0.48, 0.008]} />
          {mat('#3a2e24', 0.6)}
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[0, 0.56 + i * 0.08, 0.063]}>
            <boxGeometry args={[0.046, 0.004, 0.006]} />
            {mat('#d9b36c', 0.35, { metalness: 0.7 })}
          </mesh>
        ))}
        {/* 琴头 + 弦钮 ×3 */}
        <mesh position={[0, 1.04, 0.048]} castShadow>
          <boxGeometry args={[0.07, 0.12, 0.018]} />
          {mat('#4a3527', 0.65)}
        </mesh>
        {[1.0, 1.04, 1.08].map((y) => (
          <mesh key={y} position={[-0.048, y, 0.045]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.007, 0.007, 0.028, 8]} />
            {mat('#d9b36c', 0.3, { metalness: 0.75 })}
          </mesh>
        ))}
        {/* 上枕 */}
        <mesh position={[0, 0.95, 0.048]}>
          <boxGeometry args={[0.055, 0.012, 0.01]} />
          {mat('#f0e6d8', 0.5)}
        </mesh>
        {/* 琴弦 ×4（黄铜细柱，桥 → 枕） */}
        {[-0.018, -0.006, 0.006, 0.018].map((x) => (
          <mesh key={x} position={[x, 0.5375, 0.068]} rotation={[-0.061, 0, 0]}>
            <cylinderGeometry args={[0.003, 0.003, 0.82, 6]} />
            {mat('#d9b36c', 0.3, { metalness: 0.75 })}
          </mesh>
        ))}
      </group>
      {/* 底部小三脚支架 */}
      <group>
        <mesh position={[-0.09, 0.12, -0.06]} rotation={[0.4, 0, 0.15]}>
          <cylinderGeometry args={[0.008, 0.008, 0.26, 8]} />
          {mat('#8a6a48', 0.7)}
        </mesh>
        <mesh position={[0.09, 0.12, -0.06]} rotation={[0.4, 0, -0.15]}>
          <cylinderGeometry args={[0.008, 0.008, 0.26, 8]} />
          {mat('#8a6a48', 0.7)}
        </mesh>
        <mesh position={[0, 0.16, -0.13]}>
          <boxGeometry args={[0.22, 0.012, 0.012]} />
          {mat('#8a6a48', 0.7)}
        </mesh>
      </group>
      {/* 音符精灵 ×3（音孔上方） */}
      {GUITAR_NOTES_X.map((_, i) => (
        <sprite key={i} ref={(sp) => { notes.current[i] = sp; }} position={[0, 0.55, 0.1]} scale={[0.15, 0.15, 1]} visible={false}>
          <spriteMaterial map={noteTex[i]} transparent depthWrite={false} opacity={0} />
        </sprite>
      ))}
    </group>
  );
}

// ---------------- 7. 穿衣落地镜 ----------------

export function StandingMirror3D({ col }: CozyProps) {
  const frame = col ?? '#f2a9bc';
  return (
    <group>
      {/* 底部两片小足（不随后仰） */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.2 * s, 0.0275, -0.04]} castShadow>
          <boxGeometry args={[0.07, 0.055, 0.34]} />
          {mat('#c8b49a', 0.8)}
        </mesh>
      ))}
      {/* 整体略后仰 4° */}
      <group rotation={[-0.07, 0, 0]}>
        {/* 背板 */}
        <mesh position={[0, 0.845, -0.02]} scale={[0.6, 0.98, 1]}>
          <circleGeometry args={[0.75, 32]} />
          {mat('#efe9df', 0.9)}
        </mesh>
        {/* 椭圆镜面 */}
        <mesh position={[0, 0.845, 0.005]} scale={[0.62, 1, 1]}>
          <circleGeometry args={[0.75, 40]} />
          <meshStandardMaterial color="#e8edf2" roughness={0.06} metalness={0.9} envMapIntensity={1.2} />
        </mesh>
        {/* 樱粉椭圆框 */}
        <mesh position={[0, 0.845, 0.012]} scale={[0.62, 1, 1]} castShadow>
          <torusGeometry args={[0.75, 0.045, 12, 48]} />
          {mat(frame, 0.55)}
        </mesh>
        {/* 后背支撑斜杆 */}
        <mesh position={[0, 0.46, -0.22]} rotation={[0.35, 0, 0]} castShadow>
          <cylinderGeometry args={[0.015, 0.015, 0.95, 10]} />
          {mat('#c8b49a', 0.7)}
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 8. 星空投影灯 ----------------

export function StarProjector3D({ on }: CozyProps) {
  const dome = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const stars = useRef<THREE.Points>(null);

  // 天花板星点：~70 个随机点，半径 1.6、y=2.46 平面（同 group 本地坐标）
  const starGeo = useMemo(() => {
    const n = 70;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 1.6;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 2.46 + (Math.random() - 0.5) * 0.08;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    if (dome.current) {
      const m = dome.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = THREE.MathUtils.damp(m.emissiveIntensity, on ? 0.65 : 0, 6, d);
    }
    if (light.current) {
      light.current.intensity = THREE.MathUtils.damp(light.current.intensity, on ? 0.7 : 0, 6, d);
    }
    if (stars.current) {
      const m = stars.current.material as THREE.PointsMaterial;
      m.opacity = THREE.MathUtils.damp(m.opacity, on ? 0.95 : 0, 6, d);
      stars.current.visible = m.opacity > 0.02;
      if (on) stars.current.rotation.y += d * 0.05; // 缓慢自转
    }
  });

  return (
    <group>
      {/* 小圆底盘 */}
      <mesh position={[0, 0.015, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.12, 0.03, 20]} />
        {mat('#efe9df', 0.6)}
      </mesh>
      {/* 半球磨砂罩 */}
      <mesh ref={dome} position={[0, 0.028, 0]}>
        <sphereGeometry args={[0.09, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        {mat('#f0e6f7', 0.6, { emissive: '#cdb4f0', emissiveIntensity: 0 })}
      </mesh>
      {/* 底座开关小点 */}
      <mesh position={[0.085, 0.032, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.009, 0.009, 0.008, 10]} />
        {mat('#4a4a50', 0.5)}
      </mesh>
      {/* 淡紫点光 */}
      <pointLight ref={light} position={[0, 0.15, 0]} color="#cdb4f0" intensity={0} distance={2.5} />
      {/* 天花板星点（Points，缓慢自转；⚑ 禁用 raycast —— Points 默认 1m 射线阈值
          会把整片星空域变成隐形热区，劫持射向屋里家具的点击） */}
      <points ref={stars} geometry={starGeo} visible={false} raycast={() => {}}>
        <pointsMaterial
          size={0.035}
          color="#ffe9b8"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

// ---------------- 9. 床幔 / 蚊帐 ----------------

/** 垂纱片：顶端为摆动支点，底边轻微 sin 摆 */
function CanopyDrape({ w, pos, rotY, phase }: { w: number; pos: [number, number, number]; rotY: number; phase: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (g.current) {
      g.current.rotation.x = Math.sin(t * 0.9 + phase) * 0.02;
      g.current.rotation.z = Math.cos(t * 0.7 + phase * 1.3) * 0.015;
    }
  });
  return (
    <group ref={g} position={pos} rotation={[0, rotY, 0]}>
      <mesh position={[0, -0.95, 0]}>
        <planeGeometry args={[w, 1.9]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.3} roughness={0.9} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function Canopy3D({ col }: CozyProps) {
  const frameC = col ?? '#f6f2ea';
  // ⚑ 床幔不拦截射线：罩在床上会挡住点击床本体（睡觉交互），遍历禁用全部子孙 mesh 的 raycast
  const gref = useRef<THREE.Group>(null);
  useEffect(() => {
    gref.current?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.raycast = () => {};
    });
  }, []);
  return (
    <group ref={gref}>
      {/* 四根细立柱（四角 1.95 × 2.3） */}
      {[[-0.975, -1.15], [0.975, -1.15], [-0.975, 1.15], [0.975, 1.15]].map((p, i) => (
        <group key={i} position={[p[0], 0, p[1]]}>
          <mesh position={[0, 0.975, 0]} castShadow>
            <cylinderGeometry args={[0.022, 0.022, 1.95, 10]} />
            {mat(frameC, 0.7)}
          </mesh>
          <mesh position={[0, 1.96, 0]}>
            <sphereGeometry args={[0.03, 10, 8]} />
            {mat('#d9b36c', 0.3, { metalness: 0.75 })}
          </mesh>
        </group>
      ))}
      {/* 顶框四边横杆 */}
      {[-1.15, 1.15].map((z) => (
        <mesh key={`x${z}`} position={[0, 1.94, z]} castShadow>
          <boxGeometry args={[1.99, 0.03, 0.03]} />
          {mat(frameC, 0.7)}
        </mesh>
      ))}
      {[-0.975, 0.975].map((x) => (
        <mesh key={`z${x}`} position={[x, 1.94, 0]} castShadow>
          <boxGeometry args={[0.03, 0.03, 2.34]} />
          {mat(frameC, 0.7)}
        </mesh>
      ))}
      {/* 顶面白纱 */}
      <mesh position={[0, 1.92, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.95, 2.3]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.25} roughness={0.9} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* 四侧垂纱：床尾(z+) / 左右(x±) 全幅，床头侧(z-)只挂两窄条 */}
      <CanopyDrape w={1.95} pos={[0, 1.93, 1.15]} rotY={0} phase={0} />
      <CanopyDrape w={2.3} pos={[-0.975, 1.93, 0]} rotY={Math.PI / 2} phase={1.7} />
      <CanopyDrape w={2.3} pos={[0.975, 1.93, 0]} rotY={Math.PI / 2} phase={3.1} />
      <CanopyDrape w={0.35} pos={[-0.72, 1.93, -1.15]} rotY={0} phase={4.4} />
      <CanopyDrape w={0.35} pos={[0.72, 1.93, -1.15]} rotY={0} phase={5.6} />
    </group>
  );
}

// ---------------- 10. 咖啡机 ----------------

const STEAM_BASE: [number, number, number][] = [
  [0, 0.38, -0.02],
  [0.05, 0.4, 0.03],
  [0.09, 0.25, 0.08],
];

export function CoffeeMaker3D({ col, brewing }: CozyProps) {
  const shell = col ?? '#f6f2ea';
  const steamTex = useMemo(() => makeSteamTexture(), []);
  const steam = useRef<(THREE.Sprite | null)[]>([]);
  const ind = useRef<THREE.Mesh>(null);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const t = state.clock.elapsedTime;
    // 指示灯
    if (ind.current) {
      const m = ind.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = THREE.MathUtils.damp(m.emissiveIntensity, brewing ? 1.3 : 0, 8, d);
    }
    // 蒸汽精灵：循环上浮放大淡出
    steam.current.forEach((sp, i) => {
      if (!sp) return;
      const big = i < 2;
      const p = (t * (big ? 0.45 : 0.6) + i * 0.33) % 1;
      const b = STEAM_BASE[i];
      sp.position.set(b[0] + Math.sin(t * 2 + i * 2) * 0.02, b[1] + p * (big ? 0.24 : 0.16), b[2]);
      const sc = (big ? 0.09 : 0.055) * (1 + p * 1.2);
      sp.scale.set(sc, sc, 1);
      const m = sp.material as THREE.SpriteMaterial;
      m.opacity = brewing ? (1 - p) * 0.5 : 0;
      sp.visible = !!brewing && p < 0.98;
    });
  });

  return (
    <group>
      {/* 底盘 */}
      <mesh position={[0, 0.0125, 0]} castShadow>
        <boxGeometry args={[0.24, 0.025, 0.26]} />
        {mat('#4a4a50', 0.7)}
      </mesh>
      {/* 后部机身塔 */}
      <mesh position={[0, 0.17, -0.05]} castShadow>
        <boxGeometry args={[0.22, 0.29, 0.16]} />
        {mat(shell, 0.65)}
      </mesh>
      {/* 顶部圆弧盖 */}
      <mesh position={[0, 0.345, -0.05]}>
        <cylinderGeometry args={[0.115, 0.11, 0.04, 18]} />
        {mat('#4a4a50', 0.6)}
      </mesh>
      <mesh position={[0, 0.375, -0.05]} scale={[1, 0.4, 1]}>
        <sphereGeometry args={[0.115, 18, 12]} />
        {mat('#4a4a50', 0.6)}
      </mesh>
      {/* 前部出液罩 */}
      <mesh position={[0, 0.3, 0.08]} castShadow>
        <boxGeometry args={[0.22, 0.1, 0.1]} />
        {mat(shell, 0.65)}
      </mesh>
      {/* 出液口 */}
      <mesh position={[0, 0.245, 0.06]}>
        <cylinderGeometry args={[0.01, 0.01, 0.045, 8]} />
        {mat('#4a4a50', 0.5)}
      </mesh>
      {/* 前面板旋钮 */}
      <mesh position={[0, 0.2, 0.036]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.014, 12]} />
        {mat('#4a4a50', 0.5)}
      </mesh>
      {/* 指示灯（brewing 时亮红） */}
      <mesh ref={ind} position={[0.08, 0.2, 0.036]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.011, 0.011, 0.01, 10]} />
        {mat('#e2574c', 0.4, { emissive: '#e2574c', emissiveIntensity: 0 })}
      </mesh>
      {/* 玻璃咖啡壶 + 咖啡液 + 壶把 */}
      <group position={[0, 0, 0.06]}>
        <mesh position={[0, 0.11, 0]}>
          <cylinderGeometry args={[0.055, 0.045, 0.16, 16]} />
          {mat('#eef4f6', 0.1, { transparent: true, opacity: 0.3 })}
        </mesh>
        <mesh position={[0, 0.085, 0]}>
          <cylinderGeometry args={[0.045, 0.038, 0.09, 14]} />
          {mat('#6b4226', 0.3, { transparent: true, opacity: 0.85 })}
        </mesh>
        <mesh position={[0.065, 0.12, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.035, 0.007, 8, 16, Math.PI]} />
          {mat('#4a4a50', 0.5)}
        </mesh>
      </group>
      {/* 侧面小杯 */}
      <group position={[-0.16, 0, 0.04]}>
        <mesh position={[0, 0.03, 0]}>
          <cylinderGeometry args={[0.024, 0.02, 0.06, 12]} />
          {mat('#f2c7cf', 0.6)}
        </mesh>
        <mesh position={[0.028, 0.035, 0]} rotation={[0, 0, 0]}>
          <torusGeometry args={[0.014, 0.004, 6, 12]} />
          {mat('#f2c7cf', 0.6)}
        </mesh>
      </group>
      {/* 蒸汽精灵 ×3（顶部 2 + 壶口 1） */}
      {STEAM_BASE.map((_, i) => (
        <sprite key={i} ref={(sp) => { steam.current[i] = sp; }} position={[0, 0.4, 0]} scale={[0.08, 0.08, 1]} visible={false}>
          <spriteMaterial map={steamTex} transparent depthWrite={false} opacity={0} />
        </sprite>
      ))}
    </group>
  );
}

// ---------------- 11. 果盘 ----------------

export function FruitBowl3D({ col }: CozyProps) {
  const bowl = col ?? '#d9c7ae';
  return (
    <group>
      {/* 木碗（半球壳开口朝上，底部贴地） */}
      <mesh position={[0, 0.125, 0]} scale={[1, 0.8, 1]} castShadow>
        <sphereGeometry args={[0.16, 22, 14, 0, Math.PI * 2, Math.PI * 0.4, Math.PI * 0.6]} />
        {mat(bowl, 0.7, { side: THREE.DoubleSide })}
      </mesh>
      {/* 碗沿 */}
      <mesh position={[0, 0.163, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.148, 0.011, 8, 26]} />
        {mat(shade(bowl, 0.88), 0.7)}
      </mesh>
      {/* 红苹果 ×3（小球 + 小柄） */}
      {[[-0.055, 0.05, 0.02], [0.05, 0.055, -0.045], [0.0, 0.105, 0.01]].map((p, i) => (
        <group key={i} position={[p[0], p[1], p[2]]}>
          <mesh castShadow>
            <sphereGeometry args={[0.038, 14, 12]} />
            {mat(i === 2 ? '#e0655a' : '#d9584f', 0.6)}
          </mesh>
          <mesh position={[0, 0.043, 0]} rotation={[0.2, 0, 0.15]}>
            <cylinderGeometry args={[0.004, 0.004, 0.022, 6]} />
            {mat('#6b4a32', 0.8)}
          </mesh>
        </group>
      ))}
      {/* 香蕉（torus 弧段 0.6π） */}
      <group position={[-0.01, 0.05, 0.07]} rotation={[Math.PI / 2, 0, 1.2]}>
        <mesh>
          <torusGeometry args={[0.055, 0.018, 8, 16, Math.PI * 0.6]} />
          {mat('#f7d154', 0.65)}
        </mesh>
        <mesh position={[0.055, 0, 0]}>
          <sphereGeometry args={[0.009, 6, 6]} />
          {mat('#8a6a3a', 0.8)}
        </mesh>
        <mesh position={[-0.017, 0, 0.052]}>
          <sphereGeometry args={[0.009, 6, 6]} />
          {mat('#8a6a3a', 0.8)}
        </mesh>
      </group>
      {/* 橙子 ×2 */}
      <mesh position={[0.075, 0.045, 0.055]} castShadow>
        <sphereGeometry args={[0.042, 14, 12]} />
        {mat('#f5a34a', 0.8)}
      </mesh>
      <mesh position={[-0.02, 0.045, -0.085]} castShadow>
        <sphereGeometry args={[0.042, 14, 12]} />
        {mat('#f5a34a', 0.8)}
      </mesh>
    </group>
  );
}

// ---------------- 12. 挂墙置物架（原点 = 挂板背面中心） ----------------

export function WallShelf3D({ col }: CozyProps) {
  const wood = col ?? '#d9c7ae';
  return (
    <group>
      {/* 木板（板体中心 z=+0.1，背面贴墙） */}
      <mesh position={[0, 0, 0.1]} castShadow>
        <boxGeometry args={[0.9, 0.035, 0.2]} />
        {mat(wood, 0.75)}
      </mesh>
      {/* 隐形托架 ×2 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.4 * s, -0.04, 0.05]}>
          <boxGeometry args={[0.025, 0.05, 0.1]} />
          {mat(shade(wood, 0.9), 0.75)}
        </mesh>
      ))}
      {/* 小竖书 ×3（彩色书脊） */}
      <mesh position={[-0.32, 0.1025, 0.1]} castShadow>
        <boxGeometry args={[0.038, 0.17, 0.115]} />
        {mat('#f2a9bc', 0.8)}
      </mesh>
      <mesh position={[-0.265, 0.0925, 0.1]} castShadow>
        <boxGeometry args={[0.034, 0.15, 0.11]} />
        {mat('#9fb8a8', 0.8)}
      </mesh>
      <mesh position={[-0.208, 0.0975, 0.1]} rotation={[0, 0, -0.09]} castShadow>
        <boxGeometry args={[0.04, 0.16, 0.12]} />
        {mat('#d9b36c', 0.8)}
      </mesh>
      {/* 小多肉盆栽 */}
      <group position={[0.1, 0, 0.11]}>
        <mesh position={[0, 0.0425, 0]}>
          <cylinderGeometry args={[0.032, 0.026, 0.05, 12]} />
          {mat('#f2c7cf', 0.7)}
        </mesh>
        <mesh position={[0, 0.095, 0]}>
          <sphereGeometry args={[0.033, 12, 10]} />
          {mat('#7fae72', 0.85)}
        </mesh>
        <mesh position={[0.022, 0.078, 0.008]}>
          <sphereGeometry args={[0.017, 8, 8]} />
          {mat('#8fbe7a', 0.85)}
        </mesh>
        <mesh position={[-0.02, 0.08, -0.006]}>
          <sphereGeometry args={[0.015, 8, 8]} />
          {mat('#6f9e63', 0.85)}
        </mesh>
      </group>
      {/* 玻璃罐（罐身 + 黄铜盖 + 棉球） */}
      <group position={[0.33, 0, 0.11]}>
        <mesh position={[0, 0.0625, 0]}>
          <cylinderGeometry args={[0.036, 0.036, 0.09, 14]} />
          {mat('#e8f2f5', 0.05, { transparent: true, opacity: 0.22 })}
        </mesh>
        <mesh position={[0, 0.114, 0]}>
          <cylinderGeometry args={[0.038, 0.038, 0.014, 14]} />
          {mat('#d9b36c', 0.3, { metalness: 0.75 })}
        </mesh>
        <mesh position={[0.008, 0.042, 0.006]}>
          <sphereGeometry args={[0.017, 8, 8]} />
          {mat('#ffffff', 0.9)}
        </mesh>
        <mesh position={[-0.01, 0.05, -0.005]}>
          <sphereGeometry args={[0.014, 8, 8]} />
          {mat('#f5efe6', 0.9)}
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 13. 浴帘 ----------------

export function BathCurtain3D({ open }: CozyProps) {
  const brass = '#d9b36c';
  const curtain = useRef<THREE.Group>(null);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const t = state.clock.elapsedTime;
    if (curtain.current) {
      // open=true：收拢到一侧堆褶；false：展开遮满
      curtain.current.position.x = THREE.MathUtils.damp(curtain.current.position.x, open ? 0.7 : 0, 5, d);
      curtain.current.scale.x = THREE.MathUtils.damp(curtain.current.scale.x, open ? 0.25 : 1, 5, d);
      curtain.current.rotation.z = Math.sin(t * 0.8) * 0.008;
    }
  });

  return (
    <group>
      {/* 黄铜杆（h2.0，宽 2.0）+ 端头 */}
      <mesh position={[0, 2.0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 2.1, 12]} />
        {mat(brass, 0.3, { metalness: 0.75 })}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[1.05 * s, 2.0, 0]}>
          <sphereGeometry args={[0.024, 10, 8]} />
          {mat(brass, 0.3, { metalness: 0.75 })}
        </mesh>
      ))}
      {/* 挂环 ×8 */}
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position={[-0.7 + i * 0.2, 1.995, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.02, 0.005, 8, 14]} />
          {mat(brass, 0.3, { metalness: 0.75 })}
        </mesh>
      ))}
      {/* 半透明白纱帘（顶端为支点，随 open 收拢/展开） */}
      <group ref={curtain} position={[0, 1.965, 0]}>
        <mesh position={[0, -0.97, 0]}>
          <planeGeometry args={[1.5, 1.94]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.45} roughness={0.85} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 14. 洗漱套装 ----------------

export function Toiletries3D({ col }: CozyProps) {
  const cup = col ?? '#f2c7cf';
  return (
    <group>
      {/* 漱口杯 */}
      <group position={[-0.06, 0, 0.04]}>
        <mesh position={[0, 0.05, 0]} castShadow>
          <cylinderGeometry args={[0.038, 0.034, 0.1, 14]} />
          {mat(cup, 0.6)}
        </mesh>
        <mesh position={[0, 0.096, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.004, 12]} />
          {mat(shade(cup, 0.85), 0.6)}
        </mesh>
        {/* 牙刷 ×2（斜插：细柄 + 彩色刷头） */}
        {([[-0.012, '#9fd8cf', 0.3], [0.013, '#f7c66b', -0.35]] as [number, string, number][]).map((b, i) => (
          <group key={i} position={[b[0], 0.088, 0]} rotation={[0.25, 0, b[2]]}>
            <mesh position={[0, 0.05, 0]}>
              <cylinderGeometry args={[0.0055, 0.0055, 0.13, 8]} />
              {mat('#fdfaf4', 0.5)}
            </mesh>
            <mesh position={[0, 0.122, 0.002]}>
              <boxGeometry args={[0.012, 0.032, 0.008]} />
              {mat(b[1], 0.6)}
            </mesh>
          </group>
        ))}
      </group>
      {/* 皂碟 + 椭圆皂 */}
      <group position={[0.095, 0, 0.045]}>
        <mesh position={[0, 0.007, 0]}>
          <cylinderGeometry args={[0.05, 0.045, 0.014, 16]} />
          {mat('#fdfaf4', 0.5)}
        </mesh>
        <mesh position={[0, 0.024, 0]} scale={[1.3, 0.5, 0.9]}>
          <sphereGeometry args={[0.026, 12, 10]} />
          {mat('#f2a9bc', 0.55)}
        </mesh>
      </group>
      {/* 按压瓶 ×2（一白一琥珀） */}
      {([
        [0.03, -0.05, '#fdfaf4', '#e8e2d8'],
        [-0.035, -0.058, '#c1784a', '#a5613a'],
      ] as [number, number, string, string][]).map((b, i) => (
        <group key={i} position={[b[0], 0, b[1]]}>
          <mesh position={[0, 0.09, 0]} castShadow={i === 0}>
            <cylinderGeometry args={[0.024, 0.026, 0.18, 12]} />
            {mat(b[2], 0.35)}
          </mesh>
          <mesh position={[0, 0.195, 0]}>
            <cylinderGeometry args={[0.01, 0.01, 0.03, 8]} />
            {mat(b[3], 0.4)}
          </mesh>
          <mesh position={[0.009, 0.214, 0]}>
            <boxGeometry args={[0.032, 0.013, 0.013]} />
            {mat(b[3], 0.4)}
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------- 15. 体重秤 ----------------

export function Scale3D({ col }: CozyProps) {
  const shell = col ?? '#eef1f4';
  return (
    <group>
      {/* 圆角扁盒秤体（玻璃感） */}
      <mesh position={[0, 0.0225, 0]} castShadow>
        <boxGeometry args={[0.34, 0.045, 0.34]} />
        {mat(shell, 0.15, { metalness: 0.05 })}
      </mesh>
      {/* 顶部玻璃面板 */}
      <mesh position={[0, 0.047, 0]}>
        <boxGeometry args={[0.32, 0.006, 0.32]} />
        {mat('#f4f7f9', 0.05, { transparent: true, opacity: 0.35 })}
      </mesh>
      {/* 显示窗（深色小盒）+ 淡绿数字条 */}
      <mesh position={[0, 0.047, -0.08]}>
        <boxGeometry args={[0.12, 0.012, 0.05]} />
        {mat('#3a3f46', 0.4)}
      </mesh>
      <mesh position={[0, 0.052, -0.08]}>
        <boxGeometry args={[0.1, 0.004, 0.03]} />
        {mat('#d7efe0', 0.3, { emissive: '#b8e6c9', emissiveIntensity: 0.5 })}
      </mesh>
      {/* 防滑脚 ×4 */}
      {[[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]].map((p, i) => (
        <mesh key={i} position={[p[0], 0.006, p[1]]}>
          <cylinderGeometry args={[0.018, 0.018, 0.012, 10]} />
          {mat('#4a4a50', 0.8)}
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 注册表（接线方按 kind 取用） ----------------

export const COZY_PARTS: Record<string, (p: CozyProps) => ReactElement> = {
  curtain: Curtain3D,
  fireplace: Fireplace3D,
  fishtank: Fishtank3D,
  beanbag: Beanbag3D,
  piano: Piano3D,
  guitar: Guitar3D,
  standingMirror: StandingMirror3D,
  starLamp: StarProjector3D,
  canopy: Canopy3D,
  coffeeMaker: CoffeeMaker3D,
  fruitBasket: FruitBowl3D,
  wallShelf: WallShelf3D,
  bathCurtain: BathCurtain3D,
  toiletries: Toiletries3D,
  scale: Scale3D,
};
