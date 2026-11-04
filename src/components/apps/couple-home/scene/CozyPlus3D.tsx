'use client';

/* eslint-disable react-hooks/immutability -- R3F/家具动画需要每帧原地修改 three 对象（幕布/雾气/气泡） */

/**
 * 情侣小家 3D —— 拾光扩展家具「CozyPlus 系列」（程序化模型，无 GLB，v5.7 用户选择清单）
 *
 * - Projector3D 迷你投影仪（开关 → 镜头亮起 + 蓝白光锥）/ Screen3D 高清幕布（挂墙，投影仪开着自动放下放电影）；
 * - SwingChair3D 吊篮秋千椅（永久轻摆 + 藤编吊篮）/ ShoeCabinet3D 玄关鞋柜（双开门 + 拖鞋 + 绿植）；
 * - WallArt3D 装饰挂画组（三联抽象画，程序化油画纹理）/ Humidifier3D 香薰加湿器（雾气袅袅 + 呼吸柔光）；
 * - WineCabinet3D 玻璃酒柜（开门见酒瓶酒杯 + 暖灯）/ ChessTable3D 棋盘桌（五子棋盘 + 棋子 + 双凳）；
 * - HotpotTable3D 火锅桌（开火红汤翻滚冒泡 + 蒸汽）；
 * - GameConsole3D 游戏主机（开机灯带 + 手柄）/ FlowerStand3D 开花花架（三层花架 + 花瓣微落）。
 *
 * v5.9 新增 20 件：圣诞树/礼物堆/红灯笼/春联/南瓜灯（节日）、吊床/BBQ/户外躺椅/花箱（阳台）、
 * 挂钟/世界地图/纪念照片墙（挂墙）、龟背竹/仙人掌/水培瓶（绿植）、大号泰迪熊/抱枕堆/豆袋毯（毛绒）、
 * 下午茶具/蛋糕架（茶角）。
 *
 * v6.1 新增 2 件：娃娃机 ClawMachine3D（G10 抓娃娃，lastClaw 30s 内顶灯珠庆祝闪烁）/
 * 软木留言板 NoteBoard3D（G8 挂墙便签，板面居中朝 +z，同 WorldMap3D 挂墙约定）。
 *
 * 约定：原点 = 底部中心贴地 y=0（Screen3D/WallArt3D 挂墙件 = 挂点、背面贴墙朝 +z 伸向屋内）；
 * 配色全屋暖奶油系；动画一律 useFrame + THREE.MathUtils.damp / sin；
 * 尺寸单位 = 米（世界坐标，MODEL_SCALE 由接线方处理——本系列直接按世界尺寸建模）。
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/** 共享 props：接线方按家具类型透传 */
export interface CozyPlusProps {
  col?: string;      // 用户调色主色
  on?: boolean;      // 开关状态（projector/humidifier/gameConsole/vinyl 唱片旋转/lantern/pumpkin/bbq）
  open?: boolean;    // 门开合（shoeCabinet/wineCabinet）/ 幕布放下（screen 跟随投影仪）
  projectorOn?: boolean; // 任一投影仪开着（screen 用）
  sat?: boolean;     // 有人坐在吊篮上（摆幅加大）
  touch?: number;    // playful 上次互动时间戳（musicBox 开盖放旋律）
  photo?: string;    // 纪念照片墙照片（压缩后 dataURL，photoWallLove 用；v5.9）
  lc?: string;       // 灯具自选光色 #rrggbb（E7：红灯笼等发光件的自发光/点光色，undefined = 目录默认；v5.9）
  lastClaw?: number; // 娃娃机上次抓中时间戳（Date.now()，30s 内顶灯珠庆祝闪烁 + 内部点光；v6.1）
}

const mat = (c: string, rough = 0.85, extra?: Partial<THREE.MeshStandardMaterialParameters>) => (
  <meshStandardMaterial color={c} roughness={rough} metalness={0} {...extra} />
);

/** 同色系加深（制造凹陷/裙边阴影感） */
const shade = (hex: string, f: number) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();

/** 白色蒸汽雾贴图（径向渐变） */
function makeSteamTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 电影画面贴图：黄昏山谷（canvas 手绘静态帧 + 缓慢横移当运镜） */
function makeMovieTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 640;
  cv.height = 360;
  const ctx = cv.getContext('2d')!;
  // 天空渐变
  const sky = ctx.createLinearGradient(0, 0, 0, 250);
  sky.addColorStop(0, '#2a3a5e');
  sky.addColorStop(0.45, '#7a5a8e');
  sky.addColorStop(0.8, '#e8927c');
  sky.addColorStop(1, '#f7c48e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 640, 250);
  // 星星
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 640;
    const y = Math.random() * 110;
    const r = Math.random() * 1.6 + 0.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 太阳
  const sun = ctx.createRadialGradient(430, 208, 6, 430, 208, 52);
  sun.addColorStop(0, '#fff3d6');
  sun.addColorStop(0.4, '#ffd98f');
  sun.addColorStop(1, 'rgba(255,217,143,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(360, 140, 140, 120);
  // 远山两层
  ctx.fillStyle = '#5a4a72';
  ctx.beginPath();
  ctx.moveTo(0, 250);
  for (let x = 0; x <= 640; x += 32) ctx.lineTo(x, 190 + Math.sin(x * 0.017) * 34 + Math.cos(x * 0.041) * 14);
  ctx.lineTo(640, 250);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3a324e';
  ctx.beginPath();
  ctx.moveTo(0, 260);
  for (let x = 0; x <= 640; x += 28) ctx.lineTo(x, 226 + Math.sin(x * 0.023 + 2) * 24 + Math.cos(x * 0.055) * 9);
  ctx.lineTo(640, 260);
  ctx.closePath();
  ctx.fill();
  // 近景草地
  ctx.fillStyle = '#2c3040';
  ctx.fillRect(0, 250, 640, 110);
  // 云
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  for (const [cx, cy, cw] of [[120, 90, 130], [360, 60, 170], [560, 110, 110]] as const) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw / 2, 16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** 抽象油画贴图（三联画共用生成器：seed 决定构图） */
function makeArtTexture(seed: number): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  // 米白底
  ctx.fillStyle = '#f7f2e8';
  ctx.fillRect(0, 0, S, S);
  // 大色块弧形（粉/黄/绿/紫按 seed 轮换）
  const palette = [
    ['#f2b3c2', '#f9e6a6', '#c9e3cf'],
    ['#f6cdd6', '#dcd2ec', '#b8d9c9'],
    ['#f4d0a0', '#c5d6e8', '#eec9d8'],
  ][seed % 3];
  const rnd = (n: number) => {
    const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = palette[i % palette.length];
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(rnd(i) * S, rnd(i + 9) * S, S * (0.16 + rnd(i + 4) * 0.2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 一道弧线
  ctx.strokeStyle = '#3a3a3e';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(S * 0.5, S * 0.62, S * 0.3, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 手绘风世界地图贴图（淡蓝海洋 + 绿色大陆色块 + 点状岛屿，worldMap 用） */
function makeMapTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 320;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  // 海洋
  ctx.fillStyle = '#cfe4ea';
  ctx.fillRect(0, 0, W, H);
  // 一块大陆：中心 + 种子扰动的多边形 blob
  const land = (cx: number, cy: number, s: number, seed: number) => {
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 10) {
      const r = s * (0.6 + 0.4 * Math.abs(Math.sin(seed * 13.7 + a * 2.3) * Math.cos(seed * 7.3 + a * 1.7)));
      const x = cx + Math.cos(a) * r * 1.25;
      const y = cy + Math.sin(a) * r * 0.78;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = '#9dbf8e';
  land(92, 92, 60, 1); // 北美
  land(152, 208, 38, 2); // 南美
  land(258, 82, 32, 3); // 欧洲
  land(300, 152, 66, 4); // 非洲
  land(402, 100, 60, 5); // 亚洲
  land(436, 226, 34, 6); // 大洋洲
  // 点状岛屿
  ctx.fillStyle = '#9dbf8e';
  for (const [x, y, i] of [[70, 180, 0], [212, 128, 1], [352, 232, 2], [470, 158, 3], [240, 42, 4], [132, 256, 5]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 3 + (i % 3) * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 纪念照片墙占底贴图（淡粉底 + 白色爱心剪影，无照片时显示） */
function makeLovePhotoTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#fdeef1');
  g.addColorStop(1, '#f6d7de');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // 白色大爱心剪影
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const cx = S / 2;
  const cy = S * 0.44;
  const s = 58;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.4, cy - s * 0.2, cx - s * 0.6, cy - s * 1.2, cx, cy - s * 0.4);
  ctx.bezierCurveTo(cx + s * 0.6, cy - s * 1.2, cx + s * 1.4, cy - s * 0.2, cx, cy + s * 0.9);
  ctx.fill();
  // 小爱心点缀
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const [dx, dy, r] of [[-64, -64, 9], [60, -50, 7], [52, 62, 8], [-52, 70, 6]] as const) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------- 1. 迷你投影仪 ----------------

export function Projector3D({ col, on }: CozyPlusProps) {
  const body = col ?? '#f4f1ea';
  const lens = useRef<THREE.Mesh>(null);
  const cone = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (lens.current) {
      const m = lens.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = on ? 2.2 + Math.sin(t * 7) * 0.35 : 0.08;
    }
    if (cone.current) {
      cone.current.visible = !!on;
      // 光锥微微浮动 + 尘埃感（透明度呼吸）
      cone.current.rotation.z = Math.sin(t * 0.7) * 0.012;
    }
  });
  return (
    <group>
      {/* 机身（圆角感：主体 + 顶盖） */}
      <mesh position={[0, 0.07, 0]} castShadow>
        <boxGeometry args={[0.36, 0.1, 0.28]} />
        {mat(body, 0.6)}
      </mesh>
      <mesh position={[0, 0.135, -0.01]} castShadow>
        <boxGeometry args={[0.3, 0.035, 0.22]} />
        {mat(shade(body, 0.92), 0.65)}
      </mesh>
      {/* 支脚 ×4 */}
      {[[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.1], [0.14, 0.1]].map((p, i) => (
        <mesh key={i} position={[p[0], 0.012, p[1]]}>
          <cylinderGeometry args={[0.018, 0.022, 0.024, 10]} />
          {mat('#4a4a50', 0.7)}
        </mesh>
      ))}
      {/* 镜头（面朝 +z） */}
      <mesh position={[0.06, 0.08, 0.145]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.03, 20]} />
        {mat('#2c2f36', 0.35, { metalness: 0.3 })}
      </mesh>
      <mesh ref={lens} position={[0.06, 0.08, 0.162]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.006, 20]} />
        <meshStandardMaterial color="#dceaff" emissive="#bcd6ff" emissiveIntensity={0.1} />
      </mesh>
      {/* 散热格栅 */}
      {[-0.03, 0.01, 0.05].map((x, i) => (
        <mesh key={i} position={[x, 0.09, -0.142]}>
          <boxGeometry args={[0.012, 0.05, 0.004]} />
          {mat('#c9c4b8', 0.7)}
        </mesh>
      ))}
      {/* 光锥（开机时投向前方）；⚑ raycast 禁用：透明锥体不拦截后方家具的点击 */}
      <group ref={cone} position={[0.06, 0.08, 0.17]} visible={false}>
        <mesh
          position={[0, 0, 1.1]}
          rotation={[Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <coneGeometry args={[0.72, 2.2, 24, 1, true]} />
          <meshBasicMaterial
            color="#cfe0ff"
            transparent
            opacity={0.09}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 2. 高清幕布（挂墙：投影仪开着自动放下放电影） ----------------

export function Screen3D({ col, projectorOn }: CozyPlusProps) {
  const casing = col ?? '#eae6dc';
  const drop = useRef<THREE.Group>(null);
  const movieTex = useMemo(() => makeMovieTexture(), []);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => {
    if (!drop.current) return;
    // 幕布放下/收起（y 缩放 0.04 ↔ 1）
    const target = projectorOn ? 1 : 0.04;
    const cur = drop.current.scale.y;
    const next = THREE.MathUtils.damp(cur, target, 4.2, dt);
    drop.current.scale.y = next;
    drop.current.position.y = -1.3 * (1 - next);
    drop.current.visible = next > 0.06;
    // 运镜：电影画面缓慢横移
    movieTex.offset.x = (movieTex.offset.x + dt * 0.008) % 1;
    if (matRef.current) {
      matRef.current.emissiveIntensity = projectorOn ? 0.62 : 0;
    }
  });
  return (
    <group>
      {/* 卷轴外壳（挂墙横杆） */}
      <mesh position={[0, 0.02, 0.06]} castShadow>
        <boxGeometry args={[2.3, 0.1, 0.12]} />
        {mat(casing, 0.7)}
      </mesh>
      <mesh position={[0, 0.02, 0.125]}>
        <boxGeometry args={[2.34, 0.04, 0.01]} />
        {mat(shade(casing, 0.88), 0.7)}
      </mesh>
      {/* 幕布（从卷轴向下展开；本地组 y=0 在卷轴下沿） */}
      <group ref={drop} position={[0, -1.3, 0]} scale={[1, 0.04, 1]}>
        {/* 幕布白底（只垫在画面正后方：2.02×1.14 画面 + 上下 0.19 黑边，四周留 3cm 净边） */}
        <mesh position={[0, 1.3, 0.045]} castShadow>
          <boxGeometry args={[2.08, 1.58, 0.02]} />
          {mat('#fbfaf6', 0.9)}
        </mesh>
        {/* 电影画面（宽银幕 + 上下黑边） */}
        <mesh position={[0, 1.3, 0.058]}>
          <planeGeometry args={[2.02, 1.14]} />
          <meshStandardMaterial ref={matRef} map={movieTex} emissive="#ffffff" emissiveMap={movieTex} emissiveIntensity={0} toneMapped={false} />
        </mesh>
        {/* 黑边（2.35:1 电影感） */}
        <mesh position={[0, 1.3 + 0.66, 0.059]}>
          <planeGeometry args={[2.02, 0.19]} />
          <meshBasicMaterial color="#101014" toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.3 - 0.66, 0.059]}>
          <planeGeometry args={[2.02, 0.19]} />
          <meshBasicMaterial color="#101014" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 3. 吊篮秋千椅 ----------------

export function SwingChair3D({ col, sat }: CozyPlusProps) {
  const rattan = col ?? '#e2cba8';
  const basket = useRef<THREE.Group>(null);
  useFrame((state, dt) => {
    if (!basket.current) return;
    const t = state.clock.elapsedTime;
    // 坐上去摆幅略加大（阻尼过渡），平时轻晃；小人坐姿不跟摆，幅度收敛防穿插
    const amp = THREE.MathUtils.damp(basket.current.userData.amp ?? 0.028, sat ? 0.05 : 0.028, 2.2, dt);
    basket.current.userData.amp = amp;
    basket.current.rotation.x = Math.sin(t * 1.35) * amp;
  });
  return (
    <group>
      {/* C 形吊架 */}
      <mesh position={[-0.5, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 1.9, 12]} />
        {mat('#d9cbb2', 0.7)}
      </mesh>
      <mesh position={[-0.24, 1.9, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.56, 12]} />
        {mat('#d9cbb2', 0.7)}
      </mesh>
      <mesh position={[-0.5, 0.03, 0]}>
        <cylinderGeometry args={[0.3, 0.34, 0.06, 18]} />
        {mat('#d9cbb2', 0.75)}
      </mesh>
      {/* 吊篮（挂点 = 横梁右端，绳 + 篮体一起摆） */}
      <group ref={basket} position={[0.02, 1.88, 0]}>
        {/* 吊绳 ×3 */}
        {[-0.26, 0.26].map((x, i) => (
          <mesh key={i} position={[x, -0.42, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.84, 8]} />
            {mat('#b09a7a', 0.8)}
          </mesh>
        ))}
        <mesh position={[0, -0.42, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.011, 0.011, 0.48, 8]} />
          {mat('#b09a7a', 0.8)}
        </mesh>
        <mesh position={[0, -0.42, -0.24]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.011, 0.011, 0.48, 8]} />
          {mat('#b09a7a', 0.8)}
        </mesh>
        {/* 藤编吊篮：圆筒 + 内凹坐垫 + 靠背 */}
        <mesh position={[0, -1.06, 0]} castShadow>
          <cylinderGeometry args={[0.4, 0.34, 0.5, 20, 1, true]} />
          <meshStandardMaterial color={rattan} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -0.83, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.4, 0.03, 10, 24]} />
          {mat(shade(rattan, 0.85), 0.85)}
        </mesh>
        {/* 坐垫 */}
        <mesh position={[0, -0.92, 0.02]}>
          <cylinderGeometry args={[0.34, 0.3, 0.09, 20]} />
          {mat('#f6e8e2', 0.95)}
        </mesh>
        {/* 靠背垫（贴后侧） */}
        <mesh position={[0, -0.72, -0.3]} rotation={[-0.28, 0, 0]} castShadow>
          <boxGeometry args={[0.6, 0.5, 0.08]} />
          {mat('#f6e8e2', 0.95)}
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 4. 玄关鞋柜 ----------------

export function ShoeCabinet3D({ col, open }: CozyPlusProps) {
  const body = col ?? '#efe9dd';
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const t = open ? -1.9 : 0;
    if (left.current) left.current.rotation.y = THREE.MathUtils.damp(left.current.rotation.y, t, 6, dt);
    if (right.current) right.current.rotation.y = THREE.MathUtils.damp(right.current.rotation.y, -t, 6, dt);
  });
  return (
    <group>
      {/* 柜体 */}
      <mesh position={[0, 0.62, 0.18]} castShadow receiveShadow>
        <boxGeometry args={[1.0, 1.1, 0.38]} />
        {mat(body, 0.8)}
      </mesh>
      <mesh position={[0, 1.185, 0.18]}>
        <boxGeometry args={[1.04, 0.04, 0.42]} />
        {mat(shade(body, 0.9), 0.75)}
      </mesh>
      {/* 双门（左右对开） */}
      <group ref={left} position={[-0.5, 0.62, 0.37]}>
        <mesh position={[0.24, 0, 0.01]} castShadow>
          <boxGeometry args={[0.47, 1.02, 0.025]} />
          {mat('#f6f1e7', 0.7)}
        </mesh>
        <mesh position={[0.44, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.014, 0.014, 0.1, 8]} />
          {mat('#c9a86c', 0.4, { metalness: 0.5 })}
        </mesh>
      </group>
      <group ref={right} position={[0.5, 0.62, 0.37]}>
        <mesh position={[-0.24, 0, 0.01]} castShadow>
          <boxGeometry args={[0.47, 1.02, 0.025]} />
          {mat('#f6f1e7', 0.7)}
        </mesh>
        <mesh position={[-0.44, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.014, 0.014, 0.1, 8]} />
          {mat('#c9a86c', 0.4, { metalness: 0.5 })}
        </mesh>
      </group>
      {/* 柜底拖鞋 ×2 */}
      <mesh position={[-0.24, 0.035, 0.3]} rotation={[0, 0.3, 0]}>
        <boxGeometry args={[0.1, 0.045, 0.24]} />
        {mat('#f2c1cd', 0.95)}
      </mesh>
      <mesh position={[-0.06, 0.035, 0.34]} rotation={[0, -0.2, 0]}>
        <boxGeometry args={[0.1, 0.045, 0.24]} />
        {mat('#f2c1cd', 0.95)}
      </mesh>
      {/* 柜顶小盆栽 + 钥匙盘 */}
      <mesh position={[0.32, 1.24, 0.16]}>
        <cylinderGeometry args={[0.06, 0.05, 0.08, 12]} />
        {mat('#d9a8a0', 0.8)}
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0.32 + (i - 1) * 0.03, 1.33, 0.16 + (i - 1) * 0.02]} rotation={[0.2 * (i - 1), 0, 0.15 * (i - 1)]}>
          <sphereGeometry args={[0.045, 8, 8]} />
          {mat('#8fbf9a', 0.9)}
        </mesh>
      ))}
      <mesh position={[-0.3, 1.21, 0.16]}>
        <cylinderGeometry args={[0.09, 0.08, 0.02, 16]} />
        {mat('#c9a86c', 0.5, { metalness: 0.4 })}
      </mesh>
    </group>
  );
}

// ---------------- 5. 装饰挂画组（三联，挂墙） ----------------

export function WallArt3D({ col }: CozyPlusProps) {
  const frame = col ?? '#e8e2d4';
  const texs = useMemo(() => [makeArtTexture(1), makeArtTexture(2), makeArtTexture(3)], []);
  return (
    <group>
      {/* 中幅（大） */}
      <mesh position={[0, 0.36, 0.02]} castShadow>
        <boxGeometry args={[0.62, 0.62, 0.03]} />
        {mat(frame, 0.75)}
      </mesh>
      <mesh position={[0, 0.36, 0.038]}>
        <planeGeometry args={[0.54, 0.54]} />
        <meshStandardMaterial map={texs[1]} roughness={0.7} />
      </mesh>
      {/* 左幅（小，略高） */}
      <mesh position={[-0.47, 0.4, 0.02]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.03]} />
        {mat(frame, 0.75)}
      </mesh>
      <mesh position={[-0.47, 0.4, 0.038]}>
        <planeGeometry args={[0.23, 0.33]} />
        <meshStandardMaterial map={texs[0]} roughness={0.7} />
      </mesh>
      {/* 右幅（小，略低） */}
      <mesh position={[0.47, 0.32, 0.02]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.03]} />
        {mat(frame, 0.75)}
      </mesh>
      <mesh position={[0.47, 0.32, 0.038]}>
        <planeGeometry args={[0.23, 0.33]} />
        <meshStandardMaterial map={texs[2]} roughness={0.7} />
      </mesh>
      {/* 底部细影线 */}
      <mesh position={[0, 0.015, 0.02]}>
        <boxGeometry args={[1.5, 0.03, 0.01]} />
        {mat(shade(frame, 0.85), 0.8)}
      </mesh>
    </group>
  );
}

// ---------------- 6. 香薰加湿器 ----------------

export function Humidifier3D({ col, on }: CozyPlusProps) {
  const body = col ?? '#e6efe9';
  const steamTex = useMemo(() => makeSteamTexture(), []);
  const puffs = useRef<(THREE.Sprite | null)[]>([]);
  const ring = useRef<THREE.Mesh>(null);
  const seeds = useMemo(() => [0, 0.33, 0.66, 0.5], []);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    puffs.current.forEach((sp, i) => {
      if (!sp) return;
      sp.visible = !!on;
      if (!on) return;
      const s = seeds[i];
      const life = ((t * 0.5 + s) % 1);
      sp.position.set(Math.sin((t + s * 9) * 1.1) * 0.03, 0.3 + life * 0.55, Math.cos((t + s * 7) * 0.9) * 0.03);
      sp.scale.setScalar(0.1 + life * 0.3);
      (sp.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.55 * (1 - life));
    });
    if (ring.current) {
      const m = ring.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = on ? 0.9 + Math.sin(t * 2.4) * 0.4 : 0.06;
    }
  });
  return (
    <group>
      {/* 花瓶机身 */}
      <mesh position={[0, 0.14, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.13, 0.28, 20]} />
        {mat(body, 0.7)}
      </mesh>
      <mesh position={[0, 0.3, 0]} castShadow>
        <sphereGeometry args={[0.1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        {mat(shade(body, 0.94), 0.65)}
      </mesh>
      {/* 出雾口 */}
      <mesh position={[0, 0.36, 0.04]} rotation={[0.35, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.04, 0.05, 12]} />
        {mat('#f7f5ef', 0.6)}
      </mesh>
      {/* 呼吸灯环 */}
      <mesh ref={ring} position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.118, 0.008, 8, 32]} />
        <meshStandardMaterial color="#b8e6d9" emissive="#8fd9c4" emissiveIntensity={0.06} />
      </mesh>
      {/* 雾（sprite 升腾） */}
      {seeds.map((s, i) => (
        <sprite
          key={i}
          ref={(el) => {
            puffs.current[i] = el;
          }}
          position={[0, 0.4, 0]}
          visible={false}
        >
          <spriteMaterial map={steamTex} transparent opacity={0.5} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

// ---------------- 7. 玻璃酒柜 ----------------

export function WineCabinet3D({ col, open }: CozyPlusProps) {
  const body = col ?? '#efe9dd';
  const door = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (door.current) door.current.rotation.y = THREE.MathUtils.damp(door.current.rotation.y, open ? -1.9 : 0, 6, dt);
    if (glow.current) {
      (glow.current.material as THREE.MeshStandardMaterial).emissiveIntensity = THREE.MathUtils.damp(
        (glow.current.material as THREE.MeshStandardMaterial).emissiveIntensity,
        open ? 1.1 : 0.15,
        4,
        dt,
      );
    }
  });
  const bottles: [number, number, string][] = [
    [-0.28, 1.22, '#7a4a3a'],
    [-0.12, 1.22, '#3a5a4a'],
    [0.06, 1.22, '#8a5a4a'],
    [0.24, 1.22, '#5a3a5a'],
    [-0.2, 0.78, '#4a4a6a'],
    [0.0, 0.78, '#7a5a3a'],
    [0.2, 0.78, '#3a5a5a'],
  ];
  return (
    <group>
      {/* 柜体（左侧实板 + 右侧玻璃展示区） */}
      <mesh position={[0, 0.81, 0.2]} castShadow receiveShadow>
        <boxGeometry args={[0.92, 1.62, 0.44]} />
        {mat(body, 0.8)}
      </mesh>
      {/* 展示区开口（内嵌深色背板 + 暖灯） */}
      <mesh position={[0.1, 0.95, 0.2]}>
        <boxGeometry args={[0.62, 1.1, 0.4]} />
        {mat('#2e2a2e', 0.9)}
      </mesh>
      <mesh ref={glow} position={[0.1, 1.48, 0.32]}>
        <boxGeometry args={[0.5, 0.02, 0.02]} />
        <meshStandardMaterial color="#ffd9a0" emissive="#ffca7a" emissiveIntensity={0.15} />
      </mesh>
      {/* 层板 ×2 */}
      {[0.98, 0.52].map((y, i) => (
        <mesh key={i} position={[0.1, y, 0.2]}>
          <boxGeometry args={[0.62, 0.025, 0.4]} />
          {mat(shade(body, 0.88), 0.75)}
        </mesh>
      ))}
      {/* 酒瓶（躺在层板 + 站立） */}
      {bottles.map(([x, y, c], i) => (
        <group key={i} position={[x + 0.08, y + 0.09, 0.2]} rotation={[0, 0, Math.PI / 2 - (i % 2) * 0.06]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.038, 0.038, 0.17, 10]} />
            <meshStandardMaterial color={c} roughness={0.25} metalness={0.1} />
          </mesh>
          <mesh position={[0, 0.115, 0]}>
            <cylinderGeometry args={[0.012, 0.02, 0.08, 8]} />
            <meshStandardMaterial color={c} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {/* 倒挂酒杯（顶层板下） */}
      {[-0.12, 0.04, 0.2].map((x, i) => (
        <group key={i} position={[x + 0.08, 0.92, 0.2]}>
          <mesh position={[0, -0.03, 0]}>
            <cylinderGeometry args={[0.028, 0.02, 0.05, 10, 1, true]} />
            <meshStandardMaterial color="#e8f2f5" roughness={0.1} transparent opacity={0.55} />
          </mesh>
          <mesh position={[0, -0.07, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 0.04, 6]} />
            <meshStandardMaterial color="#e8f2f5" roughness={0.2} transparent opacity={0.6} />
          </mesh>
        </group>
      ))}
      {/* 玻璃门（右开合） */}
      <group ref={door} position={[-0.24, 0.95, 0.42]}>
        <mesh position={[0.34, 0, 0]} castShadow>
          <boxGeometry args={[0.66, 1.12, 0.02]} />
          <meshStandardMaterial color="#dceef2" roughness={0.08} metalness={0.1} transparent opacity={0.32} />
        </mesh>
        <mesh position={[0.66, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.1, 8]} />
          {mat('#c9a86c', 0.4, { metalness: 0.5 })}
        </mesh>
      </group>
      {/* 左侧门（实板装饰） */}
      <mesh position={[-0.33, 0.95, 0.43]} castShadow>
        <boxGeometry args={[0.2, 1.12, 0.025]} />
        {mat('#f6f1e7', 0.7)}
      </mesh>
      {/* 柜脚 */}
      {[[-0.38, 0.06], [0.38, 0.06]].map((p, i) => (
        <mesh key={i} position={[p[0], 0.03, 0.2]}>
          <cylinderGeometry args={[0.025, 0.03, 0.06, 8]} />
          {mat('#c9b89a', 0.8)}
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 8. 棋盘桌（五子棋） ----------------

export function ChessTable3D({ col }: CozyPlusProps) {
  const wood = col ?? '#e8d9be';
  const boardTex = useMemo(() => {
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#f0dfb8';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#8a6a48';
    ctx.lineWidth = 2;
    const N = 14;
    const pad = 34;
    const cell = (S - pad * 2) / N;
    for (let i = 0; i <= N; i++) {
      const p = pad + i * cell;
      ctx.beginPath();
      ctx.moveTo(pad, p);
      ctx.lineTo(S - pad, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, pad);
      ctx.lineTo(p, S - pad);
      ctx.stroke();
    }
    // 五个星位
    for (const [gx, gy] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
      ctx.fillStyle = '#8a6a48';
      ctx.beginPath();
      ctx.arc(pad + gx * cell, pad + gy * cell, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
  // 一局残局棋子（固定坐标 0~1 相对棋盘）
  const stones = useMemo<[number, number, 0 | 1][]>(
    () => [
      [0.5, 0.5, 0], [0.57, 0.5, 1], [0.5, 0.57, 0], [0.57, 0.57, 1], [0.43, 0.5, 0],
      [0.64, 0.57, 1], [0.5, 0.64, 0], [0.43, 0.64, 1], [0.36, 0.57, 0], [0.64, 0.43, 1],
    ],
    [],
  );
  return (
    <group>
      {/* 方桌 */}
      <mesh position={[0, 0.68, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.95, 0.06, 0.95]} />
        {mat(wood, 0.75)}
      </mesh>
      <mesh position={[0, 0.34, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.12, 0.64, 12]} />
        {mat(shade(wood, 0.9), 0.8)}
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.3, 0.34, 0.08, 18]} />
        {mat(shade(wood, 0.85), 0.8)}
      </mesh>
      {/* 棋盘 */}
      <mesh position={[0, 0.715, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.8, 0.8]} />
        <meshStandardMaterial map={boardTex} roughness={0.65} />
      </mesh>
      {/* 棋子 */}
      {stones.map(([gx, gz, black], i) => (
        <mesh key={i} position={[-0.4 + gx * 0.8, 0.728, -0.4 + gz * 0.8]} castShadow>
          <sphereGeometry args={[0.022, 12, 10]} />
          {black
            ? <meshStandardMaterial color="#2e2e34" roughness={0.3} />
            : <meshStandardMaterial color="#f7f5ef" roughness={0.35} />}
        </mesh>
      ))}
      {/* 双凳 */}
      {[-0.78, 0.78].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 0.42, 0]} castShadow>
            <cylinderGeometry args={[0.19, 0.17, 0.07, 16]} />
            {mat('#f6ede0', 0.9)}
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.05, 0.07, 0.38, 10]} />
            {mat(shade(wood, 0.88), 0.8)}
          </mesh>
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.14, 0.16, 0.04, 14]} />
            {mat(shade(wood, 0.84), 0.85)}
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------- 9. 火锅桌 ----------------

export function HotpotTable3D({ col, on }: CozyPlusProps) {
  const wood = col ?? '#e8d9be';
  const soup = useRef<THREE.Mesh>(null);
  const bubblesRef = useRef<(THREE.Mesh | null)[]>([]);
  const steamTex = useMemo(() => makeSteamTexture(), []);
  const steams = useRef<(THREE.Sprite | null)[]>([]);
  const bubbleSeeds = useMemo(() => [0.1, 0.35, 0.55, 0.8, 0.22, 0.68], []);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    if (soup.current) {
      const m = soup.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = THREE.MathUtils.damp(m.emissiveIntensity, on ? 0.5 : 0.02, 5, dt);
      if (on) soup.current.position.y = 0.66 + Math.sin(t * 5) * 0.002;
    }
    bubblesRef.current.forEach((b, i) => {
      if (!b) return;
      b.visible = !!on;
      if (!on) return;
      const s = bubbleSeeds[i];
      const life = (t * 0.9 + s) % 1;
      b.position.set(Math.sin(s * 40) * 0.07, 0.67 + life * 0.05, Math.cos(s * 31) * 0.07);
      b.scale.setScalar(1 - life * 0.5);
    });
    steams.current.forEach((sp, i) => {
      if (!sp) return;
      sp.visible = !!on;
      if (!on) return;
      const s = bubbleSeeds[i] + 0.5;
      const life = (t * 0.42 + s) % 1;
      sp.position.set(Math.sin((t + s * 8) * 1.2) * 0.04, 0.72 + life * 0.5, Math.cos((t + s * 6) * 0.9) * 0.04);
      sp.scale.setScalar(0.14 + life * 0.3);
      (sp.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.5 * (1 - life));
    });
  });
  return (
    <group>
      {/* 桌面（木纹方桌） */}
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 0.07, 1.1]} />
        {mat(wood, 0.75)}
      </mesh>
      {/* 桌腿 ×4 */}
      {[[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]].map((p, i) => (
        <mesh key={i} position={[p[0], 0.35, p[1]]} castShadow>
          <cylinderGeometry args={[0.045, 0.05, 0.7, 10]} />
          {mat(shade(wood, 0.88), 0.8)}
        </mesh>
      ))}
      {/* 嵌入式电磁炉 + 鸳鸯锅 */}
      <mesh position={[0, 0.782, 0]}>
        <cylinderGeometry args={[0.26, 0.26, 0.03, 24]} />
        {mat('#33363c', 0.5)}
      </mesh>
      {/* 锅体 */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <cylinderGeometry args={[0.21, 0.17, 0.09, 24]} />
        <meshStandardMaterial color="#c9c2b4" roughness={0.4} metalness={0.3} />
      </mesh>
      {/* 红汤（发光沸腾） */}
      <mesh ref={soup} position={[0, 0.83, 0]}>
        <cylinderGeometry args={[0.185, 0.185, 0.015, 24]} />
        <meshStandardMaterial color="#c2482e" emissive="#e05a34" emissiveIntensity={0.02} roughness={0.35} />
      </mesh>
      {/* 中隔板（小鸳鸯格） */}
      <mesh position={[0, 0.838, 0]}>
        <boxGeometry args={[0.37, 0.012, 0.05]} />
        <meshStandardMaterial color="#c9c2b4" roughness={0.4} metalness={0.3} />
      </mesh>
      {/* 气泡 */}
      {bubbleSeeds.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            bubblesRef.current[i] = el;
          }}
          position={[0, 0.85, 0]}
          visible={false}
        >
          <sphereGeometry args={[0.014, 8, 8]} />
          <meshStandardMaterial color="#f4b8a0" roughness={0.2} transparent opacity={0.85} />
        </mesh>
      ))}
      {/* 蒸汽 */}
      {[0, 1, 2].map((i) => (
        <sprite
          key={i}
          ref={(el) => {
            steams.current[i] = el;
          }}
          position={[0, 0.9, 0]}
          visible={false}
        >
          <spriteMaterial map={steamTex} transparent opacity={0.5} depthWrite={false} />
        </sprite>
      ))}
      {/* 配菜盘 ×2 + 筷子 */}
      <mesh position={[-0.38, 0.79, -0.2]}>
        <cylinderGeometry args={[0.11, 0.1, 0.03, 18]} />
        {mat('#f7f5ef', 0.5)}
      </mesh>
      <mesh position={[-0.38, 0.81, -0.2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.02, 14]} />
        {mat('#9fbf8a', 0.8)}
      </mesh>
      <mesh position={[0.38, 0.79, 0.18]}>
        <cylinderGeometry args={[0.11, 0.1, 0.03, 18]} />
        {mat('#f7f5ef', 0.5)}
      </mesh>
      <mesh position={[0.38, 0.81, 0.18]}>
        <cylinderGeometry args={[0.07, 0.07, 0.02, 14]} />
        {mat('#e8b8a0', 0.8)}
      </mesh>
      <mesh position={[0.36, 0.785, -0.3]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[0.02, 0.015, 0.3]} />
        {mat('#c9a06a', 0.7)}
      </mesh>
      {/* 两侧餐凳 */}
      {[-0.85, 0.85].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 0.42, 0]} castShadow>
            <boxGeometry args={[0.34, 0.06, 0.34]} />
            {mat('#f6ede0', 0.9)}
          </mesh>
          {[[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]].map((p, j) => (
            <mesh key={j} position={[p[0], 0.2, p[1]]}>
              <cylinderGeometry args={[0.022, 0.026, 0.4, 8]} />
              {mat(shade(wood, 0.86), 0.8)}
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------------- 10. 游戏主机 ----------------

export function GameConsole3D({ col, on }: CozyPlusProps) {
  const body = col ?? '#2f3138';
  const led = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!led.current) return;
    const m = led.current.material as THREE.MeshStandardMaterial;
    m.emissiveIntensity = on ? 1.6 + Math.sin(state.clock.elapsedTime * 4) * 0.5 : 0.05;
  });
  return (
    <group>
      {/* 主机（横卧长方体） */}
      <mesh position={[0, 0.045, 0]} castShadow>
        <boxGeometry args={[0.42, 0.09, 0.3]} />
        {mat(body, 0.5, { metalness: 0.2 })}
      </mesh>
      <mesh position={[0, 0.092, 0]}>
        <boxGeometry args={[0.4, 0.008, 0.28]} />
        {mat('#43464e', 0.45, { metalness: 0.3 })}
      </mesh>
      {/* 呼吸灯带 */}
      <mesh ref={led} position={[0, 0.05, 0.152]}>
        <boxGeometry args={[0.34, 0.012, 0.006]} />
        <meshStandardMaterial color="#7fe0b0" emissive="#4ecf96" emissiveIntensity={0.05} />
      </mesh>
      {/* 手柄 ×2（摆在主机前） */}
      {[-0.16, 0.16].map((x, i) => (
        <group key={i} position={[x, 0.03, 0.26]} rotation={[0, i === 0 ? 0.25 : -0.25, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.11, 0.03, 0.06]} />
            {mat(i === 0 ? '#f4b3c2' : '#8fd0e0', 0.6)}
          </mesh>
          <mesh position={[0, 0.02, -0.02]}>
            <cylinderGeometry args={[0.022, 0.022, 0.014, 12]} />
            {mat('#3a3a40', 0.5)}
          </mesh>
          {[-0.03, 0.03].map((bx, j) => (
            <mesh key={j} position={[bx, 0.02, 0.02]}>
              <sphereGeometry args={[0.009, 8, 8]} />
              {mat('#f7f5ef', 0.5)}
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------------- 12. 开花花架 ----------------

export function FlowerStand3D({ col }: CozyPlusProps) {
  const wood = col ?? '#d9c7ae';
  const petals = useRef<(THREE.Mesh | null)[]>([]);
  const petalSeeds = useMemo(() => [0.05, 0.3, 0.5, 0.72, 0.9], []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    petals.current.forEach((p, i) => {
      if (!p) return;
      const s = petalSeeds[i];
      const life = (t * 0.32 + s) % 1;
      p.position.set(
        Math.sin(s * 33 + t * 0.6) * 0.16,
        1.06 - life * 1.0,
        Math.cos(s * 21 + t * 0.4) * 0.1,
      );
      p.rotation.set(t * 1.4 + s * 6, s * 9, t * 0.8);
      (p.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.9 * (1 - life));
    });
  });
  return (
    <group>
      {/* 三层架（两侧立柱 + 三块搁板） */}
      {[-0.3, 0.3].map((x, i) => (
        <mesh key={i} position={[x, 0.54, 0]} castShadow>
          <boxGeometry args={[0.045, 1.08, 0.3]} />
          {mat(wood, 0.75)}
        </mesh>
      ))}
      {[0.12, 0.55, 0.98].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.72, 0.035, 0.32]} />
          {mat(shade(wood, 0.94), 0.75)}
        </mesh>
      ))}
      {/* 每层花盆 + 花（粉/黄/紫） */}
      {([0, 1, 2] as const).map((tier) => {
        const y = [0.14, 0.57, 1.0][tier] + 0.02;
        const cols = ['#f2b3c2', '#f9e6a6', '#dcd2ec'];
        return (
          <group key={tier} position={[(tier - 1) * 0.16, y, 0]}>
            <mesh position={[0, 0.06, 0]} castShadow>
              <cylinderGeometry args={[0.085, 0.07, 0.12, 14]} />
              {mat('#e8b8a8', 0.85)}
            </mesh>
            {/* 花簇 */}
            {[[0, 0.17, 0], [-0.05, 0.13, 0.03], [0.05, 0.14, -0.03], [0.02, 0.2, 0.02]].map((p, j) => (
              <mesh key={j} position={[p[0], p[1], p[2]]} castShadow>
                <sphereGeometry args={[j === 0 ? 0.05 : 0.035, 10, 8]} />
                <meshStandardMaterial color={cols[tier]} roughness={0.7} />
              </mesh>
            ))}
            {/* 叶子 */}
            {[-0.07, 0.07].map((ex, j) => (
              <mesh key={j} position={[ex, 0.1, 0.02]} rotation={[0, 0, ex > 0 ? -0.7 : 0.7]}>
                <sphereGeometry args={[0.035, 8, 6]} />
                {mat('#8fbf9a', 0.9)}
              </mesh>
            ))}
          </group>
        );
      })}
      {/* 飘落花瓣（常时微落） */}
      {petalSeeds.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            petals.current[i] = el;
          }}
          position={[0, 0.8, 0]}
        >
          <planeGeometry args={[0.035, 0.025]} />
          <meshStandardMaterial color="#f6c1cd" roughness={0.6} transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 13. 黑胶唱片机（v5.8 B1） ----------------

export function Vinyl3D({ col, on }: CozyPlusProps) {
  // v5.9：奶白机身 + 金色包边（用户要求变白色）
  const shell = col ?? '#f7f5f0';
  const disc = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Group>(null);
  const notes = useRef<(THREE.Sprite | null)[]>([]);
  const noteTex = useMemo(() => {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#e8b84b';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♪', 32, 34);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    // 唱片：开机匀速旋转
    if (disc.current && on) disc.current.rotation.y += d * 2.4;
    // 唱臂：开机搭上唱片，关机抬起归位
    if (arm.current) {
      const target = on ? -0.52 : 0.45;
      arm.current.rotation.y = THREE.MathUtils.damp(arm.current.rotation.y, target, 5, d);
      arm.current.rotation.z = THREE.MathUtils.damp(arm.current.rotation.z, on ? -0.06 : 0, 5, d);
    }
    // 音符飘出（开机时）
    const t = state.clock.elapsedTime;
    notes.current.forEach((sp, i) => {
      if (!sp) return;
      const m = sp.material as THREE.SpriteMaterial;
      if (!on) {
        m.opacity = 0;
        return;
      }
      const ph = (t * 0.5 + i * 0.37) % 1;
      sp.position.set(0.18 + Math.sin(t * 1.6 + i * 2.1) * 0.07, 0.24 + ph * 0.34, -0.05 - i * 0.03);
      m.opacity = 0.9 * (1 - ph);
    });
  });
  return (
    <group>
      {/* 奶白机身（金色包边 + 圆润侧腰线） */}
      <mesh position={[0, 0.045, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.52, 0.09, 0.38]} />
        {mat(shell, 0.5)}
      </mesh>
      <mesh position={[0, 0.095, 0]} receiveShadow>
        <boxGeometry args={[0.5, 0.012, 0.36]} />
        {mat(shade(shell, 1.04), 0.45)}
      </mesh>
      {/* 金色包边腰线（四面环绕） */}
      <mesh position={[0, 0.062, 0.192]}>
        <boxGeometry args={[0.524, 0.014, 0.008]} />
        {mat('#d9b25e', 0.3, { metalness: 0.6 })}
      </mesh>
      <mesh position={[0, 0.062, -0.192]}>
        <boxGeometry args={[0.524, 0.014, 0.008]} />
        {mat('#d9b25e', 0.3, { metalness: 0.6 })}
      </mesh>
      {[-0.261, 0.261].map((x) => (
        <mesh key={x} position={[x, 0.062, 0]}>
          <boxGeometry args={[0.008, 0.014, 0.384]} />
          {mat('#d9b25e', 0.3, { metalness: 0.6 })}
        </mesh>
      ))}
      {/* 金色支脚 ×4 */}
      {[[-0.21, -0.13], [0.21, -0.13], [-0.21, 0.13], [0.21, 0.13]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.008, z]} castShadow>
          <sphereGeometry args={[0.016, 10, 8]} />
          {mat('#c9a13e', 0.35, { metalness: 0.55 })}
        </mesh>
      ))}
      {/* 唱盘 + 黑胶唱片（开机旋转） */}
      <group ref={disc} position={[-0.08, 0.105, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.135, 0.135, 0.014, 28]} />
          {mat('#3a3a3e', 0.45)}
        </mesh>
        {/* 唱片纹路（两圈细环） */}
        {[0.1, 0.075].map((r) => (
          <mesh key={r} position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[r, 0.0016, 6, 40]} />
            {mat('#5c5c60', 0.4)}
          </mesh>
        ))}
        {/* 唱片中心标签 */}
        <mesh position={[0, 0.008, 0]}>
          <cylinderGeometry args={[0.042, 0.042, 0.002, 20]} />
          {mat('#f2b3c2', 0.7)}
        </mesh>
        <mesh position={[0, 0.01, 0]}>
          <cylinderGeometry args={[0.004, 0.004, 0.02, 10]} />
          {mat('#c9c9c9', 0.3, { metalness: 0.6 })}
        </mesh>
      </group>
      {/* 唱臂（黄铜底座枢轴 + 臂杆 + 唱头，开机搭到唱片上） */}
      <group ref={arm} position={[0.17, 0.11, 0.12]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.02, 0.024, 0.035, 12]} />
          {mat('#c9a13e', 0.35, { metalness: 0.6 })}
        </mesh>
        <mesh position={[0.03, 0.02, -0.09]} rotation={[0, 0.35, 0]} castShadow>
          <cylinderGeometry args={[0.005, 0.005, 0.21, 8]} />
          {mat('#d9d9d9', 0.3, { metalness: 0.6 })}
        </mesh>
        <mesh position={[0.062, 0.014, -0.178]} rotation={[0, 0.35, 0]}>
          <boxGeometry args={[0.016, 0.014, 0.03]} />
          {mat('#3a3a3e', 0.5)}
        </mesh>
      </group>
      {/* 开机音符飘出 */}
      {[0, 1, 2].map((i) => (
        <sprite
          key={i}
          ref={(el) => {
            notes.current[i] = el;
          }}
          position={[0.18, 0.3, 0]}
          scale={[0.07, 0.07, 1]}
        >
          <spriteMaterial map={noteTex} transparent opacity={0} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

// ---------------- 14. 复古八音盒（v6.0：点击弹点歌面板选歌，盒盖/芭蕾舞者随播放开合起舞，可暂停可关） ----------------

export function MusicBox3D({ col, on }: CozyPlusProps) {
  // v5.9 奶白盒身 + 金色镶边；v6.0 随 useMusic 播放态开盖（上层 effect 同步 st.on）——
  // 暂停即合盖，彻底解决「关不了」；不再内置固定旋律，改由点歌面板搜歌驱动
  const shell = col ?? '#f7f4ee';
  const lid = useRef<THREE.Group>(null);
  const drum = useRef<THREE.Group>(null);
  const dancer = useRef<THREE.Group>(null);
  const crank = useRef<THREE.Group>(null);
  const notes = useRef<(THREE.Sprite | null)[]>([]);
  const noteTex = useMemo(() => {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#d9a13e';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♫', 32, 34);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const open = !!on;
    // 盖子绕后缘铰链翻开 ~1.9rad（播放中常开，暂停缓缓合上）
    if (lid.current) {
      lid.current.rotation.x = THREE.MathUtils.damp(lid.current.rotation.x, open ? -1.9 : 0, 6, d);
    }
    // 音筒：开盖时慢转
    if (drum.current && open) drum.current.rotation.x += d * 1.6;
    // 发条旋钮：播放中转动
    if (crank.current && open) crank.current.rotation.y += d * 2.2;
    // 芭蕾舞者：开盖起舞（自转 + 轻微踮起）
    if (dancer.current) {
      if (open) {
        dancer.current.rotation.y += d * 3.4;
        dancer.current.position.y = THREE.MathUtils.damp(dancer.current.position.y, 0.012, 4, d);
      } else {
        dancer.current.position.y = THREE.MathUtils.damp(dancer.current.position.y, 0, 4, d);
      }
    }
    // 音符飘出
    const t = state.clock.elapsedTime;
    notes.current.forEach((sp, i) => {
      if (!sp) return;
      const m = sp.material as THREE.SpriteMaterial;
      if (!open) {
        m.opacity = 0;
        return;
      }
      const ph = (t * 0.42 + i * 0.29) % 1;
      sp.position.set(Math.sin(t * 1.5 + i * 2.4) * 0.09, 0.3 + ph * 0.32, 0.05 + Math.cos(t + i) * 0.04);
      m.opacity = 0.9 * (1 - ph);
    });
  });

  return (
    <group>
      {/* 盒身（奶白 + 底部金色踢脚线 + 金色包角） */}
      <mesh position={[0, 0.07, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.24, 0.14, 0.18]} />
        {mat(shell, 0.5)}
      </mesh>
      <mesh position={[0, 0.012, 0]}>
        <boxGeometry args={[0.244, 0.016, 0.184]} />
        {mat('#d9b25e', 0.35, { metalness: 0.55 })}
      </mesh>
      {[
        [-0.115, -0.085],
        [0.115, -0.085],
        [-0.115, 0.085],
        [0.115, 0.085],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.07, z]}>
          <cylinderGeometry args={[0.007, 0.007, 0.142, 8]} />
          {mat('#d9b25e', 0.35, { metalness: 0.55 })}
        </mesh>
      ))}
      {/* 盖子（绕后缘开合；拱顶 + 金边） */}
      <group ref={lid} position={[0, 0.14, -0.09]}>
        <mesh position={[0, 0.012, 0.09]} castShadow>
          <boxGeometry args={[0.24, 0.022, 0.18]} />
          {mat(shade(shell, 1.05), 0.45)}
        </mesh>
        {/* 拱顶（半圆柱） */}
        <mesh position={[0, 0.022, 0.09]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.09, 0.24, 16, 1, false, 0, Math.PI]} />
          {mat(shade(shell, 1.08), 0.45)}
        </mesh>
        {/* 拱顶金色棱线 */}
        <mesh position={[0, 0.112, 0.09]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.088, 0.004, 8, 20, Math.PI]} />
          {mat('#d9b25e', 0.35, { metalness: 0.55 })}
        </mesh>
        {/* 盖面金色描边花环 */}
        <mesh position={[0, -0.002, 0.09]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.055, 0.064, 24]} />
          {mat('#e0bb6a', 0.35, { metalness: 0.5 })}
        </mesh>
      </group>
      {/* 侧面发条旋钮（播放中转动） */}
      <group ref={crank} position={[0.128, 0.07, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.014, 12]} />
          {mat('#c9a13e', 0.35, { metalness: 0.6 })}
        </mesh>
        <mesh position={[0.012, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.004, 0.004, 0.014, 8]} />
          {mat('#b58a2e', 0.4, { metalness: 0.5 })}
        </mesh>
      </group>
      {/* 盒内丝绒镜面（开盖可见） */}
      <mesh position={[0, 0.141, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.085, 24]} />
        {mat('#f3e6fa', 0.85)}
      </mesh>
      {/* 芭蕾舞者（开盖起舞：粉裙 + 金腰线） */}
      <group ref={dancer} position={[0, 0, 0.042]}>
        {/* 裙摆（圆锥纱裙） */}
        <mesh position={[0, 0.022, 0]} castShadow>
          <coneGeometry args={[0.026, 0.038, 14]} />
          {mat('#fbd7e2', 0.6)}
        </mesh>
        {/* 裙摆金边 */}
        <mesh position={[0, 0.005, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.0245, 0.0022, 6, 16]} />
          {mat('#e0bb6a', 0.35, { metalness: 0.5 })}
        </mesh>
        {/* 上身 */}
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.007, 0.011, 0.02, 10]} />
          {mat('#f6c9d6', 0.6)}
        </mesh>
        {/* 头 + 发髻 */}
        <mesh position={[0, 0.068, 0]}>
          <sphereGeometry args={[0.0085, 10, 8]} />
          {mat('#fce8dc', 0.6)}
        </mesh>
        <mesh position={[0, 0.076, -0.002]}>
          <sphereGeometry args={[0.0045, 8, 6]} />
          {mat('#8a5a3a', 0.7)}
        </mesh>
      </group>
      {/* 内部音筒 + 滚针（开盖可见，舞者身后） */}
      <group ref={drum} position={[0, 0.152, -0.045]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.028, 0.028, 0.11, 14]} />
          {mat('#f2e8d8', 0.4, { metalness: 0.2 })}
        </mesh>
        {[-0.038, 0, 0.038].map((x) => (
          <mesh key={x} position={[x, 0.03, 0]}>
            <sphereGeometry args={[0.0045, 6, 6]} />
            {mat('#c9a13e', 0.4, { metalness: 0.5 })}
          </mesh>
        ))}
      </group>
      {/* 音符飘出 */}
      {[0, 1, 2].map((i) => (
        <sprite
          key={i}
          ref={(el) => {
            notes.current[i] = el;
          }}
          position={[0, 0.34, 0]}
          scale={[0.07, 0.07, 1]}
        >
          <spriteMaterial map={noteTex} transparent opacity={0} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

// ---------------- 15. 圣诞树（v5.9 F1 节日限定：11~12 月） ----------------

export function XmasTree3D({ col }: CozyPlusProps) {
  // col 作为彩球主色调微调（树身恒深绿）
  const ballMain = col ?? '#e05a4e';
  const balls: [number, number, number, string][] = [
    [-0.2, 0.52, 0.1, ballMain],
    [0.17, 0.58, 0.12, '#e8b84b'],
    [0.01, 0.72, 0.13, '#f6c2cf'],
    [-0.2, 0.98, -0.1, '#e8b84b'],
    [0.18, 1.02, -0.08, ballMain],
    [-0.12, 1.22, 0.12, '#f6c2cf'],
    [0.14, 1.32, 0.06, '#e8b84b'],
    [-0.04, 0.6, -0.19, '#f6c2cf'],
    [0.2, 0.5, -0.1, ballMain],
  ];
  return (
    <group>
      {/* 树干（浅木色） */}
      <mesh position={[0, 0.09, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.07, 0.18, 10]} />
        {mat('#c9a87a', 0.85)}
      </mesh>
      {/* 深绿三层锥叠 */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <coneGeometry args={[0.5, 0.88, 12]} />
        {mat('#2f6b4a', 0.9)}
      </mesh>
      <mesh position={[0, 0.94, 0]} castShadow>
        <coneGeometry args={[0.38, 0.72, 12]} />
        {mat('#357550', 0.9)}
      </mesh>
      <mesh position={[0, 1.32, 0]} castShadow>
        <coneGeometry args={[0.27, 0.6, 12]} />
        {mat('#2f6b4a', 0.9)}
      </mesh>
      {/* 彩球散布（常亮微光，无 toggle 故忽略 on） */}
      {balls.map(([x, y, z, c], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <sphereGeometry args={[0.028, 10, 8]} />
          {mat(c, 0.4, { emissive: c, emissiveIntensity: 0.28 })}
        </mesh>
      ))}
      {/* 顶部金色星星（octahedron 拉伸 + 自发光） */}
      <mesh position={[0, 1.72, 0]} scale={[1, 1.5, 0.5]}>
        <octahedronGeometry args={[0.075, 0]} />
        {mat('#e8b84b', 0.35, { emissive: '#e8b84b', emissiveIntensity: 0.7, metalness: 0.4 })}
      </mesh>
    </group>
  );
}

// ---------------- 16. 礼物堆（v5.9 F1 节日限定：点击弹跳由接线方 playful 处理） ----------------

export function GiftPile3D({ col }: CozyPlusProps) {
  const main = col ?? '#f2b3c2';
  return (
    <group>
      {/* 大礼盒（主色）+ 红缎带十字 */}
      <group position={[-0.08, 0.15, 0.02]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.5, 0.3, 0.4]} />
          {mat(main, 0.7)}
        </mesh>
        <mesh position={[0, 0.005, 0]}>
          <boxGeometry args={[0.075, 0.31, 0.41]} />
          {mat('#e05a4e', 0.5)}
        </mesh>
        <mesh position={[0, 0.005, 0]}>
          <boxGeometry args={[0.51, 0.31, 0.075]} />
          {mat('#e05a4e', 0.5)}
        </mesh>
        {/* 蝴蝶结（双球） */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0.048 * s, 0.165, 0]} scale={[1, 0.7, 0.6]}>
            <sphereGeometry args={[0.035, 10, 8]} />
            {mat('#e05a4e', 0.5)}
          </mesh>
        ))}
      </group>
      {/* 中礼盒（绿 + 金带） */}
      <group position={[0.27, 0.13, -0.1]} rotation={[0, 0.4, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.38, 0.26, 0.32]} />
          {mat('#7fae6f', 0.7)}
        </mesh>
        <mesh position={[0, 0.004, 0]}>
          <boxGeometry args={[0.06, 0.27, 0.33]} />
          {mat('#e8b84b', 0.45)}
        </mesh>
        <mesh position={[0, 0.004, 0]}>
          <boxGeometry args={[0.39, 0.27, 0.06]} />
          {mat('#e8b84b', 0.45)}
        </mesh>
      </group>
      {/* 小礼盒（奶油 + 红带） */}
      <group position={[-0.24, 0.11, -0.2]} rotation={[0, -0.3, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.3, 0.22, 0.26]} />
          {mat('#f7ead9', 0.7)}
        </mesh>
        <mesh position={[0, 0.003, 0]}>
          <boxGeometry args={[0.055, 0.23, 0.27]} />
          {mat('#e05a4e', 0.5)}
        </mesh>
        <mesh position={[0, 0.003, 0]}>
          <boxGeometry args={[0.31, 0.23, 0.055]} />
          {mat('#e05a4e', 0.5)}
        </mesh>
      </group>
      {/* 顶上小礼盒（金 + 奶油带） */}
      <group position={[-0.05, 0.39, 0.05]} rotation={[0, 0.25, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.24, 0.18, 0.2]} />
          {mat('#e8c98f', 0.6)}
        </mesh>
        <mesh position={[0, 0.003, 0]}>
          <boxGeometry args={[0.05, 0.19, 0.21]} />
          {mat('#f7ead9', 0.5)}
        </mesh>
        <mesh position={[0, 0.003, 0]}>
          <boxGeometry args={[0.25, 0.19, 0.05]} />
          {mat('#f7ead9', 0.5)}
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 17. 红灯笼（v5.9 F1 新春：on = 内亮，lc = 自选光色 E7） ----------------

export function Lantern3D({ col, on, lc }: CozyPlusProps) {
  const body = col ?? '#e05a4e';
  const gold = '#d9b25e';
  const bodyRef = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (!bodyRef.current) return;
    // 只做自发光强度切换（内点光由目录 light 配置在接线方处理）
    const m = bodyRef.current.material as THREE.MeshStandardMaterial;
    m.emissiveIntensity = THREE.MathUtils.damp(m.emissiveIntensity, on ? 0.85 : 0.05, 5, Math.min(dt, 0.05));
  });
  return (
    <group>
      {/* 椭球红灯体 */}
      <mesh ref={bodyRef} position={[0, 0.3, 0]} scale={[1.1, 0.95, 1.1]} castShadow>
        <sphereGeometry args={[0.16, 20, 16]} />
        {mat(body, 0.6, { emissive: lc ?? '#ff9a4e', emissiveIntensity: 0.05 })}
      </mesh>
      {/* 金色横向箍线 ×2 */}
      {[0.24, 0.36].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.155, 0.004, 6, 28]} />
          {mat(gold, 0.35, { metalness: 0.5 })}
        </mesh>
      ))}
      {/* 上下金帽 */}
      <mesh position={[0, 0.455, 0]} castShadow>
        <cylinderGeometry args={[0.065, 0.075, 0.04, 14]} />
        {mat(gold, 0.35, { metalness: 0.55 })}
      </mesh>
      <mesh position={[0, 0.145, 0]}>
        <cylinderGeometry args={[0.075, 0.065, 0.04, 14]} />
        {mat(gold, 0.35, { metalness: 0.55 })}
      </mesh>
      {/* 金色提梁（半环拱，立在顶帽上） */}
      <mesh position={[0, 0.475, 0]}>
        <torusGeometry args={[0.055, 0.007, 8, 20, Math.PI]} />
        {mat(gold, 0.35, { metalness: 0.55 })}
      </mesh>
      {/* 底部金流苏 ×3 */}
      {[-0.016, 0, 0.016].map((x, i) => (
        <mesh key={i} position={[x, 0.075, i === 1 ? 0.012 : -0.006]}>
          <coneGeometry args={[0.008, 0.085, 8]} />
          {mat(gold, 0.5)}
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 18. 新春春联（v5.9 F1 挂墙：原点 = 挂点，福字居上、双联垂下） ----------------

export function SpringCouplet3D(_p: CozyPlusProps) {
  const red = '#c93a30';
  const gold = '#e0bb6a';
  return (
    <group>
      {/* 中间上方：菱形福字（金边红底 + 金色十字纹） */}
      <group position={[0, 0.06, 0.016]} rotation={[0, 0, Math.PI / 4]}>
        <mesh castShadow>
          <boxGeometry args={[0.2, 0.2, 0.026]} />
          {mat(gold, 0.4, { metalness: 0.4 })}
        </mesh>
        <mesh position={[0, 0, 0.008]}>
          <boxGeometry args={[0.178, 0.178, 0.012]} />
          {mat(red, 0.6)}
        </mesh>
        <mesh position={[0, 0, 0.016]}>
          <boxGeometry args={[0.05, 0.11, 0.006]} />
          {mat(gold, 0.4)}
        </mesh>
        <mesh position={[0, 0, 0.016]}>
          <boxGeometry args={[0.11, 0.05, 0.006]} />
          {mat(gold, 0.4)}
        </mesh>
      </group>
      {/* 左右竖联（金边红底 + 竖排金块模拟字迹） */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0.17 * s, -0.43, 0.014]}>
          <mesh castShadow>
            <boxGeometry args={[0.145, 0.63, 0.022]} />
            {mat(gold, 0.4, { metalness: 0.4 })}
          </mesh>
          <mesh position={[0, 0, 0.007]}>
            <boxGeometry args={[0.125, 0.61, 0.01]} />
            {mat(red, 0.6)}
          </mesh>
          {/* 四个金色「字」 */}
          {[-0.21, -0.07, 0.07, 0.21].map((y, i) => (
            <group key={i} position={[0, y, 0.012]}>
              <mesh>
                <boxGeometry args={[0.062, 0.062, 0.005]} />
                {mat(gold, 0.4)}
              </mesh>
              <mesh position={[0, 0, 0.004]}>
                <boxGeometry args={[0.024, 0.024, 0.004]} />
                {mat(shade(red, 0.8), 0.5)}
              </mesh>
            </group>
          ))}
          {/* 联底小金穗 */}
          <mesh position={[0, -0.36, 0.004]}>
            <coneGeometry args={[0.012, 0.05, 8]} />
            {mat(gold, 0.5)}
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------- 19. 南瓜灯（v5.9 F1 万圣节：on = 鬼脸内透橙光） ----------------

export function Pumpkin3D({ col, on }: CozyPlusProps) {
  const skin = col ?? '#e8823a';
  const face = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const target = on ? 1.35 + Math.sin(t * 3.2) * 0.3 : 0;
    face.current.forEach((m) => {
      if (!m) return;
      const mm = m.material as THREE.MeshStandardMaterial;
      mm.emissiveIntensity = THREE.MathUtils.damp(mm.emissiveIntensity, target, 6, Math.min(dt, 0.05));
    });
  });
  return (
    <group>
      {/* 瓜身（主球 + 两瓣交叉棱瓣叠出棱纹） */}
      <mesh position={[0, 0.15, 0]} scale={[0.85, 0.7, 0.85]} castShadow>
        <sphereGeometry args={[0.16, 20, 16]} />
        {mat(skin, 0.75)}
      </mesh>
      <mesh position={[0, 0.15, 0]} scale={[0.46, 0.67, 0.95]} castShadow>
        <sphereGeometry args={[0.155, 18, 14]} />
        {mat(shade(skin, 0.94), 0.75)}
      </mesh>
      <mesh position={[0, 0.15, 0]} rotation={[0, Math.PI / 2, 0]} scale={[0.46, 0.67, 0.95]} castShadow>
        <sphereGeometry args={[0.155, 18, 14]} />
        {mat(shade(skin, 0.94), 0.75)}
      </mesh>
      <mesh position={[0, 0.15, 0]} rotation={[0, Math.PI / 4, 0]} scale={[0.4, 0.64, 0.9]} castShadow>
        <sphereGeometry args={[0.15, 18, 14]} />
        {mat(shade(skin, 0.9), 0.75)}
      </mesh>
      <mesh position={[0, 0.15, 0]} rotation={[0, -Math.PI / 4, 0]} scale={[0.4, 0.64, 0.9]} castShadow>
        <sphereGeometry args={[0.15, 18, 14]} />
        {mat(shade(skin, 0.9), 0.75)}
      </mesh>
      {/* 顶部凹陷 + 绿梗 */}
      <mesh position={[0, 0.255, 0]}>
        <cylinderGeometry args={[0.032, 0.04, 0.015, 10]} />
        {mat('#5a4630', 0.9)}
      </mesh>
      <mesh position={[0.012, 0.29, 0]} rotation={[0, 0, 0.3]} castShadow>
        <cylinderGeometry args={[0.013, 0.017, 0.07, 8]} />
        {mat('#5f7d4a', 0.9)}
      </mesh>
      {/* 镂空鬼脸（黑三角眼 ×2 + 锯齿嘴 ×4，on 时透橙光） */}
      {([[-0.06, 0.185, 0.145], [0.06, 0.185, 0.145]] as const).map(([x, y, z], i) => (
        <mesh
          key={`e${i}`}
          ref={(el) => { face.current[i] = el; }}
          position={[x, y, z]}
          scale={[1, 1, 0.3]}
        >
          <coneGeometry args={[0.03, 0.05, 4]} />
          <meshStandardMaterial color="#20140f" emissive="#ff9a3d" emissiveIntensity={0} roughness={0.6} />
        </mesh>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={`m${i}`}
          ref={(el) => { face.current[2 + i] = el; }}
          position={[-0.075 + i * 0.05, i % 2 === 0 ? 0.1 : 0.085, 0.148]}
          rotation={[0, 0, i % 2 === 0 ? -0.3 : 0.3]}
        >
          <boxGeometry args={[0.052, 0.02, 0.008]} />
          <meshStandardMaterial color="#20140f" emissive="#ff9a3d" emissiveIntensity={0} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 20. 悠闲吊床（v5.9 F4：条纹布面下垂弧 + 木斜柱，sat 摆幅加大） ----------------

const HAMMOCK_SEG = 7;
const hammockY = (x: number) => 0.63 - 0.28 * Math.cos((x / 0.85) * (Math.PI / 2));

export function Hammock3D({ col, sat }: CozyPlusProps) {
  const fabric = col ?? '#e8a9a0';
  const bed = useRef<THREE.Group>(null);
  useFrame((state, dt) => {
    if (!bed.current) return;
    // 轻微摇摆（坐上去幅度加大，阻尼过渡）
    const amp = THREE.MathUtils.damp(bed.current.userData.amp ?? 0.009, sat ? 0.022 : 0.009, 2.2, dt);
    bed.current.userData.amp = amp;
    bed.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.85) * amp;
  });
  return (
    <group>
      {/* 左右单斜木柱 + 底脚 */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[0.95 * s, 0.44, 0]} rotation={[0, 0, -0.16 * s]} castShadow>
            <cylinderGeometry args={[0.032, 0.04, 0.9, 10]} />
            {mat('#d9c7ae', 0.75)}
          </mesh>
          <mesh position={[1.0 * s, 0.03, 0]}>
            <boxGeometry args={[0.3, 0.06, 0.12]} />
            {mat(shade('#d9c7ae', 0.92), 0.8)}
          </mesh>
        </group>
      ))}
      {/* 吊绳（柱顶 → 布端） */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.865 * s, 0.74, 0]} rotation={[0, 0, 0.28 * s]}>
          <cylinderGeometry args={[0.008, 0.008, 0.24, 6]} />
          {mat('#b8a288', 0.8)}
        </mesh>
      ))}
      {/* 布面（下垂弧 + 条纹分段，绕横梁高度微摆） */}
      <group ref={bed} position={[0, 0.63, 0]}>
        {Array.from({ length: HAMMOCK_SEG }, (_, i) => {
          const x = -0.85 + ((i + 0.5) * 1.7) / HAMMOCK_SEG;
          const y = hammockY(x) - 0.63;
          const slope = (hammockY(x + 0.01) - hammockY(x - 0.01)) / 0.02;
          return (
            <mesh key={i} position={[x, y, 0]} rotation={[0, 0, Math.atan(slope)]} castShadow>
              <boxGeometry args={[1.72 / HAMMOCK_SEG + 0.02, 0.02, 0.56]} />
              {mat(i % 2 === 0 ? fabric : '#f7f3ea', 0.95)}
            </mesh>
          );
        })}
        {/* 床头小枕头 */}
        <mesh position={[-0.58, 0.05, 0]} rotation={[0, 0, 0.06]} scale={[1, 0.55, 0.7]} castShadow>
          <sphereGeometry args={[0.1, 14, 10]} />
          {mat('#fdfbf6', 0.9)}
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 21. BBQ 烤架（v5.9 F4：on = 炭火红光 + 火苗抖动 + 一缕白烟） ----------------

const BBQ_FLAMES = [
  { x: -0.08, z: -0.04, r: 0.05, h: 0.18, c: '#ff9a3d' },
  { x: 0.07, z: 0.03, r: 0.042, h: 0.15, c: '#ffb35c' },
  { x: 0, z: 0.06, r: 0.038, h: 0.13, c: '#ffd166' },
];

export function Bbq3D({ on }: CozyPlusProps) {
  const flames = useRef<(THREE.Mesh | null)[]>([]);
  const embers = useRef<(THREE.Mesh | null)[]>([]);
  const smoke = useRef<THREE.Sprite>(null);
  const smokeTex = useMemo(() => makeSteamTexture(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // 火苗抖动（写法同壁炉）
    flames.current.forEach((f, i) => {
      if (!f) return;
      f.visible = !!on;
      if (on) {
        const s = 1 + Math.sin(t * 8 + i * 2.2) * 0.18;
        f.scale.set(s, 1 + Math.sin(t * 10 + i * 1.7) * 0.26, s);
        f.rotation.z = Math.sin(t * 6 + i * 2.6) * 0.14;
      }
    });
    // 炭堆余温红光
    embers.current.forEach((e, i) => {
      if (!e) return;
      const m = e.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = on ? 1.1 + Math.sin(t * 5 + i * 2.4) * 0.5 : 0.04;
    });
    // 一缕白烟循环上升
    if (smoke.current) {
      smoke.current.visible = !!on;
      if (on) {
        const life = (t * 0.32) % 1;
        smoke.current.position.set(Math.sin(t * 0.9) * 0.05, 0.78 + life * 0.42, Math.cos(t * 0.7) * 0.03);
        smoke.current.scale.setScalar(0.12 + life * 0.3);
        (smoke.current.material as THREE.SpriteMaterial).opacity = 0.4 * (1 - life);
      }
    }
  });
  return (
    <group>
      {/* 三支外撇腿 */}
      {[Math.PI / 2, Math.PI / 2 + 2.1, Math.PI / 2 + 4.2].map((a, i) => (
        <mesh
          key={i}
          position={[Math.cos(a) * 0.15, 0.2, Math.sin(a) * 0.15]}
          rotation={[Math.sin(a) * 0.16, 0, -Math.cos(a) * 0.16]}
          castShadow
        >
          <cylinderGeometry args={[0.013, 0.016, 0.42, 8]} />
          {mat('#3a3a40', 0.6, { metalness: 0.3 })}
        </mesh>
      ))}
      {/* 黑色圆盆炭炉（半椭球口 + 收底） */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.15, 0.24, 22]} />
        {mat('#26262b', 0.55, { metalness: 0.25 })}
      </mesh>
      <mesh position={[0, 0.625, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.298, 0.012, 8, 28]} />
        {mat('#3a3a40', 0.5, { metalness: 0.3 })}
      </mesh>
      {/* 炭堆 + 三粒红炭（on 时红光闪烁） */}
      <mesh position={[0, 0.565, 0]} scale={[1, 0.35, 1]}>
        <sphereGeometry args={[0.19, 14, 10]} />
        {mat('#3c3835', 0.95)}
      </mesh>
      {[[-0.08, 0.575, 0.03], [0.06, 0.585, -0.05], [0.02, 0.595, 0.07]].map(([x, y, z], i) => (
        <mesh key={i} ref={(el) => { embers.current[i] = el; }} position={[x, y, z]} scale={[1, 0.6, 1]}>
          <sphereGeometry args={[0.045, 10, 8]} />
          <meshStandardMaterial color="#8a3a22" emissive="#ff5a1e" emissiveIntensity={0.04} roughness={0.8} />
        </mesh>
      ))}
      {/* 烤网（6 根平行细杆 + 2 根横杆） */}
      {[-0.2, -0.12, -0.04, 0.04, 0.12, 0.2].map((z, i) => (
        <mesh key={i} position={[0, 0.665, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.005, 0.005, 0.5, 6]} />
          {mat('#8a8f94', 0.4, { metalness: 0.6 })}
        </mesh>
      ))}
      {[-0.16, 0.16].map((x, i) => (
        <mesh key={`c${i}`} position={[x, 0.665, 0]}>
          <cylinderGeometry args={[0.005, 0.005, 0.44, 6]} />
          {mat('#8a8f94', 0.4, { metalness: 0.6 })}
        </mesh>
      ))}
      {/* 火苗 ×3（on 时穿过烤网抖动） */}
      {BBQ_FLAMES.map((fl, i) => (
        <mesh key={i} ref={(m) => { flames.current[i] = m; }} position={[fl.x, 0.7, fl.z]} visible={false}>
          <coneGeometry args={[fl.r, fl.h, 8]} />
          {mat(fl.c, 0.5, { emissive: fl.c, emissiveIntensity: 0.9, transparent: true, opacity: 0.9, depthWrite: false })}
        </mesh>
      ))}
      {/* 白烟一缕 */}
      <sprite ref={smoke} position={[0, 0.9, 0]} visible={false}>
        <spriteMaterial map={smokeTex} transparent opacity={0} depthWrite={false} />
      </sprite>
      {/* 侧边小置物板 */}
      <mesh position={[0.44, 0.44, 0]} rotation={[0, 0, 0.03]} castShadow>
        <boxGeometry args={[0.2, 0.018, 0.26]} />
        {mat('#d9c7ae', 0.75)}
      </mesh>
      <mesh position={[0.34, 0.38, 0]} rotation={[0, 0, 0.5]}>
        <cylinderGeometry args={[0.008, 0.008, 0.16, 6]} />
        {mat('#3a3a40', 0.6)}
      </mesh>
    </group>
  );
}

// ---------------- 22. 户外躺椅（v5.9 F4：藤编框架 + 白色条纹坐垫，靠背在 -z 端） ----------------

export function LoungeOutdoor3D({ col }: CozyPlusProps) {
  const rattan = col ?? '#c9a87a';
  return (
    <group>
      {/* 四条矮腿 */}
      {[[-0.34, -0.72], [0.34, -0.72], [-0.34, 0.72], [0.34, 0.72]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.1, z]} castShadow>
          <boxGeometry args={[0.05, 0.2, 0.05]} />
          {mat(shade(rattan, 0.85), 0.8)}
        </mesh>
      ))}
      {/* 座框（两侧纵梁 + 横托条） */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.34 * s, 0.225, 0]} castShadow>
          <boxGeometry args={[0.05, 0.055, 1.5]} />
          {mat(rattan, 0.8)}
        </mesh>
      ))}
      {[-0.55, -0.15, 0.25, 0.65].map((z, i) => (
        <mesh key={i} position={[0, 0.225, z]}>
          <boxGeometry args={[0.66, 0.04, 0.05]} />
          {mat(shade(rattan, 0.92), 0.8)}
        </mesh>
      ))}
      {/* 倾斜靠背段（藤编骨架，朝 -z 抬起） */}
      <group position={[0, 0.27, -0.1]} rotation={[0.62, 0, 0]}>
        <mesh position={[0, 0.02, -0.4]} castShadow>
          <boxGeometry args={[0.72, 0.05, 0.82]} />
          {mat(rattan, 0.8)}
        </mesh>
        {/* 靠背垫 */}
        <mesh position={[0, 0.06, -0.4]} castShadow>
          <boxGeometry args={[0.64, 0.06, 0.72]} />
          {mat('#f7f3ea', 0.9)}
        </mesh>
      </group>
      {/* 白色条纹坐垫布（两色段拼接） */}
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[0, 0.285, 0.12 + i * 0.15]} castShadow>
          <boxGeometry args={[0.66, 0.055, 0.148]} />
          {mat(i % 2 === 0 ? '#f7f3ea' : shade(rattan, 1.06), 0.9)}
        </mesh>
      ))}
      {/* 扶手条 ×2 */}
      {[-1, 1].map((s) => (
        <mesh key={`a${s}`} position={[0.375 * s, 0.3, 0.25]} rotation={[0, 0, 0]}>
          <boxGeometry args={[0.04, 0.03, 1.0]} />
          {mat(shade(rattan, 0.9), 0.8)}
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 23. 花箱栅栏（v5.9 F4：长条木花箱 + 一排小花 + 栅栏脚） ----------------

export function FlowerBox3D({ col }: CozyPlusProps) {
  const wood = col ?? '#b98d6a';
  const flowerCols = ['#f2b3c2', '#f9e6a6', '#dcd2ec', '#f2b3c2', '#f9e6a6', '#dcd2ec'];
  return (
    <group>
      {/* 底部短栅栏脚（3 根竖条） */}
      {[-0.6, 0, 0.6].map((x, i) => (
        <mesh key={i} position={[x, 0.09, 0]} castShadow>
          <boxGeometry args={[0.07, 0.18, 0.22]} />
          {mat(shade(wood, 0.9), 0.85)}
        </mesh>
      ))}
      {/* 长条花箱体 */}
      <mesh position={[0, 0.31, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.26, 0.26]} />
        {mat(wood, 0.85)}
      </mesh>
      {/* 箱沿压条 */}
      <mesh position={[0, 0.435, 0]}>
        <boxGeometry args={[1.74, 0.03, 0.3]} />
        {mat(shade(wood, 0.9), 0.8)}
      </mesh>
      {/* 箱内土面 */}
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[1.62, 0.02, 0.2]} />
        {mat('#4a3a2e', 0.95)}
      </mesh>
      {/* 一排花簇（绿叶 + 三色小球花） */}
      {[-0.68, -0.41, -0.14, 0.14, 0.41, 0.68].map((x, i) => (
        <group key={i} position={[x, 0.46, (i % 2 === 0 ? 1 : -1) * 0.02]}>
          <mesh scale={[1, 0.75, 1]} castShadow>
            <sphereGeometry args={[0.062, 10, 8]} />
            {mat('#7fae6f', 0.9)}
          </mesh>
          {[[-0.03, 0.05, 0.01], [0.035, 0.055, -0.015], [0, 0.075, 0.02]].map(([dx, dy, dz], j) => (
            <mesh key={j} position={[dx, dy, dz]}>
              <sphereGeometry args={[0.026, 8, 8]} />
              {mat(flowerCols[(i + j) % flowerCols.length], 0.7)}
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------------- 24. 挂钟（v5.9 F5 挂墙：时针/分针/秒针跟真实时间走） ----------------

export function WallClock3D(_p: CozyPlusProps) {
  const hourHand = useRef<THREE.Group>(null);
  const minHand = useRef<THREE.Group>(null);
  const secHand = useRef<THREE.Group>(null);
  useFrame(() => {
    // 实时时间 → 指针角度（秒针平滑扫动）
    const now = new Date();
    const h = (now.getHours() % 12) + now.getMinutes() / 60;
    const m = now.getMinutes() + now.getSeconds() / 60;
    const s = now.getSeconds() + now.getMilliseconds() / 1000;
    if (hourHand.current) hourHand.current.rotation.z = -(h / 12) * Math.PI * 2;
    if (minHand.current) minHand.current.rotation.z = -(m / 60) * Math.PI * 2;
    if (secHand.current) secHand.current.rotation.z = -(s / 60) * Math.PI * 2;
  });
  return (
    <group>
      {/* 外圈木环 */}
      <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.19, 0.018, 10, 36]} />
        {mat('#d9c7ae', 0.6)}
      </mesh>
      {/* 白色钟盘 */}
      <mesh position={[0, 0, 0.014]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.185, 0.185, 0.026, 32]} />
        {mat('#fdfbf6', 0.5)}
      </mesh>
      {/* 12 个时刻刻度 */}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        const big = i % 3 === 0;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.155, Math.cos(a) * 0.155, 0.03]} rotation={[0, 0, -a]}>
            <boxGeometry args={[big ? 0.01 : 0.006, big ? 0.03 : 0.02, 0.004]} />
            {mat('#6a5a4a', 0.5)}
          </mesh>
        );
      })}
      {/* 时针 / 分针 / 秒针（组原点 = 钟心，绕 z 转） */}
      <group ref={hourHand} position={[0, 0, 0.034]}>
        <mesh position={[0, 0.038, 0]}>
          <boxGeometry args={[0.014, 0.09, 0.004]} />
          {mat('#4a3f36', 0.5)}
        </mesh>
      </group>
      <group ref={minHand} position={[0, 0, 0.038]}>
        <mesh position={[0, 0.058, 0]}>
          <boxGeometry args={[0.01, 0.13, 0.004]} />
          {mat('#4a3f36', 0.5)}
        </mesh>
      </group>
      <group ref={secHand} position={[0, 0, 0.042]}>
        <mesh position={[0, 0.05, 0]}>
          <boxGeometry args={[0.004, 0.15, 0.003]} />
          {mat('#e05a4e', 0.4)}
        </mesh>
        <mesh position={[0, -0.022, 0]}>
          <boxGeometry args={[0.008, 0.03, 0.003]} />
          {mat('#e05a4e', 0.4)}
        </mesh>
      </group>
      {/* 中心轴帽 */}
      <mesh position={[0, 0, 0.046]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.011, 0.011, 0.008, 12]} />
        {mat('#4a3f36', 0.4, { metalness: 0.3 })}
      </mesh>
      {/* 玻璃面（微透明） */}
      <mesh position={[0, 0, 0.05]} raycast={() => null}>
        <circleGeometry args={[0.178, 32]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.1} roughness={0.05} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------- 25. 世界地图（v5.9 F5 挂墙：手绘风 canvas 贴图 + 木框） ----------------

export function WorldMap3D({ col }: CozyPlusProps) {
  const frame = col ?? '#d9c7ae';
  const mapTex = useMemo(() => makeMapTexture(), []);
  return (
    <group>
      {/* 木框四边条 */}
      <mesh position={[0, 0.475, 0.017]} castShadow>
        <boxGeometry args={[1.5, 0.05, 0.034]} />
        {mat(frame, 0.7)}
      </mesh>
      <mesh position={[0, -0.475, 0.017]} castShadow>
        <boxGeometry args={[1.5, 0.05, 0.034]} />
        {mat(frame, 0.7)}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.725 * s, 0, 0.017]} castShadow>
          <boxGeometry args={[0.05, 0.95, 0.034]} />
          {mat(frame, 0.7)}
        </mesh>
      ))}
      {/* 米白底板 */}
      <mesh position={[0, 0, 0.008]}>
        <boxGeometry args={[1.44, 0.89, 0.014]} />
        {mat('#f7f2e8', 0.85)}
      </mesh>
      {/* 手绘风地图贴面 */}
      <mesh position={[0, 0, 0.018]}>
        <planeGeometry args={[1.4, 0.85]} />
        <meshStandardMaterial map={mapTex} roughness={0.75} />
      </mesh>
    </group>
  );
}

// ---------------- 26. 纪念照片墙（v5.9 F5 挂墙：心形大相框可换合照 + 拍立得 + 小红心） ----------------

export function PhotoWallLove3D({ col, photo }: CozyPlusProps) {
  const frame = col ?? '#f2c9cf';
  const placeholder = useMemo(() => makeLovePhotoTexture(), []);
  // 照片 dataURL → texture（异步加载，setState 只在 onload 回调里；换图/卸载时 dispose 旧纹理）
  const [texState, setTexState] = useState<{ photo: string; tex: THREE.Texture } | null>(null);
  const owned = useRef<THREE.Texture | null>(null);
  useEffect(() => {
    if (!photo) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.needsUpdate = true;
      owned.current?.dispose(); // 换图时释放旧纹理
      owned.current = t;
      setTexState({ photo, tex: t });
    };
    img.src = photo;
    return () => {
      alive = false;
    };
  }, [photo]);
  useEffect(() => () => { owned.current?.dispose(); }, []); // 卸载释放最后一张
  const photoTex = texState && texState.photo === photo ? texState.tex : null;

  /** 小红心（两球一锥拼装） */
  const miniHeart = (x: number, y: number, z: number, s: number, key: string) => (
    <group key={key} position={[x, y, z]} rotation={[0, 0, 0.25]}>
      <mesh position={[-0.03 * s, 0.02 * s, 0]}>
        <sphereGeometry args={[0.032 * s, 10, 8]} />
        {mat('#e05a4e', 0.6)}
      </mesh>
      <mesh position={[0.03 * s, 0.02 * s, 0]}>
        <sphereGeometry args={[0.032 * s, 10, 8]} />
        {mat('#e05a4e', 0.6)}
      </mesh>
      <mesh position={[0, -0.028 * s, 0]} rotation={[0, 0, Math.PI]}>
        <coneGeometry args={[0.04 * s, 0.055 * s, 10]} />
        {mat('#e05a4e', 0.6)}
      </mesh>
    </group>
  );

  return (
    <group>
      {/* 中央心形大相框（双圆 + 旋转方块的 3D 拼心：粉框 + 内圈白衬） */}
      <group position={[0, -0.04, 0]}>
        {/* 心形轮廓：两耳圆环 */}
        {[-0.16, 0.16].map((x, i) => (
          <mesh key={i} position={[x, 0.22, 0.012]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.155, 0.028, 10, 28]} />
            {mat(frame, 0.7)}
          </mesh>
        ))}
        {/* 心形底尖（斜置方块） */}
        <mesh position={[0, -0.02, 0.012]} rotation={[0, 0, Math.PI / 4]} castShadow>
          <boxGeometry args={[0.36, 0.36, 0.056]} />
          {mat(frame, 0.7)}
        </mesh>
        {/* 照片面（有照片显示合照，否则粉底白心剪影） */}
        <mesh position={[0, 0.1, 0.032]}>
          <circleGeometry args={[0.26, 32]} />
          <meshStandardMaterial map={photoTex ?? placeholder} roughness={0.6} />
        </mesh>
        {/* 耳圆内的补面（贴合心形轮廓） */}
        {[-0.16, 0.16].map((x, i) => (
          <mesh key={`f${i}`} position={[x, 0.22, 0.028]}>
            <circleGeometry args={[0.15, 24]} />
            <meshStandardMaterial map={photoTex ?? placeholder} roughness={0.6} />
          </mesh>
        ))}
        {/* 双耳之间的 V 形缺口（框色小楔，勾出心形凹陷） */}
        <mesh position={[0, 0.335, 0.033]} raycast={() => null}>
          <boxGeometry args={[0.055, 0.19, 0.002]} />
          {mat(frame, 0.7)}
        </mesh>
        {/* 顶部红色蝴蝶结 */}
        {[-1, 1].map((s) => (
          <mesh key={`b${s}`} position={[0.05 * s, 0.44, 0.03]} rotation={[0, s * 0.4, s * 0.3]} scale={[1, 0.7, 0.5]}>
            <sphereGeometry args={[0.055, 12, 10]} />
            {mat('#e05a4e', 0.6)}
          </mesh>
        ))}
        <mesh position={[0, 0.43, 0.035]}>
          <sphereGeometry args={[0.028, 10, 8]} />
          {mat(shade('#e05a4e', 0.85), 0.6)}
        </mesh>
      </group>
      {/* 两侧小型斜贴拍立得 */}
      {[-1, 1].map((s) => (
        <group key={`p${s}`} position={[0.5 * s, -0.16 + 0.05 * s, 0.012]} rotation={[0, 0, -0.22 * s]}>
          <mesh castShadow>
            <boxGeometry args={[0.22, 0.24, 0.018]} />
            {mat('#fdfbf6', 0.75)}
          </mesh>
          <mesh position={[0, 0.025, 0.011]}>
            <planeGeometry args={[0.18, 0.16]} />
            <meshStandardMaterial map={placeholder} roughness={0.7} />
          </mesh>
        </group>
      ))}
      {/* 散落小红心 ×3 */}
      {miniHeart(-0.52, 0.3, 0.015, 1, 'h1')}
      {miniHeart(0.55, 0.24, 0.015, 0.8, 'h2')}
      {miniHeart(0.24, -0.42, 0.015, 0.7, 'h3')}
    </group>
  );
}

// ---------------- 27. 龟背竹（v5.9 F6：陶盆 + 大叶深绿，叶面缺刻感） ----------------

export function Monstera3D({ col }: CozyPlusProps) {
  const pot = col ?? '#cf8f6a';
  const leafCfg: [number, number][] = [
    [-1.1, 0.5], [-0.55, 0.44], [0, 0.56], [0.55, 0.42], [1.1, 0.48],
  ];
  return (
    <group>
      {/* 陶土花盆 + 盆沿 + 土面 */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.1, 0.2, 18]} />
        {mat(pot, 0.9)}
      </mesh>
      <mesh position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.14, 0.012, 8, 24]} />
        {mat(shade(pot, 0.92), 0.85)}
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.125, 0.125, 0.02, 18]} />
        {mat('#4a3a2e', 0.95)}
      </mesh>
      {/* 5 片大叶（叶柄外斜 + 三瓣缺刻叶面） */}
      {leafCfg.map(([a, h], i) => (
        <group key={i} rotation={[0, a, 0]}>
          <mesh position={[0.09, h / 2 + 0.2, 0]} rotation={[0, 0, -0.42]} castShadow>
            <cylinderGeometry args={[0.009, 0.012, h, 8]} />
            {mat('#5f8f5a', 0.85)}
          </mesh>
          <group position={[0.19, h + 0.2, 0]} rotation={[0, 0, -0.35]}>
            <mesh scale={[1.15, 0.75, 0.16]} castShadow>
              <sphereGeometry args={[0.11, 14, 10]} />
              {mat('#3d7a4f', 0.8)}
            </mesh>
            <mesh position={[-0.08, -0.03, 0]} rotation={[0, 0, 0.4]} scale={[0.9, 0.5, 0.14]}>
              <sphereGeometry args={[0.07, 10, 8]} />
              {mat(shade('#3d7a4f', 0.92), 0.8)}
            </mesh>
            <mesh position={[0.08, -0.05, 0]} rotation={[0, 0, -0.35]} scale={[0.9, 0.5, 0.14]}>
              <sphereGeometry args={[0.07, 10, 8]} />
              {mat(shade('#3d7a4f', 0.92), 0.8)}
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

// ---------------- 28. 小仙人掌（v5.9 F6：陶盆 + L 形双臂 + 顶花） ----------------

export function Cactus3D({ col }: CozyPlusProps) {
  const pot = col ?? '#cf8f6a';
  const green = '#6fae7c';
  return (
    <group>
      {/* 陶盆 + 沙砾面 */}
      <mesh position={[0, 0.055, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.06, 0.11, 14]} />
        {mat(pot, 0.9)}
      </mesh>
      <mesh position={[0, 0.108, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.075, 0.008, 6, 18]} />
        {mat(shade(pot, 0.92), 0.85)}
      </mesh>
      <mesh position={[0, 0.108, 0]}>
        <cylinderGeometry args={[0.066, 0.066, 0.012, 14]} />
        {mat('#e0cfa8', 0.95)}
      </mesh>
      {/* 主柱（圆头 capsule） */}
      <mesh position={[0, 0.235, 0]} castShadow>
        <capsuleGeometry args={[0.045, 0.17, 6, 14]} />
        {mat(green, 0.9)}
      </mesh>
      {/* 左右 L 形分支臂 */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0.055 * s, s === -1 ? 0.2 : 0.24, 0]}>
          <mesh position={[0.03 * s, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <capsuleGeometry args={[0.026, 0.05, 4, 10]} />
            {mat(green, 0.9)}
          </mesh>
          <mesh position={[0.058 * s, 0.055, 0]} castShadow>
            <capsuleGeometry args={[0.026, 0.07, 4, 10]} />
            {mat(green, 0.9)}
          </mesh>
        </group>
      ))}
      {/* 小尖刺点缀 */}
      {[[-0.03, 0.26, 0.038], [0.032, 0.3, 0.03], [0, 0.2, 0.044], [-0.036, 0.33, -0.02], [0.03, 0.23, -0.038]].map(([x, y, z], i) => (
        <mesh key={`s${i}`} position={[x, y, z]}>
          <sphereGeometry args={[0.0035, 6, 6]} />
          {mat('#e8e4d0', 0.7)}
        </mesh>
      ))}
      {/* 顶部小白粉花球 */}
      {[[-0.012, 0.382, 0.004], [0.013, 0.378, -0.006], [0, 0.39, 0.012]].map(([x, y, z], i) => (
        <mesh key={`f${i}`} position={[x, y, z]}>
          <sphereGeometry args={[0.013, 8, 8]} />
          {mat(i === 1 ? '#f6c2cf' : '#fdfbf6', 0.7)}
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 29. 水培瓶（v5.9 F6：透明玻璃瓶 + 根须 + 绿叶，摆桌小物） ----------------

export function Hydro3D(_p: CozyPlusProps) {
  return (
    <group>
      {/* 透明玻璃瓶身（圆底 + 口沿） */}
      <mesh position={[0, 0.095, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.17, 18]} />
        <meshStandardMaterial color="#eaf4f2" roughness={0.1} transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.012, 0]} scale={[1, 0.45, 1]}>
        <sphereGeometry args={[0.05, 16, 12]} />
        <meshStandardMaterial color="#eaf4f2" roughness={0.1} transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.182, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.038, 0.006, 6, 18]} />
        {mat('#eaf4f2', 0.1, { transparent: true, opacity: 0.5 })}
      </mesh>
      {/* 内部水位（淡绿半透明） */}
      <mesh position={[0, 0.065, 0]}>
        <cylinderGeometry args={[0.043, 0.043, 0.09, 16]} />
        <meshStandardMaterial color="#cdeacd" roughness={0.2} transparent opacity={0.45} depthWrite={false} />
      </mesh>
      {/* 下垂根须 ×3 */}
      {[[-0.014, -0.1], [0.006, 0.02], [0.016, -0.06]].map(([x, rz], i) => (
        <mesh key={i} position={[x, 0.115, 0.004 * i]} rotation={[0, 0, rz]}>
          <cylinderGeometry args={[0.0022, 0.0012, 0.085, 5]} />
          {mat('#f4f0e6', 0.6)}
        </mesh>
      ))}
      {/* 顶部绿叶两片 */}
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.005, 0.007, 0.035, 6]} />
        {mat('#5f8f5a', 0.85)}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.02 * s, 0.225, 0]} rotation={[0, 0, -0.7 * s]} scale={[1.2, 0.55, 0.5]}>
          <sphereGeometry args={[0.032, 10, 8]} />
          {mat('#4a8a54', 0.8)}
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 30. 大号泰迪熊（v5.9 F7：坐姿张开双臂 ready-to-hug，小人可坐上腿上） ----------------

export function TeddyBig3D({ col }: CozyPlusProps) {
  const fur = col ?? '#c99a6a';
  const cream = '#fbf3e4';
  const red = '#e05a4e';
  return (
    <group>
      {/* 大圆身（坐姿） */}
      <mesh position={[0, 0.44, 0]} scale={[1, 1.08, 0.88]} castShadow>
        <sphereGeometry args={[0.34, 22, 18]} />
        {mat(fur, 0.95)}
      </mesh>
      {/* 奶油肚皮 */}
      <mesh position={[0, 0.42, 0.15]} scale={[1, 1.05, 0.55]}>
        <sphereGeometry args={[0.22, 18, 14]} />
        {mat(cream, 0.95)}
      </mesh>
      {/* 圆头 */}
      <mesh position={[0, 0.98, 0.02]} castShadow>
        <sphereGeometry args={[0.27, 22, 18]} />
        {mat(fur, 0.95)}
      </mesh>
      {/* 双耳（圆片 + 内耳） */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0.18 * s, 1.2, -0.02]}>
          <mesh castShadow>
            <sphereGeometry args={[0.085, 12, 10]} />
            {mat(fur, 0.95)}
          </mesh>
          <mesh position={[0, 0, 0.035]} scale={[1, 1, 0.55]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            {mat(cream, 0.95)}
          </mesh>
        </group>
      ))}
      {/* 吻部 + 鼻头 */}
      <mesh position={[0, 0.92, 0.24]} scale={[1.2, 0.85, 0.7]}>
        <sphereGeometry args={[0.1, 14, 10]} />
        {mat(cream, 0.95)}
      </mesh>
      <mesh position={[0, 0.955, 0.315]}>
        <sphereGeometry args={[0.026, 10, 8]} />
        {mat('#5a4638', 0.5)}
      </mesh>
      {/* 黑豆眼 */}
      {[-1, 1].map((s) => (
        <mesh key={`e${s}`} position={[0.1 * s, 1.03, 0.22]}>
          <sphereGeometry args={[0.02, 10, 8]} />
          {mat('#4a3f3a', 0.4)}
        </mesh>
      ))}
      {/* 张开的双臂（ready-to-hug 微张上扬） */}
      {[-1, 1].map((s) => (
        <mesh key={`a${s}`} position={[0.37 * s, 0.72, 0.04]} rotation={[0.1, 0, 1.05 * s]} castShadow>
          <capsuleGeometry args={[0.09, 0.28, 6, 12]} />
          {mat(fur, 0.95)}
        </mesh>
      ))}
      {/* 短腿前伸（坐姿，爪心朝上供落座） */}
      {[-1, 1].map((s) => (
        <group key={`l${s}`}>
          <mesh position={[0.16 * s, 0.16, 0.2]} rotation={[1.35, 0, 0.08 * s]} castShadow>
            <capsuleGeometry args={[0.1, 0.16, 6, 12]} />
            {mat(fur, 0.95)}
          </mesh>
          <mesh position={[0.18 * s, 0.2, 0.36]} scale={[1, 0.6, 1.1]} castShadow>
            <sphereGeometry args={[0.09, 12, 10]} />
            {mat(cream, 0.95)}
          </mesh>
        </group>
      ))}
      {/* 红色领结 + 短围巾 */}
      <mesh position={[0, 0.7, 0.22]} rotation={[0.2, 0, 0]}>
        <torusGeometry args={[0.13, 0.03, 8, 20]} />
        {mat(red, 0.8)}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`r${s}`} position={[0.05 * s, 0.71, 0.24]} rotation={[0, s * 0.5, 0]} scale={[1, 0.75, 0.5]}>
          <sphereGeometry args={[0.05, 10, 8]} />
          {mat(red, 0.7)}
        </mesh>
      ))}
      <mesh position={[0, 0.66, 0.26]}>
        <sphereGeometry args={[0.024, 8, 8]} />
        {mat(shade(red, 0.85), 0.7)}
      </mesh>
      {/* 围巾垂尾 */}
      <mesh position={[0.07, 0.56, 0.22]} rotation={[0.25, 0, 0.2]}>
        <boxGeometry args={[0.07, 0.18, 0.03]} />
        {mat(red, 0.85)}
      </mesh>
    </group>
  );
}

// ---------------- 31. 抱枕堆（v5.9 F7：底部两枕斜靠 + 顶枕横放，邻近色混搭） ----------------

export function PillowPile3D({ col }: CozyPlusProps) {
  const main = col ?? '#f2c9cf';
  return (
    <group>
      {/* 左下枕（斜靠） */}
      <mesh position={[-0.15, 0.115, 0.02]} rotation={[0, 0, 0.2]} scale={[1.35, 0.55, 1.05]} castShadow>
        <sphereGeometry args={[0.16, 16, 12]} />
        {mat(main, 0.95)}
      </mesh>
      {/* 右下枕（反向斜靠，奶油色） */}
      <mesh position={[0.14, 0.11, -0.02]} rotation={[0, 0.15, -0.17]} scale={[1.3, 0.55, 1.0]} castShadow>
        <sphereGeometry args={[0.16, 16, 12]} />
        {mat('#f7ead9', 0.95)}
      </mesh>
      {/* 顶部横放枕（主色加深一号） */}
      <mesh position={[0, 0.235, 0]} rotation={[0, -0.1, -0.06]} scale={[1.25, 0.5, 0.95]} castShadow>
        <sphereGeometry args={[0.15, 16, 12]} />
        {mat(shade(main, 0.88), 0.95)}
      </mesh>
      {/* 前侧小方枕点缀（淡紫） */}
      <mesh position={[0.02, 0.08, 0.2]} rotation={[0.3, 0, 0.05]} scale={[1.1, 1.1, 0.45]} castShadow>
        <sphereGeometry args={[0.11, 14, 10]} />
        {mat('#e8d5f0', 0.95)}
      </mesh>
    </group>
  );
}

// ---------------- 32. 懒人豆袋毯（v5.9 F7：压扁泪滴豆袋 + 顶盖缝线 + 搭边盖毯） ----------------

export function BeanbagBlanket3D({ col }: CozyPlusProps) {
  const bean = col ?? '#e2b896';
  return (
    <group>
      {/* 豆袋主体（大压扁泪滴球） */}
      <mesh position={[0, 0.25, 0]} scale={[1.18, 0.6, 1.08]} castShadow receiveShadow>
        <sphereGeometry args={[0.42, 22, 18]} />
        {mat(bean, 0.95)}
      </mesh>
      {/* 顶盖布纹圆片（深一号色 + 缝线环） */}
      <mesh position={[0, 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.14, 24]} />
        {mat(shade(bean, 0.85), 0.95)}
      </mesh>
      <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.14, 0.005, 6, 24]} />
        {mat(shade(bean, 0.75), 0.9)}
      </mesh>
      {/* 搭在边缘的盖毯（上段伏坡 + 下段垂落折角） */}
      <group position={[0.12, 0, 0.2]}>
        <mesh position={[0, 0.43, 0.12]} rotation={[0.55, 0, 0.06]} castShadow>
          <boxGeometry args={[0.5, 0.018, 0.34]} />
          {mat('#f4e7d8', 0.95)}
        </mesh>
        <mesh position={[0, 0.31, 0.315]} rotation={[0.12, 0, 0.04]} castShadow>
          <boxGeometry args={[0.5, 0.28, 0.016]} />
          {mat(shade('#f4e7d8', 0.96), 0.95)}
        </mesh>
        {/* 盖毯格纹横条 ×2 */}
        {[0.38, 0.28].map((y, i) => (
          <mesh key={i} position={[0, y, i === 0 ? 0.245 : 0.325]} rotation={[i === 0 ? 0.55 : 0.12, 0, 0.05]}>
            <boxGeometry args={[0.5, 0.02, 0.02]} />
            {mat('#d9a88a', 0.9)}
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------- 33. 下午茶具（v5.9 F8：茶壶 + 双杯 + 托盘，摆桌小物） ----------------

export function TeaSet3D({ col }: CozyPlusProps) {
  const accent = col ?? '#f2a9bc';
  const china = '#fdfbf6';
  return (
    <group>
      {/* 椭圆托盘 */}
      <mesh position={[0, 0.008, 0]} scale={[1, 1, 0.78]} castShadow>
        <cylinderGeometry args={[0.14, 0.13, 0.016, 26]} />
        {mat('#d9c7ae', 0.7)}
      </mesh>
      {/* 小茶壶（球身 + 斜壶嘴 + 侧把手 + 盖钮） */}
      <group position={[0, 0.062, -0.025]}>
        <mesh scale={[1.1, 0.9, 1]} castShadow>
          <sphereGeometry args={[0.048, 18, 14]} />
          {mat(china, 0.35)}
        </mesh>
        <mesh position={[0.06, 0.012, 0]} rotation={[0, 0, -0.85]}>
          <cylinderGeometry args={[0.008, 0.011, 0.06, 8]} />
          {mat(china, 0.35)}
        </mesh>
        <mesh position={[-0.052, 0.005, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.022, 0.005, 6, 14, Math.PI]} />
          {mat(china, 0.35)}
        </mesh>
        <mesh position={[0, 0.048, 0]}>
          <cylinderGeometry args={[0.026, 0.03, 0.014, 14]} />
          {mat(accent, 0.4)}
        </mesh>
        <mesh position={[0, 0.062, 0]}>
          <sphereGeometry args={[0.011, 10, 8]} />
          {mat(accent, 0.4)}
        </mesh>
      </group>
      {/* 小茶杯 ×2（带茶色水面 + 细把手） */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0.078 * s, 0.04, 0.06]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.022, 0.016, 0.026, 14]} />
            {mat(china, 0.35)}
          </mesh>
          <mesh position={[0, 0.008, 0]}>
            <cylinderGeometry args={[0.018, 0.018, 0.004, 12]} />
            {mat('#b97f3e', 0.4)}
          </mesh>
          <mesh position={[0.026 * s, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.011, 0.0035, 6, 12, Math.PI]} />
            {mat(china, 0.35)}
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------- 34. 蛋糕架（v5.9 F8：双层高脚点心台 + 小蛋糕 + 草莓 + 饼干） ----------------

export function CakeStand3D(_p: CozyPlusProps) {
  const china = '#fdfbf6';
  return (
    <group>
      {/* 底座 + 细柱 */}
      <mesh position={[0, 0.006, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.07, 0.012, 18]} />
        {mat(china, 0.35)}
      </mesh>
      <mesh position={[0, 0.125, 0]} castShadow>
        <cylinderGeometry args={[0.011, 0.011, 0.15, 10]} />
        {mat(china, 0.3)}
      </mesh>
      {/* 下层大盘 */}
      <mesh position={[0, 0.046, 0]} castShadow>
        <cylinderGeometry args={[0.125, 0.115, 0.014, 26]} />
        {mat(china, 0.3)}
      </mesh>
      {/* 上层小盘 */}
      <mesh position={[0, 0.206, 0]} castShadow>
        <cylinderGeometry args={[0.085, 0.08, 0.012, 22]} />
        {mat(china, 0.3)}
      </mesh>
      {/* 上层小蛋糕 ×2（粉/黄 + 草莓红果） */}
      {[[0.025, 0, '#f6c2cf'], [-0.038, 0.022, '#f9e6a6']].map(([x, z, c], i) => (
        <group key={i} position={[Number(x), 0, Number(z)]}>
          <mesh position={[0, 0.235, 0]} castShadow>
            <cylinderGeometry args={[0.031 - i * 0.005, 0.028 - i * 0.004, 0.042, 14]} />
            {mat(String(c), 0.65)}
          </mesh>
          <mesh position={[0, 0.262, 0]}>
            <sphereGeometry args={[0.014, 10, 8]} />
            {mat('#e05a4e', 0.5)}
          </mesh>
        </group>
      ))}
      {/* 下层饼干 ×2（扁金圆片） */}
      {[[-0.05, 0.02], [0.05, -0.03]].map(([x, z], i) => (
        <mesh key={`c${i}`} position={[x, 0.058, z]} castShadow>
          <cylinderGeometry args={[0.032, 0.03, 0.009, 14]} />
          {mat('#e0b56a', 0.7)}
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 35. 娃娃机（v6.1 G10：粉框玻璃罩 + 顶灯珠 + 迷你毛绒球 + 摇杆按钮 + 出奖口） ----------------

/** 「CLAW」小字牌贴图（白底粉字，canvas 手绘） */
function makeClawSignTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fdf6f2';
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = '#f2b3c2';
  ctx.lineWidth = 10;
  ctx.strokeRect(6, 6, 244, 84);
  ctx.fillStyle = '#e8899a';
  ctx.font = 'bold 54px "Avenir Next", "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CLAW', 128, 52);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function ClawMachine3D({ col, lastClaw }: CozyPlusProps) {
  const main = col ?? '#f0aebd';
  const dark = shade(main, 0.82);
  const signTex = useMemo(() => makeClawSignTexture(), []);
  // 彩蛋：30s 内刚抓中（st.lastClaw）→ 顶灯珠庆祝闪烁 + 内部暖光
  const celebrate = !!lastClaw && Date.now() - lastClaw < 30000;
  /** 顶灯珠共享材质（useFrame 呼吸/庆祝闪烁） */
  const beadMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffe9c4', emissive: '#ffd98f', emissiveIntensity: 0.4, roughness: 0.3 }),
    [],
  );
  const glowLight = useRef<THREE.PointLight>(null);
  const clawGrp = useRef<THREE.Group>(null);
  useEffect(() => () => {
    beadMat.dispose();
    signTex.dispose();
  }, []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (celebrate) {
      beadMat.emissiveIntensity = 1.7 + Math.sin(t * 7) * 0.9;
      if (glowLight.current) glowLight.current.intensity = 1.1 + Math.sin(t * 7) * 0.5;
    } else {
      beadMat.emissiveIntensity = 0.4 + Math.sin(t * 2.1) * 0.12; // 平时微呼吸
      if (glowLight.current) glowLight.current.intensity = 0;
    }
    // 抓爪沿轨轻摆
    if (clawGrp.current) clawGrp.current.rotation.z = Math.sin(t * 0.8) * 0.05;
  });
  const glass = { transparent: true, opacity: 0.16, roughness: 0.08, metalness: 0.1, depthWrite: false } as const;
  /** 迷你毛绒球（出奖口附近一堆彩色小球） */
  const balls: [number, number, number, number, string][] = [
    [0.16, 0.665, 0.14, 0.068, '#fdf9f4'],
    [0.3, 0.66, -0.06, 0.062, '#f6c2cf'],
    [-0.24, 0.66, 0.1, 0.064, '#f7e6a6'],
    [-0.05, 0.655, -0.16, 0.06, '#cfe6f5'],
    [0.23, 0.78, 0.03, 0.05, '#f9c9d4'],
  ];
  return (
    <group>
      {/* 底座柜身（粉色金属） */}
      <mesh position={[0, 0.29, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.82, 0.58, 0.66]} />
        {mat(main, 0.42, { metalness: 0.35 })}
      </mesh>
      <mesh position={[0, 0.035, 0]}>
        <boxGeometry args={[0.86, 0.07, 0.7]} />
        {mat(dark, 0.5, { metalness: 0.3 })}
      </mesh>
      {/* 出奖口（正面黑色小洞 + 浅沿） */}
      <mesh position={[0, 0.22, 0.332]}>
        <boxGeometry args={[0.34, 0.24, 0.014]} />
        {mat(dark, 0.5)}
      </mesh>
      <mesh position={[0, 0.22, 0.342]}>
        <boxGeometry args={[0.3, 0.2, 0.012]} />
        {mat('#22222a', 0.65)}
      </mesh>
      {/* 投币口 */}
      <mesh position={[0.31, 0.38, 0.335]}>
        <boxGeometry args={[0.035, 0.14, 0.012]} />
        {mat('#d9d9de', 0.35, { metalness: 0.6 })}
      </mesh>
      {/* 平顶操控台（摇杆 + 双按钮） */}
      <mesh position={[0, 0.6, 0.24]} castShadow>
        <boxGeometry args={[0.82, 0.04, 0.2]} />
        {mat(shade(main, 0.94), 0.45, { metalness: 0.3 })}
      </mesh>
      <group position={[-0.2, 0.655, 0.2]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.011, 0.014, 0.09, 8]} />
          {mat('#d9d9de', 0.35, { metalness: 0.6 })}
        </mesh>
        <mesh position={[0, 0.06, 0]} castShadow>
          <sphereGeometry args={[0.036, 14, 12]} />
          {mat('#e05a4e', 0.35)}
        </mesh>
      </group>
      <mesh position={[0.1, 0.632, 0.29]}>
        <cylinderGeometry args={[0.03, 0.032, 0.02, 14]} />
        {mat('#e8b84b', 0.35, { emissive: '#e8b84b', emissiveIntensity: 0.12 })}
      </mesh>
      <mesh position={[0.23, 0.632, 0.29]}>
        <cylinderGeometry args={[0.03, 0.032, 0.02, 14]} />
        {mat('#7fc3e8', 0.35, { emissive: '#7fc3e8', emissiveIntensity: 0.12 })}
      </mesh>
      {/* 玻璃罩内胆：地板 + 背板 */}
      <mesh position={[0, 0.59, 0]}>
        <boxGeometry args={[0.78, 0.02, 0.62]} />
        {mat('#f7f2ea', 0.85)}
      </mesh>
      <mesh position={[0, 1.07, -0.31]}>
        <boxGeometry args={[0.78, 0.98, 0.02]} />
        {mat('#fbf4ea', 0.9)}
      </mesh>
      {/* 四角立柱 */}
      {[
        [-0.387, -0.307],
        [0.387, -0.307],
        [-0.387, 0.307],
        [0.387, 0.307],
      ].map(([px, pz], i) => (
        <mesh key={i} position={[px, 1.07, pz]} castShadow>
          <boxGeometry args={[0.045, 0.98, 0.045]} />
          {mat(dark, 0.45, { metalness: 0.35 })}
        </mesh>
      ))}
      {/* 玻璃四壁（半透明） */}
      <mesh position={[0, 1.07, 0.308]} raycast={() => null}>
        <boxGeometry args={[0.73, 0.94, 0.01]} />
        <meshStandardMaterial color="#dff1f6" {...glass} />
      </mesh>
      <mesh position={[0, 1.07, -0.308]} raycast={() => null}>
        <boxGeometry args={[0.73, 0.94, 0.01]} />
        <meshStandardMaterial color="#dff1f6" {...glass} />
      </mesh>
      <mesh position={[0.387, 1.07, 0]} raycast={() => null}>
        <boxGeometry args={[0.01, 0.94, 0.57]} />
        <meshStandardMaterial color="#dff1f6" {...glass} />
      </mesh>
      <mesh position={[-0.387, 1.07, 0]} raycast={() => null}>
        <boxGeometry args={[0.01, 0.94, 0.57]} />
        <meshStandardMaterial color="#dff1f6" {...glass} />
      </mesh>
      {/* 奖池毛绒球（堆在出奖口附近） */}
      {balls.map(([bx, by, bz, r, c], i) => (
        <mesh key={i} position={[bx, by, bz]} castShadow>
          <sphereGeometry args={[r, 14, 12]} />
          {mat(c, 0.95)}
        </mesh>
      ))}
      {/* 内部轨道 + 抓爪（沿轨轻摆） */}
      <mesh position={[0, 1.47, 0.05]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, 0.72, 10]} />
        {mat('#d9d9de', 0.35, { metalness: 0.6 })}
      </mesh>
      <group ref={clawGrp} position={[-0.12, 1.47, 0.05]}>
        <mesh>
          <boxGeometry args={[0.06, 0.045, 0.06]} />
          {mat(dark, 0.45, { metalness: 0.35 })}
        </mesh>
        <mesh position={[0, -0.1, 0]}>
          <cylinderGeometry args={[0.004, 0.004, 0.16, 6]} />
          {mat('#b8b8be', 0.4, { metalness: 0.5 })}
        </mesh>
        <mesh position={[0, -0.19, 0]}>
          <sphereGeometry args={[0.026, 10, 8]} />
          {mat('#8a8a92', 0.35, { metalness: 0.6 })}
        </mesh>
        {[1, -1].map((s) => (
          <mesh key={s} position={[0.022 * s, -0.235, 0]} rotation={[Math.PI, 0, 0.42 * s]}>
            <coneGeometry args={[0.011, 0.055, 8]} />
            {mat('#8a8a92', 0.35, { metalness: 0.6 })}
          </mesh>
        ))}
      </group>
      {/* 顶棚 + 盖 + 顶珠 */}
      <mesh position={[0, 1.63, 0]} castShadow>
        <boxGeometry args={[0.86, 0.14, 0.7]} />
        {mat(main, 0.42, { metalness: 0.35 })}
      </mesh>
      <mesh position={[0, 1.715, 0]}>
        <boxGeometry args={[0.8, 0.07, 0.64]} />
        {mat(shade(main, 0.92), 0.45, { metalness: 0.3 })}
      </mesh>
      <mesh position={[0, 1.765, 0]}>
        <sphereGeometry args={[0.022, 10, 8]} />
        {mat('#e8b84b', 0.35, { metalness: 0.4 })}
      </mesh>
      {/* 顶灯珠 ×5（lastClaw 30s 内庆祝闪烁） */}
      {[-0.26, -0.13, 0, 0.13, 0.26].map((bx) => (
        <mesh key={bx} position={[bx, 1.575, 0.345]} material={beadMat}>
          <sphereGeometry args={[0.017, 10, 8]} />
        </mesh>
      ))}
      {/* 「CLAW」小字牌 */}
      <mesh position={[0, 1.63, 0.352]}>
        <boxGeometry args={[0.36, 0.12, 0.014]} />
        {mat('#fdf6f2', 0.5)}
      </mesh>
      <mesh position={[0, 1.63, 0.361]} raycast={() => null}>
        <planeGeometry args={[0.34, 0.1]} />
        <meshStandardMaterial map={signTex} roughness={0.5} />
      </mesh>
      {/* 庆祝暖光（平时 intensity=0 不耗性能） */}
      <pointLight ref={glowLight} position={[0, 1.5, 0.15]} color="#ffd98f" intensity={0} distance={2.4} decay={2} />
    </group>
  );
}

// ---------------- 36. 软木留言板（v6.1 G8：木框 + 软木底 + 彩色便利贴 + 红图钉；挂墙件板面居中朝 +z） ----------------

/** 软木斑驳贴图（随机斑点） */
function makeCorkTexture(): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#d9b489';
  ctx.fillRect(0, 0, S, S);
  const tones = ['#c8a173', '#e3c69b', '#d0aa7d', '#c19b6c'];
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = tones[i % tones.length];
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, 0.6 + Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function NoteBoard3D({ col }: CozyPlusProps) {
  const wood = col ?? '#c9a87a';
  const corkTex = useMemo(() => makeCorkTexture(), []);
  useEffect(() => () => {
    corkTex.dispose();
  }, []);
  /** 便利贴（薄方块 + 手写短线 + 顶部红图钉；rz = 微歪斜） */
  const note = (x: number, y: number, c: string, rz: number, key: string) => (
    <group key={key} position={[x, y, 0.03]} rotation={[0, 0, rz]}>
      <mesh castShadow>
        <boxGeometry args={[0.16, 0.16, 0.006]} />
        {mat(c, 0.9)}
      </mesh>
      {[-0.038, -0.004, 0.03].map((ly, i) => (
        <mesh key={i} position={[i === 2 ? -0.012 : 0.008, ly, 0.004]}>
          <boxGeometry args={[i === 2 ? 0.068 : 0.1, 0.007, 0.002]} />
          {mat(shade(c, 0.55), 0.9)}
        </mesh>
      ))}
      <mesh position={[0, 0.058, 0.007]}>
        <sphereGeometry args={[0.009, 8, 8]} />
        {mat('#e05a4e', 0.35)}
      </mesh>
    </group>
  );
  return (
    <group>
      {/* 木框四边 */}
      <mesh position={[0, 0.275, 0.017]} castShadow>
        <boxGeometry args={[0.72, 0.05, 0.034]} />
        {mat(wood, 0.7)}
      </mesh>
      <mesh position={[0, -0.275, 0.017]} castShadow>
        <boxGeometry args={[0.72, 0.05, 0.034]} />
        {mat(wood, 0.7)}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.335 * s, 0, 0.017]} castShadow>
          <boxGeometry args={[0.05, 0.55, 0.034]} />
          {mat(wood, 0.7)}
        </mesh>
      ))}
      {/* 软木底板 */}
      <mesh position={[0, 0, 0.012]}>
        <boxGeometry args={[0.63, 0.5, 0.018]} />
        <meshStandardMaterial map={corkTex} roughness={0.95} />
      </mesh>
      {/* 三张彩色便利贴（黄/粉/蓝，微歪斜） */}
      {note(-0.15, 0.09, '#f7e6a6', 0.09, 'a')}
      {note(0.13, 0.12, '#f9c9d4', -0.08, 'b')}
      {note(0.0, -0.12, '#cfe6f5', 0.13, 'c')}
      {/* 粉色便签上的小红心涂鸦 */}
      <group position={[0.13, 0.075, 0.042]} rotation={[0, 0, -0.08]}>
        <mesh position={[-0.013, 0.008, 0]}>
          <sphereGeometry args={[0.013, 8, 8]} />
          {mat('#e05a4e', 0.6)}
        </mesh>
        <mesh position={[0.013, 0.008, 0]}>
          <sphereGeometry args={[0.013, 8, 8]} />
          {mat('#e05a4e', 0.6)}
        </mesh>
        <mesh position={[0, -0.011, 0]} rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.017, 0.024, 10]} />
          {mat('#e05a4e', 0.6)}
        </mesh>
      </group>
      {/* 底缘笔架 + 一支马克笔 */}
      <mesh position={[0.05, -0.315, 0.04]} castShadow>
        <boxGeometry args={[0.28, 0.02, 0.055]} />
        {mat(shade(wood, 0.9), 0.7)}
      </mesh>
      <mesh position={[-0.03, -0.297, 0.04]} rotation={[0, 0, Math.PI / 2 + 0.06]} castShadow>
        <capsuleGeometry args={[0.011, 0.085, 4, 10]} />
        {mat('#7fc792', 0.5)}
      </mesh>
    </group>
  );
}

// ---------------- 注册表（接线方按 kind 取用） ----------------

export const COZY_PLUS_PARTS: Record<string, (p: CozyPlusProps) => ReactElement> = {
  projector: Projector3D,
  screen: Screen3D,
  swingChair: SwingChair3D,
  shoeCabinet: ShoeCabinet3D,
  wallArt: WallArt3D,
  humidifier: Humidifier3D,
  wineCabinet: WineCabinet3D,
  chessTable: ChessTable3D,
  hotpotTable: HotpotTable3D,
  gameConsole: GameConsole3D,
  flowerStand: FlowerStand3D,
  vinyl: Vinyl3D,
  musicBox: MusicBox3D,
  xmasTree: XmasTree3D,
  giftPile: GiftPile3D,
  lantern: Lantern3D,
  springCouplet: SpringCouplet3D,
  pumpkin: Pumpkin3D,
  hammock: Hammock3D,
  bbq: Bbq3D,
  loungeOutdoor: LoungeOutdoor3D,
  flowerBox: FlowerBox3D,
  wallClock: WallClock3D,
  worldMap: WorldMap3D,
  photoWallLove: PhotoWallLove3D,
  monstera: Monstera3D,
  cactus: Cactus3D,
  hydro: Hydro3D,
  teddyBig: TeddyBig3D,
  pillowPile: PillowPile3D,
  beanbagBlanket: BeanbagBlanket3D,
  teaSet: TeaSet3D,
  cakeStand: CakeStand3D,
  clawMachine: ClawMachine3D,
  noteBoard: NoteBoard3D,
};
