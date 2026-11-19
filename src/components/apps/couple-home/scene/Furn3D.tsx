'use client';

/**
 * 情侣小家 3D —— 单件家具渲染（v4）
 *
 * - Kenney GLB 白色系模型 + 任意角度水平旋转（ry）+ 俯仰（rx）+ 抬升（y）；
 * - tv：程序化美颜电视（TV3D）；
 * - 门节点真实开合动画（wardrobe/fridge/washer/sink/nightstand/stove）；
 * - 纸箱类无门节点 → 开门态换模型（glbAlt）；
 * - 灯具/收音机：开 = 灯罩发光 + 点光（夜晚更亮），lc = 用户自选光色优先；
 * - playful 点击弹跳；洗衣机运转轻微抖动 + 状态灯 + 滚筒转动；微波炉加热 = 门缝暖光 + 蒸汽 + 嗡嗡抖动；
 * - 编辑模式：选中光圈（移动模式绿色）+ 拖拽（父组件接管指针）+ 用户调色 tint。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { CatalogEntry, FurnitureItem, HomeMode } from '../types';
import { animateDoors, cloneFurniture, ensureModel, type FurnModel } from './model-kit';
import TV3D from './TV3D';
import { Aircon3D, PhotoFrame3D, PlushBunny3D, PlushDuck3D, Polaroid3D, Vanity3D, WallPhoto3D } from './Extras3D';
import {
  Basin3D,
  Bear3D,
  Bowls3D,
  Chandelier3D,
  Chopsticks3D,
  Cup3D,
  Fan3D,
  Juicer3D,
  Kettle3D,
  Laptop3D,
  Mirror3D,
  Plates3D,
  PlushCat3D,
  PlushPanda3D,
  PlushPig3D,
  Pot3D,
  Shower3D,
  Socket3D,
  Spoons3D,
  TowelRack3D,
} from './Small3D';
import { COZY_PARTS, makeSteamTexture } from './Cozy3D';
import { COZY_PLUS_PARTS } from './CozyPlus3D';

export interface Furn3DProps {
  item: FurnitureItem;
  entry: CatalogEntry;
  night: boolean;
  mode: HomeMode;
  selected: boolean;
  /** 移动模式激活（选中光圈变绿，提示可拖动画面搬运） */
  moving?: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>, item: FurnitureItem) => void;
  onTap: (item: FurnitureItem) => void;
  /** 浴缸水龙头点击（放水/关水；仅生活模式） */
  onFaucetTap?: (item: FurnitureItem) => void;
  /** 灶台烹饪中（蒸汽） */
  cooking?: boolean;
  /** 餐桌：好菜已上桌 */
  meal?: boolean;
  /** 乐器演奏中（钢琴键位/音符） */
  playing?: boolean;
  /** 任一投影仪开着（幕布放下放电影） */
  projectorOn?: boolean;
  /** 有人坐在这件家具上（吊篮秋千摆幅加大） */
  sitting?: boolean;
}

/** G4 色温渐变只作用于普通暖白灯具（台灯/落地灯/吊灯等）；火焰/星空等特殊色保持目录原色 */
const WARM_LAMP_FAMILY = new Set(['#ffd9a0', '#ffe6a8']);

/** useGLTF 之外的轻量加载钩子（不依赖 suspense；tint 变化时重新克隆） */
function useFurnModel(
  url: string | undefined,
  cloneMats: boolean,
  yaw: number | undefined,
  tint: string | undefined,
  scale: [number, number, number] | undefined,
): FurnModel | null {
  const [model, setModel] = useState<FurnModel | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    ensureModel(url)
      .then(() => {
        if (alive) setModel(cloneFurniture(url, { cloneMats, yaw, tint, scale }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url, cloneMats, yaw, tint, scale]);
  return model;
}

export default function Furn3D({
  item,
  entry,
  night,
  mode,
  selected,
  moving,
  onPointerDown,
  onTap,
  onFaucetTap,
  cooking,
  meal,
  playing,
  projectorOn,
  sitting,
}: Furn3DProps) {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const bounceAt = useRef(0);
  const [hovered, setHovered] = useState(false);

  const isTV = entry.kind === 'tv';
  const cloneMats = !!entry.acts?.toggle || !!entry.acts?.washer;
  const primary = useFurnModel(isTV ? undefined : entry.glb, cloneMats, entry.yaw, item.col, entry.scale);
  const alt = useFurnModel(isTV ? undefined : entry.glbAlt, cloneMats, entry.yaw, item.col, entry.scale);
  const useAlt = !!entry.glbAlt && !!item.st?.open;

  const model = useAlt ? alt ?? primary : primary;

  // 灯罩发光（toggle 家具材质已克隆，可独立调光）
  // v11 G4 开灯色温：灯罩 emissive 共享同一 Color 实例，useFrame 阻尼它 → 昼夜切换 ~1s 渐变
  const lampTint = useMemo(() => new THREE.Color('#ffc27a'), []);
  const lampLight = useRef<THREE.PointLight>(null);
  const lampTarget = useMemo(() => new THREE.Color(), []);
  useEffect(() => {
    if (!model || !entry.acts?.toggle) return;
    const on = !!item.st?.on;
    model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) {
        if (mat.name === 'lamp' || mat.name === 'glass') {
          mat.emissive = lampTint; // 共享实例：每帧阻尼 lampTint 即全部灯罩同步渐变
          mat.emissiveIntensity = on ? (night ? 1.8 : 0.9) : 0;
        }
      }
    });
  }, [model, entry.acts?.toggle, item.st?.on, night, lampTint]);
  // G4 色温目标：st.lc 用户自选光色最高优先；无 lc 时普通暖白灯具随昼夜
  // （夜 #ffc27a 深暖黄 / 昼 #fff4e0 中性白）；火焰/星空等特殊色灯具保持目录原色不被洗白
  useFrame((_, rawDt) => {
    const base = entry.light?.color ?? '#ffd9a0';
    const lc = item.st?.lc;
    const target = lc ?? (WARM_LAMP_FAMILY.has(base) ? (night ? '#ffc27a' : '#fff4e0') : base);
    lampTarget.set(target);
    lampTint.lerp(lampTarget, Math.min(1, rawDt * 3.2)); // ~1s 渐变到目标色温
    if (lampLight.current) lampLight.current.color.copy(lampTint);
  });

  // playful 点击 → 弹跳
  useEffect(() => {
    if (item.st?.lastTouch) bounceAt.current = performance.now();
  }, [item.st?.lastTouch]);

  // 洗衣机洗好提醒
  const washDot = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame((state, dt) => {
    if (!model) return;
    // 门动画
    animateDoors(model.doors, !!item.st?.open, dt);
    // 弹跳
    if (inner.current) {
      const since = (performance.now() - bounceAt.current) / 1000;
      if (since >= 0 && since < 0.55) {
        const k = Math.sin(since * 16) * Math.max(0, 1 - since / 0.55);
        inner.current.scale.set(1 + k * 0.06, 1 + k * 0.09, 1 + k * 0.06);
        inner.current.position.y = Math.abs(k) * 0.06;
      } else if (inner.current.scale.x !== 1) {
        inner.current.scale.set(1, 1, 1);
        inner.current.position.y = 0;
      }
    }
    // 洗衣机运转：轻微抖动 + 呼吸状态灯
    if (entry.acts?.washer && group.current) {
      if (item.st?.washing) {
        group.current.position.x = item.x + Math.sin(state.clock.elapsedTime * 30) * 0.004;
        if (washDot.current) {
          const m = washDot.current.material as THREE.MeshStandardMaterial;
          m.emissiveIntensity = 1.2 + Math.sin(state.clock.elapsedTime * 6) * 0.8;
        }
      } else {
        group.current.position.x = item.x;
        if (washDot.current) {
          const m = washDot.current.material as THREE.MeshStandardMaterial;
          m.color = new THREE.Color(item.st?.washDone ? '#9fdcae' : '#d9d9d4');
          m.emissive = new THREE.Color(item.st?.washDone ? '#7fd69a' : '#000000');
          m.emissiveIntensity = item.st?.washDone ? 1.2 : 0;
        }
      }
    }
    // 微波炉加热：整机轻微嗡嗡抖动（v5.9 F2，仅 on 时生效，关闭立即归位）
    if (entry.kind === 'microwave' && group.current) {
      group.current.position.x = item.st?.on
        ? item.x + Math.sin(state.clock.elapsedTime * 58) * 0.002
        : item.x;
    }
    // 选中光圈呼吸
    if (ring.current) {
      ring.current.rotation.z = state.clock.elapsedTime * 0.8;
      const s = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.04;
      ring.current.scale.set(s, s, 1);
    }
  });

  const ringR = Math.max(entry.fp[0], entry.fp[1]) / 2 + 0.18;
  /** 选中圈贴地面（抬升家具的光圈投影到地板） */
  const ringY = -(item.y ?? 0) + 0.025;

  /** v5.6 温馨扩展组件（按 kind 取） */
  const CozyPart = COZY_PARTS[entry.kind];
  /** v5.7 拾光扩展组件（按 kind 取） */
  const PlusPart = COZY_PLUS_PARTS[entry.kind];

  const modelSize = model?.size;

  const handlers = useMemo(
    () => ({
      down: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onPointerDown(e, item);
      },
      click: (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 8) return; // 拖拽后不触发点击
        onTap(item);
      },
      over: () => {
        setHovered(true);
        document.body.style.cursor = mode === 'edit' ? 'grab' : 'pointer';
      },
      out: () => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      },
    }),
    [item, onPointerDown, onTap, mode],
  );

  /**
   * ⚑ 悬停高亮只在「编辑模式 + 精细指针（鼠标）」下挂载。
   * R3F 对带 Over/Out 处理器的对象每次 pointermove 都会递归射线检测 ——
   * 生活模式（触屏）挂了全部家具 GLB，每帧滑动都要扫完整场景，真机上直接把滑动事件拖死。
   * 门控后生活/编辑触屏模式的 pointermove 射线开销归零，滑动视角恢复丝滑。
   */
  const finePointer = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches,
    [],
  );
  const hoverHandlers =
    mode === 'edit' && finePointer
      ? { onPointerOver: handlers.over, onPointerOut: handlers.out }
      : {};

  return (
    <group
      ref={group}
      position={[item.x, item.y ?? 0, item.z]}
      rotation={[item.rx ?? 0, item.ry ?? 0, 0]}
    >
      <group
        ref={inner}
        onPointerDown={handlers.down}
        onClick={handlers.click}
        {...hoverHandlers}
      >
        {model && <primitive object={model.root} />}

        {/* 电视（程序化美颜大屏） */}
        {isTV && <TV3D on={!!item.st?.on} night={night} col={item.col} channel={item.st?.channel} />}

        {/* 奶油猫窝（程序化软萌圆窝：外圈软边 + 内垫 + 毛线球，v7.1 宠物小窝；v11 st.bedColor 换外壳色） */}
        {entry.kind === 'petBed' && <PetBed3D col={item.col} bedColor={item.st?.bedColor} />}

        {/* 立体壁挂空调（程序化建模：导风板摆动 + 冷风丝） */}
        {entry.kind === 'aircon' && <Aircon3D on={!!item.st?.on} night={night} col={item.col} />}

        {/* 立式相框（程序化建模：手机上传照片，永久保存） */}
        {entry.kind === 'photoFrame' && <PhotoFrame3D col={item.col} photo={item.st?.photo} />}

        {/* 挂墙相框（竖版/横版） + 拍立得 */}
        {entry.kind === 'photoWall' && <WallPhoto3D col={item.col} photo={item.st?.photo} />}
        {entry.kind === 'photoWallWide' && <WallPhoto3D col={item.col} photo={item.st?.photo} wide />}
        {entry.kind === 'polaroid' && <Polaroid3D col={item.col} photo={item.st?.photo} />}

        {/* 毛绒玩偶 + 梳妆台（程序化建模） */}
        {entry.kind === 'plushBunny' && <PlushBunny3D col={item.col} />}
        {entry.kind === 'plushDuck' && <PlushDuck3D col={item.col} />}
        {entry.kind === 'plushPanda' && <PlushPanda3D col={item.col} />}
        {entry.kind === 'plushPig' && <PlushPig3D col={item.col} />}
        {entry.kind === 'plushCat' && <PlushCat3D col={item.col} />}
        {entry.kind === 'vanity' && <Vanity3D col={item.col} />}
        {entry.kind === 'bear' && <Bear3D col={item.col} />}

        {/* 厨具小物（程序化建模） */}
        {entry.kind === 'pot' && <Pot3D col={item.col} />}
        {entry.kind === 'kettle' && <Kettle3D col={item.col} />}
        {entry.kind === 'bowls' && <Bowls3D col={item.col} />}
        {entry.kind === 'plates' && <Plates3D col={item.col} />}
        {entry.kind === 'chopsticks' && <Chopsticks3D col={item.col} />}
        {entry.kind === 'spoons' && <Spoons3D col={item.col} />}
        {entry.kind === 'cup' && <Cup3D col={item.col} />}
        {entry.kind === 'juicer' && <Juicer3D col={item.col} />}

        {/* 风扇（开 = 叶片旋转 + 摇头）/ 插座 / 吊灯（挂顶）/ 手提电脑（开 = 屏盖翻开 + 屏幕发光） */}
        {entry.kind === 'fan' && <Fan3D on={!!item.st?.on} col={item.col} />}
        {entry.kind === 'socket' && <Socket3D col={item.col} />}
        {entry.kind === 'chandelier' && <Chandelier3D on={!!item.st?.on} night={night} col={item.col} />}
        {entry.kind === 'laptop' && <Laptop3D on={!!item.st?.on} col={item.col} />}

        {/* 洗衣机状态灯 */}
        {entry.acts?.washer && modelSize && (
          <mesh ref={washDot} position={[modelSize.x * 0.32, modelSize.y * 0.78, modelSize.z / 2 + 0.01]}>
            <sphereGeometry args={[0.035, 10, 10]} />
            <meshStandardMaterial color="#d9d9d4" emissive="#7fd69a" emissiveIntensity={0} />
          </mesh>
        )}

        {/* 洗衣机滚筒转动（v5.9 F2：washing 时正面观察窗半透明转盘 + 泡沫） */}
        {entry.acts?.washer && modelSize && (
          <WasherDrum washing={!!item.st?.washing} modelSize={modelSize} />
        )}

        {/* 微波炉加热外显（v5.9 F2：门缝暖光 + 蒸汽；整机抖动在外层 useFrame 处理，GLB 内腔不可见） */}
        {entry.kind === 'microwave' && modelSize && (
          <MicrowaveHeat on={!!item.st?.on} modelSize={modelSize} />
        )}

        {/* 卫浴全套（v5.4：淋浴房/洗手台/镜子/毛巾架） */}
        {entry.kind === 'shower' && <Shower3D on={!!item.st?.on} col={item.col} />}
        {entry.kind === 'basin' && <Basin3D col={item.col} />}
        {entry.kind === 'mirror' && <Mirror3D col={item.col} />}
        {entry.kind === 'towelRack' && <TowelRack3D col={item.col} />}

        {/* 泡泡浴缸：水龙头（可点击放水）+ 水位上涨 + 泡泡 */}
        {entry.kind === 'bathtub' && (
          <TubExtras
            filling={!!item.st?.bathWater}
            interactive={mode === 'live'}
            onFaucet={() => onFaucetTap?.(item)}
          />
        )}

        {/* v5.6 温馨扩展（Cozy3D 程序化建模）：窗帘/壁炉/鱼缸/豆袋/钢琴/吉他/穿衣镜/星空灯/床幔/咖啡机/果盘/浴帘/洗漱/体重秤/置物架 */}
        {CozyPart && (
          <CozyPart
            col={item.col}
            on={!!item.st?.on}
            open={!!item.st?.on}
            playing={playing}
            brewing={!!item.st?.on}
            fedAt={item.st?.fedAt}
          />
        )}

        {/* v5.7 拾光扩展（CozyPlus3D 程序化建模）：投影仪/幕布/吊篮秋千/鞋柜/挂画组/加湿器/酒柜/棋盘桌/火锅桌/吊床/游戏机/花架 + v5.8 黑胶唱片机/八音盒
            + v5.9 节日/阳台/挂墙/绿植/毛绒/茶角 20 件（photoWallLove 的照片经 photo 透传入注册表，无需 kind 专属重复渲染）
            + v6.1 娃娃机/软木留言板（lastClaw = 抓中时间戳，30s 内顶灯珠庆祝彩蛋） */}
        {PlusPart && (
          <PlusPart
            col={item.col}
            on={!!item.st?.on}
            open={!!item.st?.open}
            projectorOn={projectorOn}
            sat={sitting}
            touch={item.st?.lastTouch}
            photo={item.st?.photo}
            lc={item.st?.lc}
            lastClaw={item.st?.lastClaw}
          />
        )}

        {/* 灶台烹饪：锅上蒸汽 */}
        {entry.kind === 'stove' && cooking && <StoveSteam />}

        {/* 餐桌：一桌好菜 */}
        {entry.kind === 'diningTable' && meal && <MealDish />}
      </group>

      {/* 灯光（开着才亮；夜晚更暖；lc = 用户自选光色优先，E7；v11 G4 无 lc 时色温随昼夜 ~1s 渐变） */}
      {entry.light && item.st?.on && modelSize && (
        <pointLight
          ref={lampLight}
          position={[0, entry.light.y, 0]}
          color="#ffc27a"
          intensity={(entry.light.intensity ?? 1) * (night ? 1.5 : 0.55)}
          distance={5.5}
          decay={2}
        />
      )}

      {/* 选中光圈（编辑模式；移动模式变绿） */}
      {selected && (
        <mesh ref={ring} position={[0, ringY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringR - 0.06, ringR, 40]} />
          <meshStandardMaterial
            color={moving ? '#7fc792' : '#f2a9bc'}
            emissive={moving ? '#7fc792' : '#f2a9bc'}
            emissiveIntensity={0.9}
            transparent
            opacity={0.9}
          />
        </mesh>
      )}

      {/* hover 高亮圈（编辑模式非选中时） */}
      {mode === 'edit' && hovered && !selected && (
        <mesh position={[0, ringY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringR - 0.04, ringR - 0.01, 40]} />
          <meshStandardMaterial color="#e5e2d8" transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  );
}

// ---------------- 浴缸附属：水龙头 + 放水 + 水位 + 泡泡（程序化） ----------------

const BUBBLE_POS: [number, number, number][] = [
  [-0.7, 0, -0.18],
  [-0.35, 0, 0.22],
  [0.05, 0, -0.25],
  [0.3, 0, 0.12],
  [0.62, 0, -0.1],
  [-0.12, 0, 0.05],
  [0.82, 0, 0.24],
  [-0.85, 0, 0.16],
];

function TubExtras({
  filling,
  interactive,
  onFaucet,
}: {
  filling: boolean;
  interactive: boolean;
  onFaucet: () => void;
}) {
  const water = useRef<THREE.Mesh>(null);
  const bubbles = useRef<THREE.Group>(null);
  const stream = useRef<THREE.Mesh>(null);
  const knob = useRef<THREE.Mesh>(null);
  const level = useRef(0.1);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    // 水位：放水 → 涨到 0.42；关水 → 缓慢回落
    level.current = THREE.MathUtils.damp(level.current, filling ? 0.42 : 0.08, filling ? 0.9 : 1.6, d);
    if (water.current) {
      water.current.visible = level.current > 0.1;
      // 底部贴 0.05，顶部 ≈ 0.05 + level
      water.current.scale.y = Math.max(0.02, level.current);
      water.current.position.y = 0.05 + water.current.scale.y / 2;
    }
    if (bubbles.current) {
      bubbles.current.visible = filling && level.current > 0.24;
      const t = state.clock.elapsedTime;
      bubbles.current.children.forEach((b, i) => {
        b.position.y = 0.06 + Math.abs(Math.sin(t * 1.4 + i * 1.7)) * 0.05;
      });
    }
    if (stream.current) stream.current.visible = filling;
    if (knob.current) {
      const m = knob.current.material as THREE.MeshStandardMaterial;
      m.emissive = m.emissive ?? new THREE.Color();
      m.emissive.set(filling ? '#7fc3e8' : '#000000');
      m.emissiveIntensity = filling ? 0.9 : 0;
    }
  });

  const chrome = '#c9d2d8';
  return (
    <group>
      {/* 水龙头（立在浴缸 +x 端的外沿上） */}
      <group position={[1.0, 0.56, 0.18]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.03, 0.036, 0.3, 12]} />
          <meshStandardMaterial color={chrome} roughness={0.28} metalness={0.75} />
        </mesh>
        {/* 弯头出水嘴（朝浴缸内） */}
        <mesh position={[-0.11, 0.19, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.24, 10]} />
          <meshStandardMaterial color={chrome} roughness={0.28} metalness={0.75} />
        </mesh>
        {/* 旋钮（点击放水/关水；带放大的隐形热区方便手指点按） */}
        <mesh
          ref={knob}
          position={[0.02, 0.19, 0.05]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.032, 0.032, 0.024, 14]} />
          <meshStandardMaterial color={filling ? '#a8d4e6' : '#e8e4dc'} roughness={0.35} />
        </mesh>
        <mesh
          position={[0.02, 0.19, 0.03]}
          onClick={
            interactive
              ? (e) => {
                  e.stopPropagation();
                  onFaucet();
                }
              : undefined
          }
        >
          <boxGeometry args={[0.16, 0.16, 0.16]} />
          {/* 全透明热区（透明度 0 仍参与射线检测；visible=false 会被 raycaster 跳过） */}
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      {/* 出水水柱 */}
      <mesh ref={stream} position={[0.82, 0.28, 0.18]} visible={false}>
        <cylinderGeometry args={[0.02, 0.03, 0.5, 8]} />
        <meshStandardMaterial color="#bfe3f2" transparent opacity={0.5} roughness={0.15} />
      </mesh>
      {/* 缸内水体（水位随 useFrame 涨落；box 高 1，缩放后顶面 ≈ 0.05+level） */}
      <mesh ref={water} position={[-0.06, 0.1, 0]} scale={[1, 0.1, 1]} visible={false}>
        <boxGeometry args={[2.05, 1, 0.86]} />
        <meshStandardMaterial color="#cdeaf5" transparent opacity={0.55} roughness={0.2} />
      </mesh>
      {/* 泡泡群（放水时浮在水面） */}
      <group ref={bubbles} visible={false}>
        {BUBBLE_POS.map((p, i) => (
          <mesh key={i} position={p} scale={[1, 0.6, 1]}>
            <sphereGeometry args={[0.05 + (i % 3) * 0.018, 10, 8]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.85} roughness={0.3} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------- 微波炉加热外显（v5.9 F2：门缝暖光 + 蒸汽；整机抖动由主 useFrame 处理） ----------------

function MicrowaveHeat({ on, modelSize }: { on: boolean; modelSize: THREE.Vector3 }) {
  const steamTex = useMemo(() => makeSteamTexture(), []);
  const puffs = useRef<(THREE.Sprite | null)[]>([]);
  const glow = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!on) return;
    const t = state.clock.elapsedTime;
    // 门缝暖光呼吸
    if (glow.current) {
      (glow.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.3 + Math.sin(t * 2.2) * 0.25;
    }
    // 顶部蒸汽 ×2 循环上升
    puffs.current.forEach((sp, i) => {
      if (!sp) return;
      const life = (t * 0.5 + i * 0.5) % 1;
      sp.position.set((i === 0 ? -0.05 : 0.05) + Math.sin(t * 1.2 + i * 3) * 0.02, modelSize.y + 0.02 + life * 0.2, 0);
      const s = 0.06 + life * 0.1;
      sp.scale.set(s, s, 1);
      (sp.material as THREE.SpriteMaterial).opacity = 0.5 * (1 - life);
    });
  });
  return (
    <group visible={on}>
      {/* 门缝暖光薄板（发光细长条贴在门缝处） */}
      <mesh ref={glow} position={[modelSize.x * 0.14, modelSize.y * 0.5, modelSize.z / 2 + 0.004]} raycast={() => null}>
        <planeGeometry args={[modelSize.x * 0.035, modelSize.y * 0.62]} />
        <meshStandardMaterial
          color="#ffe9c4"
          emissive="#ffcf8a"
          emissiveIntensity={1.2}
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </mesh>
      {/* 顶部逸出蒸汽 ×2 */}
      {[0, 1].map((i) => (
        <sprite
          key={i}
          ref={(el) => { puffs.current[i] = el; }}
          position={[0, modelSize.y + 0.05, 0]}
          scale={[0.07, 0.07, 1]}
        >
          <spriteMaterial map={steamTex} transparent opacity={0} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

// ---------------- 洗衣机滚筒转动（v5.9 F2：washing 时正面观察窗半透明转盘 + 泡沫） ----------------

function WasherDrum({ washing, modelSize }: { washing: boolean; modelSize: THREE.Vector3 }) {
  const root = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const foam = useRef<(THREE.Mesh | null)[]>([]);
  const r = Math.min(modelSize.x, modelSize.y) * 0.26;
  useFrame((state, dt) => {
    if (root.current) root.current.visible = washing; // 结束即隐藏省渲染
    if (!washing) return;
    // 滚筒匀速转动
    if (spin.current) spin.current.rotation.z -= Math.min(dt, 0.05) * 4.2;
    // 泡沫小球贴窗缘轻浮
    const t = state.clock.elapsedTime;
    foam.current.forEach((f, i) => {
      if (!f) return;
      const a = i * 2.1 + 0.6;
      f.position.set(
        Math.cos(a) * r * 0.86,
        Math.sin(a) * r * 0.86 + Math.sin(t * 2.4 + i * 1.9) * 0.008,
        0.012,
      );
    });
  });
  return (
    <group ref={root} position={[0, modelSize.y * 0.55, modelSize.z / 2 + 0.006]} visible={false}>
      {/* 旋转内筒（深色半透明盘 + 3 根辐条） */}
      <group ref={spin}>
        <mesh rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <cylinderGeometry args={[r, r, 0.006, 26]} />
          <meshStandardMaterial color="#3a4048" roughness={0.4} transparent opacity={0.42} depthWrite={false} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation={[0, 0, (i * Math.PI) / 3]} position={[0, 0, 0.004]} raycast={() => null}>
            <boxGeometry args={[r * 1.7, 0.014, 0.004]} />
            <meshStandardMaterial color="#565e68" roughness={0.5} transparent opacity={0.55} />
          </mesh>
        ))}
      </group>
      {/* 观察窗外圈环 */}
      <mesh position={[0, 0, 0.008]} raycast={() => null}>
        <torusGeometry args={[r * 0.99, 0.012, 8, 32]} />
        <meshStandardMaterial color="#cfd4d8" roughness={0.35} metalness={0.4} />
      </mesh>
      {/* 泡沫 ×3 */}
      {[0, 1, 2].map((i) => (
        <mesh key={`f${i}`} ref={(el) => { foam.current[i] = el; }} raycast={() => null}>
          <sphereGeometry args={[0.016, 8, 8]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} transparent opacity={0.75} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 灶台烹饪蒸汽（做饭时从锅口升腾） ----------------

function StoveSteam() {
  const group = useRef<THREE.Group>(null);
  const PUFFS = 4;
  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    group.current.children.forEach((c, i) => {
      const ph = ((t * 0.55 + i / PUFFS) % 1 + 1) % 1;
      c.position.y = 0.1 + ph * 0.42;
      c.position.x = Math.sin(ph * 5 + i * 2.1) * 0.05;
      const s = 0.07 + ph * 0.13;
      c.scale.set(s, s, s);
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
      m.opacity = Math.sin(ph * Math.PI) * 0.5;
    });
  });
  return (
    <group ref={group} position={[-0.18, 0.92, 0]}>
      {Array.from({ length: PUFFS }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0} depthWrite={false} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 一桌好菜（做饭完成摆上餐桌） ----------------

function MealDish() {
  return (
    <group position={[0, 0.735, 0]}>
      {/* 大圆盘 */}
      <mesh position={[0, 0.015, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.22, 0.03, 24]} />
        <meshStandardMaterial color="#fdfbf6" roughness={0.35} />
      </mesh>
      {/* 红烧肉块 ×3 */}
      {[
        [-0.07, 0.05],
        [0.08, -0.03],
        [0.0, 0.1],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.055, z]} rotation={[0, i * 1.3, 0]} castShadow>
          <boxGeometry args={[0.09, 0.05, 0.09]} />
          <meshStandardMaterial color="#b4643c" roughness={0.55} />
        </mesh>
      ))}
      {/* 绿菜点缀 */}
      {[
        [0.13, 0.12],
        [-0.14, -0.08],
      ].map(([x, z], i) => (
        <mesh key={`g${i}`} position={[x, 0.045, z]} scale={[1, 0.5, 1]} castShadow>
          <sphereGeometry args={[0.035, 10, 8]} />
          <meshStandardMaterial color="#7fbf7a" roughness={0.7} />
        </mesh>
      ))}
      {/* 小碗汤 */}
      <mesh position={[0.3, 0.04, -0.18]} castShadow>
        <cylinderGeometry args={[0.07, 0.05, 0.06, 14]} />
        <meshStandardMaterial color="#fdfbf6" roughness={0.4} />
      </mesh>
      <mesh position={[0.3, 0.062, -0.18]}>
        <cylinderGeometry args={[0.06, 0.06, 0.012, 14]} />
        <meshStandardMaterial color="#e8b04c" roughness={0.3} />
      </mesh>
    </group>
  );
}

// ---------------- v7.1 宠物小窝：奶油猫窝（程序化软萌圆窝） ----------------

/**
 * 猫窝建模（世界尺度，脚印 fp [0.66, 0.58]）：
 * - 椭圆软外壳（压扁圆环感：两圈 lathe 式圆管拼软边）+ 奶油内垫 + 缝线小窝底；
 * - 一颗粉色毛线球 + 拖出的毛线点缀（萌系装饰）；
 * - v11 换色渲染：bedColor（st.bedColor #rrggbb）优先 → 外壳/外壁/窝底用该色，
 *   内垫奶油、白珠缝线、毛线球等细节保留；非法值回落 col / 默认樱粉；
 * - 无交互（点击弹跳由 Furn3D 的 playful 统一处理）。
 */
const BED_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export function PetBed3D({ col, bedColor }: { col?: string; bedColor?: string }) {
  const shell = BED_COLOR_RE.test(bedColor ?? '') ? bedColor! : col || '#f6d8dd'; // 外壳：v11 床色优先，其次用户调色，默认樱粉奶油
  return (
    <group>
      {/* 外壳软边（椭圆环：管状环压扁） */}
      <mesh castShadow position={[0, 0.055, 0]} scale={[1, 0.62, 0.88]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.25, 0.085, 12, 28]} />
        <meshStandardMaterial color={shell} roughness={0.92} />
      </mesh>
      {/* 外壁围一圈（浅碗壁：下半圆柱 + 内收） */}
      <mesh castShadow position={[0, 0.05, 0]} scale={[1, 1, 0.88]}>
        <cylinderGeometry args={[0.29, 0.24, 0.1, 24, 1, true]} />
        <meshStandardMaterial color={shell} roughness={0.92} side={THREE.DoubleSide} />
      </mesh>
      {/* 窝底 */}
      <mesh receiveShadow position={[0, 0.005, 0]} scale={[1, 1, 0.88]}>
        <cylinderGeometry args={[0.29, 0.27, 0.014, 24]} />
        <meshStandardMaterial color={shell} roughness={0.92} />
      </mesh>
      {/* 内垫（奶油白绒垫，微微凸起） */}
      <mesh receiveShadow castShadow position={[0, 0.028, 0]} scale={[1, 1, 0.88]}>
        <sphereGeometry args={[0.235, 20, 10, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58]} />
        <meshStandardMaterial color="#fdf6ea" roughness={0.96} />
      </mesh>
      {/* 缝线点缀（内垫边缘一圈小球珠） */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.215, 0.052, Math.sin(a) * 0.19]}>
            <sphereGeometry args={[0.011, 6, 6]} />
            <meshStandardMaterial color="#ffffff" roughness={0.85} />
          </mesh>
        );
      })}
      {/* 毛线球（窝沿上） */}
      <mesh castShadow position={[0.21, 0.115, 0.13]}>
        <sphereGeometry args={[0.032, 10, 8]} />
        <meshStandardMaterial color="#eaa4b4" roughness={0.85} />
      </mesh>
      {/* 拖出的毛线（小弯钩） */}
      <mesh position={[0.15, 0.012, 0.2]} rotation={[-Math.PI / 2, 0, 0.9]}>
        <torusGeometry args={[0.05, 0.006, 6, 16, Math.PI * 1.2]} />
        <meshStandardMaterial color="#eaa4b4" roughness={0.85} />
      </mesh>
    </group>
  );
}
