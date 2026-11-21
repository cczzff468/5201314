'use client';

/**
 * 情侣小家 3D —— 程序化小物家具（v5.3）
 *
 * - Bear3D：小熊「团团」美颜版（圆耳 + 奶油吻部 + 樱粉蝴蝶结 + 圆肚皮）；
 * - PlushPanda3D / PlushPig3D / PlushCat3D：滚滚 / 呼噜 / 咪咪 三只新玩偶；
 * - Pot3D / Kettle3D / Bowls3D / Plates3D / Chopsticks3D / Spoons3D / Cup3D / Juicer3D：厨具小物；
 * - Fan3D：落地风扇（开 = 叶片旋转）；Socket3D：墙壁插座（挂墙）；Chandelier3D：奶油吊灯（挂天花板）。
 *
 * 全部程序化几何（无 GLB），col 接入调色盘；材质每实例独立，随用随建。
 */

import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const mat = (c: string, rough = 0.85, extra?: Partial<THREE.MeshStandardMaterialParameters>) => (
  <meshStandardMaterial color={c} roughness={rough} metalness={0} {...extra} />
);

// ---------------- 小熊「团团」（美颜版：圆耳 + 蝴蝶结 + 圆肚皮） ----------------

export function Bear3D({ col }: { col?: string }) {
  const fur = col ?? '#e9c49c';
  const cream = '#fbf3e4';
  const pink = '#f2a9bc';
  return (
    <group>
      {/* 身体（胖乎乎坐姿） */}
      <mesh position={[0, 0.17, 0]} scale={[1, 0.94, 0.9]} castShadow>
        <sphereGeometry args={[0.155, 20, 16]} />
        {mat(fur, 0.95)}
      </mesh>
      {/* 奶油肚皮 */}
      <mesh position={[0, 0.155, 0.085]} scale={[1, 1.05, 0.5]}>
        <sphereGeometry args={[0.105, 16, 12]} />
        {mat(cream, 0.95)}
      </mesh>
      {/* 头 */}
      <mesh position={[0, 0.4, 0.01]} castShadow>
        <sphereGeometry args={[0.135, 20, 16]} />
        {mat(fur, 0.95)}
      </mesh>
      {/* 圆耳朵 ×2（内耳粉） */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0.098 * s, 0.51, -0.01]}>
          <mesh castShadow>
            <sphereGeometry args={[0.05, 12, 10]} />
            {mat(fur, 0.95)}
          </mesh>
          <mesh position={[0, 0, 0.022]} scale={[1, 1, 0.55]}>
            <sphereGeometry args={[0.03, 10, 8]} />
            {mat(pink, 0.9)}
          </mesh>
        </group>
      ))}
      {/* 吻部（奶油椭圆 + 鼻子 + 微笑嘴） */}
      <mesh position={[0, 0.365, 0.108]} scale={[1.15, 0.8, 0.7]}>
        <sphereGeometry args={[0.052, 14, 10]} />
        {mat(cream, 0.95)}
      </mesh>
      <mesh position={[0, 0.385, 0.148]}>
        <sphereGeometry args={[0.016, 8, 8]} />
        {mat('#5a4638', 0.5)}
      </mesh>
      {/* 眼睛（黑豆）+ 腮红 */}
      {[-1, 1].map((s) => (
        <mesh key={`e${s}`} position={[0.052 * s, 0.425, 0.112]}>
          <sphereGeometry args={[0.014, 8, 8]} />
          {mat('#4a3f3a', 0.4)}
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`b${s}`} position={[0.09 * s, 0.39, 0.095]} scale={[1, 0.7, 0.35]}>
          <sphereGeometry args={[0.024, 10, 8]} />
          {mat('#f7ccd6', 0.9)}
        </mesh>
      ))}
      {/* 樱粉蝴蝶结（脖子上） */}
      {[-1, 1].map((s) => (
        <mesh key={`r${s}`} position={[0.035 * s, 0.285, 0.098]} rotation={[0, s * 0.5, 0]} scale={[1, 0.75, 0.5]}>
          <sphereGeometry args={[0.032, 10, 8]} />
          {mat(pink, 0.7)}
        </mesh>
      ))}
      <mesh position={[0, 0.283, 0.108]}>
        <sphereGeometry args={[0.017, 8, 8]} />
        {mat('#e58ba0', 0.7)}
      </mesh>
      {/* 小手 ×2 */}
      {[-1, 1].map((s) => (
        <mesh key={`a${s}`} position={[0.14 * s, 0.21, 0.035]} scale={[0.8, 1.1, 0.8]}>
          <sphereGeometry args={[0.052, 12, 10]} />
          {mat(fur, 0.95)}
        </mesh>
      ))}
      {/* 脚丫 ×2（往前伸，肉垫奶油色） */}
      {[-1, 1].map((s) => (
        <group key={`f${s}`} position={[0.075 * s, 0.05, 0.105]} scale={[1, 0.6, 1.25]}>
          <mesh castShadow>
            <sphereGeometry args={[0.055, 12, 10]} />
            {mat(fur, 0.95)}
          </mesh>
          <mesh position={[0, 0.03, 0.028]} scale={[0.8, 0.5, 0.6]}>
            <sphereGeometry args={[0.036, 10, 8]} />
            {mat(cream, 0.95)}
          </mesh>
        </group>
      ))}
      {/* 圆尾巴 */}
      <mesh position={[0, 0.1, -0.15]}>
        <sphereGeometry args={[0.042, 10, 8]} />
        {mat(cream, 0.95)}
      </mesh>
    </group>
  );
}

// ---------------- 熊猫「滚滚」 ----------------

export function PlushPanda3D({ col }: { col?: string }) {
  const body = col ?? '#fbfaf6';
  const black = '#3d3d42';
  return (
    <group>
      <mesh position={[0, 0.13, 0]} scale={[1, 0.92, 0.92]} castShadow>
        <sphereGeometry args={[0.13, 18, 14]} />
        {mat(body, 0.95)}
      </mesh>
      <mesh position={[0, 0.3, 0.01]} castShadow>
        <sphereGeometry args={[0.115, 18, 14]} />
        {mat(body, 0.95)}
      </mesh>
      {/* 黑耳朵 */}
      {[-1, 1].map((s) => (
        <mesh key={`e${s}`} position={[0.085 * s, 0.395, -0.015]} castShadow>
          <sphereGeometry args={[0.038, 10, 8]} />
          {mat(black, 0.95)}
        </mesh>
      ))}
      {/* 黑眼罩 + 眼睛 */}
      {[-1, 1].map((s) => (
        <mesh key={`p${s}`} position={[0.05 * s, 0.315, 0.09]} rotation={[0, s * 0.3, s * 0.15]} scale={[0.7, 1, 0.4]}>
          <sphereGeometry args={[0.032, 10, 8]} />
          {mat(black, 0.9)}
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`e${s}`} position={[0.052 * s, 0.315, 0.108]}>
          <sphereGeometry args={[0.011, 8, 8]} />
          {mat('#ffffff', 0.4)}
        </mesh>
      ))}
      <mesh position={[0, 0.29, 0.125]}>
        <sphereGeometry args={[0.011, 8, 8]} />
        {mat(black, 0.5)}
      </mesh>
      {/* 黑手手（抱抱姿势） */}
      {[-1, 1].map((s) => (
        <mesh key={`a${s}`} position={[0.11 * s, 0.17, 0.055]} rotation={[0.3, 0, s * 0.5]} scale={[0.7, 1, 0.7]}>
          <sphereGeometry args={[0.045, 10, 8]} />
          {mat(black, 0.95)}
        </mesh>
      ))}
      {/* 黑腿 */}
      {[-1, 1].map((s) => (
        <mesh key={`l${s}`} position={[0.062 * s, 0.045, 0.075]} scale={[1, 0.65, 1.2]}>
          <sphereGeometry args={[0.045, 10, 8]} />
          {mat(black, 0.95)}
        </mesh>
      ))}
      {/* 腮红 */}
      {[-1, 1].map((s) => (
        <mesh key={`b${s}`} position={[0.088 * s, 0.28, 0.08]} scale={[1, 0.7, 0.35]}>
          <sphereGeometry args={[0.02, 8, 8]} />
          {mat('#f7ccd6', 0.9)}
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 小猪「呼噜」 ----------------

export function PlushPig3D({ col }: { col?: string }) {
  const body = col ?? '#f7c2cf';
  const dark = '#ef9fb4';
  return (
    <group>
      <mesh position={[0, 0.12, 0]} scale={[1.05, 0.9, 1.15]} castShadow>
        <sphereGeometry args={[0.125, 18, 14]} />
        {mat(body, 0.95)}
      </mesh>
      <mesh position={[0, 0.27, 0.02]} castShadow>
        <sphereGeometry args={[0.108, 18, 14]} />
        {mat(body, 0.95)}
      </mesh>
      {/* 三角耳 ×2（微垂） */}
      {[-1, 1].map((s) => (
        <mesh key={`e${s}`} position={[0.075 * s, 0.36, -0.01]} rotation={[0.1, 0, s * -0.7]}>
          <coneGeometry args={[0.035, 0.06, 4]} />
          {mat(dark, 0.95)}
        </mesh>
      ))}
      {/* 猪鼻子（椭圆 + 双鼻孔） */}
      <mesh position={[0, 0.255, 0.108]} scale={[1.2, 0.85, 0.6]}>
        <sphereGeometry args={[0.038, 12, 10]} />
        {mat(dark, 0.9)}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`n${s}`} position={[0.014 * s, 0.257, 0.126]}>
          <sphereGeometry args={[0.007, 6, 6]} />
          {mat('#c97a92', 0.7)}
        </mesh>
      ))}
      {/* 眯眯眼 */}
      {[-1, 1].map((s) => (
        <mesh key={`e${s}`} position={[0.05 * s, 0.29, 0.095]} scale={[1, 0.5, 0.5]}>
          <sphereGeometry args={[0.012, 8, 8]} />
          {mat('#4a3f3a', 0.4)}
        </mesh>
      ))}
      {/* 腮红 */}
      {[-1, 1].map((s) => (
        <mesh key={`b${s}`} position={[0.085 * s, 0.25, 0.075]} scale={[1, 0.7, 0.35]}>
          <sphereGeometry args={[0.022, 8, 8]} />
          {mat('#f2a0b4', 0.9)}
        </mesh>
      ))}
      {/* 小手 ×2 */}
      {[-1, 1].map((s) => (
        <mesh key={`a${s}`} position={[0.115 * s, 0.14, 0.03]} scale={[0.7, 1, 0.8]}>
          <sphereGeometry args={[0.042, 10, 8]} />
          {mat(body, 0.95)}
        </mesh>
      ))}
      {/* 卷尾巴（三颗小珠） */}
      {[0, 1, 2].map((i) => (
        <mesh key={`t${i}`} position={[-0.02 - i * 0.012, 0.13 + Math.sin(i * 1.8) * 0.018, -0.128 - i * 0.012]}>
          <sphereGeometry args={[0.014 - i * 0.003, 8, 8]} />
          {mat(dark, 0.95)}
        </mesh>
      ))}
      {/* 蹄蹄脚 ×2 */}
      {[-1, 1].map((s) => (
        <mesh key={`l${s}`} position={[0.06 * s, 0.035, 0.09]} scale={[1, 0.6, 1.1]}>
          <sphereGeometry args={[0.042, 10, 8]} />
          {mat(dark, 0.95)}
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 猫咪「咪咪」 ----------------

export function PlushCat3D({ col }: { col?: string }) {
  const body = col ?? '#dcd9d2';
  const cream = '#faf6ee';
  const pink = '#f2b7c4';
  return (
    <group>
      <mesh position={[0, 0.125, 0]} scale={[1, 0.92, 1.05]} castShadow>
        <sphereGeometry args={[0.12, 18, 14]} />
        {mat(body, 0.95)}
      </mesh>
      {/* 奶油肚皮 */}
      <mesh position={[0, 0.115, 0.07]} scale={[1, 1, 0.5]}>
        <sphereGeometry args={[0.09, 14, 10]} />
        {mat(cream, 0.95)}
      </mesh>
      <mesh position={[0, 0.285, 0.015]} castShadow>
        <sphereGeometry args={[0.105, 18, 14]} />
        {mat(body, 0.95)}
      </mesh>
      {/* 尖耳朵 ×2（内耳粉） */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0.07 * s, 0.375, 0]} rotation={[0, 0, s * 0.25]}>
          <mesh castShadow>
            <coneGeometry args={[0.038, 0.07, 10]} />
            {mat(body, 0.95)}
          </mesh>
          <mesh position={[0, -0.008, 0.014]} scale={[0.6, 0.7, 0.5]}>
            <coneGeometry args={[0.03, 0.05, 8]} />
            {mat(pink, 0.9)}
          </mesh>
        </group>
      ))}
      {/* 眼睛（圆亮）+ 鼻子 */}
      {[-1, 1].map((s) => (
        <mesh key={`e${s}`} position={[0.045 * s, 0.295, 0.09]}>
          <sphereGeometry args={[0.013, 8, 8]} />
          {mat('#4a3f3a', 0.35)}
        </mesh>
      ))}
      <mesh position={[0, 0.268, 0.112]} scale={[1.2, 0.8, 0.6]}>
        <sphereGeometry args={[0.01, 8, 8]} />
        {mat(pink, 0.7)}
      </mesh>
      {/* 胡须腮红 */}
      {[-1, 1].map((s) => (
        <mesh key={`b${s}`} position={[0.078 * s, 0.262, 0.078]} scale={[1, 0.7, 0.35]}>
          <sphereGeometry args={[0.02, 8, 8]} />
          {mat('#f7ccd6', 0.9)}
        </mesh>
      ))}
      {/* 前爪搭一起 */}
      {[-1, 1].map((s) => (
        <mesh key={`a${s}`} position={[0.045 * s, 0.06, 0.095]} scale={[0.8, 0.6, 1.2]}>
          <sphereGeometry args={[0.04, 10, 8]} />
          {mat(body, 0.95)}
        </mesh>
      ))}
      {/* 竖起来的尾巴（弯钩） */}
      {[0, 1, 2].map((i) => (
        <mesh key={`t${i}`} position={[-0.02 + Math.sin(i * 1.1) * 0.045, 0.2 + i * 0.055, -0.11 - i * 0.008]} castShadow={i === 0}>
          <sphereGeometry args={[0.026 - i * 0.004, 8, 8]} />
          {mat(body, 0.95)}
        </mesh>
      ))}
      <mesh position={[0.014, 0.365, -0.125]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        {mat(cream, 0.95)}
      </mesh>
    </group>
  );
}

// ---------------- 厨具小物 ----------------

/** 奶油汤锅（带盖 + 双耳） */
export function Pot3D({ col }: { col?: string }) {
  const body = col ?? '#f4f1ea';
  return (
    <group>
      <mesh position={[0, 0.07, 0]} castShadow>
        <cylinderGeometry args={[0.105, 0.095, 0.14, 20]} />
        {mat(body, 0.45, { metalness: 0.25 })}
      </mesh>
      <mesh position={[0, 0.145, 0]}>
        <cylinderGeometry args={[0.11, 0.11, 0.012, 20]} />
        {mat(body, 0.4)}
      </mesh>
      <mesh position={[0, 0.168, 0]}>
        <sphereGeometry args={[0.024, 10, 8]} />
        {mat('#43464b', 0.6)}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.112 * s, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.022, 0.008, 8, 14]} />
          {mat('#43464b', 0.6)}
        </mesh>
      ))}
    </group>
  );
}

/** 鸣笛水壶（壶嘴 + 拱形把手） */
export function Kettle3D({ col }: { col?: string }) {
  const body = col ?? '#f7f4ee';
  return (
    <group>
      <mesh position={[0, 0.08, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.09, 0.14, 18]} />
        {mat(body, 0.4, { metalness: 0.2 })}
      </mesh>
      {/* 壶嘴（斜向上） */}
      <mesh position={[0.085, 0.12, 0]} rotation={[0, 0, -0.7]} castShadow>
        <cylinderGeometry args={[0.014, 0.022, 0.1, 10]} />
        {mat(body, 0.4)}
      </mesh>
      {/* 盖 + 鸣笛钮 */}
      <mesh position={[0, 0.155, 0]}>
        <cylinderGeometry args={[0.05, 0.075, 0.025, 14]} />
        {mat(body, 0.4)}
      </mesh>
      <mesh position={[0, 0.178, 0]}>
        <sphereGeometry args={[0.014, 8, 8]} />
        {mat('#f2a9bc', 0.6)}
      </mesh>
      {/* 拱形把手 */}
      <mesh position={[0, 0.16, -0.075]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.05, 0.009, 8, 16, Math.PI]} />
        {mat('#43464b', 0.6)}
      </mesh>
    </group>
  );
}

/** 叠叠小碗（两只叠放，粉边） */
export function Bowls3D({ col }: { col?: string }) {
  const body = col ?? '#fdfcf8';
  return (
    <group>
      <mesh position={[0, 0.038, 0]} castShadow>
        <cylinderGeometry args={[0.088, 0.055, 0.075, 18]} />
        {mat(body, 0.6)}
      </mesh>
      <mesh position={[0, 0.078, 0]}>
        <torusGeometry args={[0.085, 0.006, 8, 20]} />
        {mat('#f2a9bc', 0.7)}
      </mesh>
      <mesh position={[0.02, 0.115, 0.015]} rotation={[0, 0, 0.15]} castShadow>
        <cylinderGeometry args={[0.07, 0.045, 0.06, 16]} />
        {mat(body, 0.6)}
      </mesh>
      <mesh position={[0.02, 0.147, 0.015]}>
        <torusGeometry args={[0.068, 0.005, 8, 18]} />
        {mat('#f2a9bc', 0.7)}
      </mesh>
    </group>
  );
}

/** 白瓷盘子（三只叠放） */
export function Plates3D({ col }: { col?: string }) {
  const body = col ?? '#fdfcf8';
  return (
    <group>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[i * 0.008, 0.012 + i * 0.016, 0]} castShadow={i === 2}>
          <cylinderGeometry args={[0.105 - i * 0.004, 0.085 - i * 0.004, 0.014, 20]} />
          {mat(body, 0.5)}
        </mesh>
      ))}
      <mesh position={[0.008, 0.048, 0]}>
        <torusGeometry args={[0.08, 0.005, 8, 20]} />
        {mat('#c9e3cf', 0.7)}
      </mesh>
    </group>
  );
}

/** 筷子筒（竹筒 + 两双筷子斜插） */
export function Chopsticks3D({ col }: { col?: string }) {
  const body = col ?? '#f0e3c8';
  return (
    <group>
      <mesh position={[0, 0.055, 0]} castShadow>
        <cylinderGeometry args={[0.042, 0.036, 0.11, 14]} />
        {mat(body, 0.8)}
      </mesh>
      <mesh position={[0, 0.113, 0]}>
        <torusGeometry args={[0.042, 0.006, 8, 16]} />
        {mat('#e0cda4', 0.85)}
      </mesh>
      {/* 筷子 ×4 斜插 */}
      {[
        [-0.014, 0.12],
        [0.004, 0.135],
        [0.014, 0.1],
        [-0.004, 0.148],
      ].map(([x, h], i) => (
        <mesh key={i} position={[x, 0.055 + h / 2 + 0.02, i % 2 ? 0.008 : -0.006]} rotation={[i % 2 ? 0.12 : -0.1, 0, (i - 1.5) * 0.06]}>
          <cylinderGeometry args={[0.004, 0.003, h, 6]} />
          {mat('#d9b98a', 0.8)}
        </mesh>
      ))}
    </group>
  );
}

/** 小勺子（架上两只） */
export function Spoons3D({ col }: { col?: string }) {
  const metal = col ?? '#e8e6e0';
  return (
    <group>
      <mesh position={[0, 0.02, 0]} castShadow>
        <boxGeometry args={[0.09, 0.04, 0.05]} />
        {mat('#f4f1ea', 0.8)}
      </mesh>
      {[0, 1].map((i) => (
        <group key={i} position={[(i - 0.5) * 0.032, 0.04, 0]} rotation={[i ? 0.18 : -0.14, 0, (i ? -1 : 1) * 0.25]}>
          <mesh position={[0, 0.045, 0]}>
            <boxGeometry args={[0.011, 0.09, 0.006]} />
            {mat(metal, 0.35, { metalness: 0.6 })}
          </mesh>
          <mesh position={[0, 0.105, 0]} scale={[1, 1.35, 0.45]}>
            <sphereGeometry args={[0.016, 10, 8]} />
            {mat(metal, 0.3, { metalness: 0.6 })}
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** 马克杯（两只：樱粉 + 奶油） */
export function Cup3D({ col }: { col?: string }) {
  const a = col ?? '#f2b7c4';
  return (
    <group>
      <group position={[-0.045, 0, 0]}>
        <mesh position={[0, 0.045, 0]} castShadow>
          <cylinderGeometry args={[0.032, 0.028, 0.09, 14]} />
          {mat(a, 0.6)}
        </mesh>
        <mesh position={[0.036, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.018, 0.005, 8, 12, Math.PI]} />
          {mat(a, 0.6)}
        </mesh>
      </group>
      <group position={[0.05, 0, 0.012]} rotation={[0, 0.4, 0]}>
        <mesh position={[0, 0.04, 0]} castShadow>
          <cylinderGeometry args={[0.028, 0.025, 0.08, 14]} />
          {mat('#fdfcf8', 0.6)}
        </mesh>
        <mesh position={[-0.032, 0.045, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.016, 0.005, 8, 12, Math.PI]} />
          {mat('#fdfcf8', 0.6)}
        </mesh>
        {/* 热可可 */}
        <mesh position={[0, 0.078, 0]}>
          <cylinderGeometry args={[0.023, 0.023, 0.004, 12]} />
          {mat('#b98a68', 0.5)}
        </mesh>
      </group>
    </group>
  );
}

/** 榨汁机（底座 + 果汁杯 + 橙子） */
export function Juicer3D({ col }: { col?: string }) {
  const body = col ?? '#fdfcf8';
  return (
    <group>
      <mesh position={[0, 0.035, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.085, 0.07, 16]} />
        {mat(body, 0.5)}
      </mesh>
      {/* 果汁杯（半透 + 橙汁） */}
      <mesh position={[0, 0.115, 0]}>
        <cylinderGeometry args={[0.055, 0.05, 0.11, 14]} />
        {mat('#eef4f2', 0.2, { transparent: true, opacity: 0.5 })}
      </mesh>
      <mesh position={[0, 0.095, 0]}>
        <cylinderGeometry args={[0.047, 0.043, 0.06, 14]} />
        {mat('#f7b25c', 0.4)}
      </mesh>
      <mesh position={[0, 0.172, 0]}>
        <cylinderGeometry args={[0.056, 0.056, 0.008, 14]} />
        {mat(body, 0.5)}
      </mesh>
      {/* 出汁嘴 */}
      <mesh position={[0.075, 0.06, 0]} rotation={[0, 0, -1.2]}>
        <cylinderGeometry args={[0.008, 0.012, 0.045, 8]} />
        {mat(body, 0.5)}
      </mesh>
      {/* 桔子点缀 */}
      <mesh position={[-0.075, 0.028, 0.03]} castShadow>
        <sphereGeometry args={[0.026, 10, 8]} />
        {mat('#f7a94e', 0.6)}
      </mesh>
      {/* 旋钮 */}
      <mesh position={[0, 0.036, 0.078]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.012, 10]} />
        {mat('#f2a9bc', 0.5)}
      </mesh>
    </group>
  );
}

// ---------------- 落地风扇（开 = 叶片旋转 + 摇头） ----------------

export function Fan3D({ on, col }: { on: boolean; col?: string }) {
  const blades = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);

  useFrame((state, dt) => {
    if (blades.current && on) blades.current.rotation.z += dt * 14;
    if (head.current) {
      // 开着时缓缓左右摇头
      const target = on ? Math.sin(state.clock.elapsedTime * 0.9) * 0.55 : 0;
      head.current.rotation.y = THREE.MathUtils.damp(head.current.rotation.y, on ? target : 0, 3, dt);
    }
  });

  const body = col ?? '#fbfaf6';
  return (
    <group>
      {/* 底盘 + 立柱 */}
      <mesh position={[0, 0.025, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.15, 0.05, 18]} />
        {mat(body, 0.6)}
      </mesh>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.022, 0.028, 0.6, 12]} />
        {mat(body, 0.55)}
      </mesh>
      {/* 网罩圈 + 中心盖 */}
      <mesh position={[0, 0.28, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.008, 0.008, 8, 12]} />
        {mat(body, 0.6)}
      </mesh>
      {/* 机头（摇头组） */}
      <group ref={head} position={[0, 0.78, 0]}>
        {/* 后壳电机 */}
        <mesh position={[0, 0, -0.05]} castShadow>
          <sphereGeometry args={[0.075, 14, 12]} />
          {mat(body, 0.6)}
        </mesh>
        {/* 罩圈（前环） */}
        <mesh position={[0, 0, 0.09]} rotation={[0, 0, 0]} castShadow>
          <torusGeometry args={[0.13, 0.009, 10, 28]} />
          {mat(body, 0.55)}
        </mesh>
        <mesh position={[0, 0, 0.09]} rotation={[0, 0, 0]}>
          <torusGeometry args={[0.085, 0.006, 8, 24]} />
          {mat(body, 0.55)}
        </mesh>
        {/* 叶片（旋转组） */}
        <group ref={blades} position={[0, 0, 0.06]}>
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} rotation={[(i / 5) * Math.PI * 2, 0.5, 0]} position={[0, 0, 0]}>
              <boxGeometry args={[0.115, 0.006, 0.05]} />
              {mat('#dfeef2', 0.4, { transparent: true, opacity: 0.85 })}
            </mesh>
          ))}
          <mesh>
            <sphereGeometry args={[0.028, 10, 8]} />
            {mat('#f2a9bc', 0.6)}
          </mesh>
        </group>
        {/* 中柱连接 */}
        <mesh position={[0, -0.1, -0.03]} rotation={[0.5, 0, 0]}>
          <cylinderGeometry args={[0.016, 0.016, 0.12, 10]} />
          {mat(body, 0.6)}
        </mesh>
        {/* 开关小红点 */}
        <mesh position={[0, -0.02, -0.115]}>
          <sphereGeometry args={[0.009, 8, 8]} />
          {mat(on ? '#7fd69a' : '#d9d9d4', 0.5, { emissive: on ? '#57d98a' : '#000000', emissiveIntensity: on ? 0.9 : 0 })}
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 墙壁插座（挂墙面板） ----------------

export function Socket3D({ col }: { col?: string }) {
  const body = col ?? '#fbfaf6';
  return (
    <group>
      <mesh position={[0, 0, 0.008]} castShadow>
        <boxGeometry args={[0.1, 0.1, 0.016]} />
        {mat(body, 0.5)}
      </mesh>
      <mesh position={[0, 0, 0.018]}>
        <boxGeometry args={[0.084, 0.084, 0.004]} />
        {mat('#f1efe9', 0.6)}
      </mesh>
      {/* 二孔 + 三孔插口 */}
      {[-0.018, 0.018].map((x, i) => (
        <group key={i} position={[x, 0, 0.021]}>
          {i === 0 ? (
            <>
              <mesh position={[-0.009, 0.006, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.0035, 0.0035, 0.004, 8]} />
                {mat('#5a5a5e', 0.6)}
              </mesh>
              <mesh position={[0.009, 0.006, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.0035, 0.0035, 0.004, 8]} />
                {mat('#5a5a5e', 0.6)}
              </mesh>
            </>
          ) : (
            <>
              <mesh position={[0, 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.0035, 0.0035, 0.004, 8]} />
                {mat('#5a5a5e', 0.6)}
              </mesh>
              <mesh position={[-0.008, -0.007, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.0035, 0.0035, 0.004, 8]} />
                {mat('#5a5a5e', 0.6)}
              </mesh>
              <mesh position={[0.008, -0.007, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.0035, 0.0035, 0.004, 8]} />
                {mat('#5a5a5e', 0.6)}
              </mesh>
            </>
          )}
        </group>
      ))}
      {/* 小开关点缀 */}
      <mesh position={[0, -0.032, 0.021]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.007, 0.007, 0.004, 8]} />
        {mat('#f2a9bc', 0.6)}
      </mesh>
    </group>
  );
}

// ---------------- 奶油吊灯（原点 = 天花板吸顶盘，向下垂挂） ----------------

export function Chandelier3D({ on, night, col }: { on: boolean; night: boolean; col?: string }) {
  const body = col ?? '#fdf9ef';
  return (
    <group>
      {/* 吸顶盘 */}
      <mesh position={[0, -0.005, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.07, 0.03, 16]} />
        {mat(body, 0.6)}
      </mesh>
      {/* 吊杆 */}
      <mesh position={[0, -0.14, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.22, 8]} />
        {mat('#d9cfb8', 0.5, { metalness: 0.4 })}
      </mesh>
      {/* 灯罩（奶油圆锥钟形，开口朝下） */}
      <mesh position={[0, -0.36, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.055, 0.19, 22, 1, true]} />
        {mat(body, 0.7, { side: THREE.DoubleSide })}
      </mesh>
      {/* 罩沿装饰圈 */}
      <mesh position={[0, -0.455, 0]}>
        <torusGeometry args={[0.14, 0.008, 8, 24]} />
        {mat('#f2d9a0', 0.6)}
      </mesh>
      {/* 灯泡（开 = 发光） */}
      <mesh position={[0, -0.4, 0]}>
        <sphereGeometry args={[0.032, 12, 10]} />
        {mat('#fff6da', 0.4, { emissive: on ? '#ffd98f' : '#000000', emissiveIntensity: on ? (night ? 2.2 : 1.1) : 0 })}
      </mesh>
      {/* 顶部小球装饰 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.045 * s, -0.48, 0.02]}>
          <sphereGeometry args={[0.014, 8, 8]} />
          {mat('#f2a9bc', 0.6)}
        </mesh>
      ))}
      {/* 灯光 */}
      {on && (
        <pointLight
          position={[0, -0.42, 0]}
          color="#ffd9a0"
          intensity={night ? 1.5 : 0.55}
          distance={6.5}
          decay={2}
        />
      )}
    </group>
  );
}

// ---------------- 玻璃淋浴房（v5.4；背板在 +x/+z 角，开向 -x/-z；开 = 花洒出水） ----------------

export function Shower3D({ on, col }: { on: boolean; col?: string }) {
  const body = col ?? '#fdfbf5';
  const chrome = '#c9d2d8';
  const glassMat = { color: '#cfe6ee', transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0.1 } as const;
  return (
    <group>
      {/* 淋浴底盘（微凸圆角方） */}
      <mesh position={[0, 0.035, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.94, 0.07, 0.94]} />
        {mat(body, 0.5)}
      </mesh>
      <mesh position={[0, 0.075, 0]}>
        <boxGeometry args={[0.86, 0.015, 0.86]} />
        {mat('#eef2f0', 0.4)}
      </mesh>
      {/* 背板 ×2（靠墙角 +x/+z，固定玻璃；另两面步入式开放） */}
      <mesh position={[0.455, 1.0, 0]} castShadow>
        <boxGeometry args={[0.03, 1.9, 0.94]} />
        <meshStandardMaterial {...glassMat} />
      </mesh>
      <mesh position={[0, 1.0, 0.455]} castShadow>
        <boxGeometry args={[0.94, 1.9, 0.03]} />
        <meshStandardMaterial {...glassMat} />
      </mesh>
      {/* 玻璃拉手（进浴口侧沿） */}
      <mesh position={[0.44, 1.05, 0.13]} rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.24, 8]} />
        {mat(chrome, 0.35, { metalness: 0.7 })}
      </mesh>
      {/* 立柱 + 花洒臂 + 顶喷（东北角立柱） */}
      <mesh position={[0.38, 0.95, 0.38]} castShadow>
        <cylinderGeometry args={[0.02, 0.024, 1.9, 10]} />
        {mat(chrome, 0.35, { metalness: 0.7 })}
      </mesh>
      <mesh position={[0.24, 1.92, 0.1]} rotation={[0, 0.5, Math.PI / 2]}>
        <cylinderGeometry args={[0.014, 0.014, 0.42, 8]} />
        {mat(chrome, 0.35, { metalness: 0.7 })}
      </mesh>
      <mesh position={[0.06, 1.88, -0.04]} rotation={[0.3, 0, 0]}>
        <cylinderGeometry args={[0.085, 0.055, 0.05, 18]} />
        {mat(chrome, 0.3, { metalness: 0.7 })}
      </mesh>
      {/* 控制旋钮 */}
      <mesh position={[0.36, 0.75, 0.35]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.025, 14]} />
        {mat(on ? '#8fd0e8' : '#dfe5e8', 0.4, { emissive: on ? '#5db6d8' : '#000000', emissiveIntensity: on ? 0.7 : 0 })}
      </mesh>
      {/* 开 = 花洒出水（半透明水丝锥） */}
      {on && (
        <mesh position={[0.06, 1.62, -0.04]}>
          <coneGeometry args={[0.11, 1.5, 14, 1, true]} />
          <meshStandardMaterial color="#bfe3f2" transparent opacity={0.32} roughness={0.15} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

// ---------------- 浴室柜洗手台（柜体 + 台面 + 陶瓷盆 + 冷热龙头） ----------------

export function Basin3D({ col }: { col?: string }) {
  const body = col ?? '#fdfbf5';
  const chrome = '#c9d2d8';
  return (
    <group>
      {/* 柜体 */}
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.6, 0.48]} />
        {mat(body, 0.7)}
      </mesh>
      {/* 柜门缝 ×2 + 小圆拉手 */}
      <mesh position={[0, 0.3, 0.242]}>
        <boxGeometry args={[0.012, 0.52, 0.005]} />
        {mat('#d8d4ca', 0.7)}
      </mesh>
      {[-0.12, 0.12].map((x) => (
        <mesh key={x} position={[x, 0.42, 0.25]}>
          <sphereGeometry args={[0.016, 10, 8]} />
          {mat(chrome, 0.35, { metalness: 0.7 })}
        </mesh>
      ))}
      {/* 台面 */}
      <mesh position={[0, 0.63, 0]} castShadow>
        <boxGeometry args={[0.96, 0.05, 0.52]} />
        {mat('#f4f1ea', 0.45)}
      </mesh>
      {/* 陶瓷盆（椭圆浅盆） */}
      <mesh position={[0, 0.7, 0.02]} castShadow>
        <cylinderGeometry args={[0.17, 0.13, 0.09, 20]} />
        {mat('#ffffff', 0.25)}
      </mesh>
      <mesh position={[0, 0.745, 0.02]}>
        <torusGeometry args={[0.165, 0.014, 8, 24]} />
        {mat('#ffffff', 0.25)}
      </mesh>
      {/* 龙头（立柱 + 弯头） */}
      <mesh position={[0, 0.76, -0.18]} castShadow>
        <cylinderGeometry args={[0.018, 0.022, 0.16, 10]} />
        {mat(chrome, 0.3, { metalness: 0.75 })}
      </mesh>
      <mesh position={[0, 0.84, -0.13]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.013, 0.013, 0.12, 8]} />
        {mat(chrome, 0.3, { metalness: 0.75 })}
      </mesh>
      {/* 冷热把手 ×2 */}
      {[-0.06, 0.06].map((x) => (
        <mesh key={x} position={[x, 0.845, -0.18]}>
          <cylinderGeometry args={[0.012, 0.012, 0.02, 8]} />
          {mat(x < 0 ? '#a8d4e6' : '#f2b3b3', 0.4)}
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 挂壁大镜子（挂墙；镜面高反光 + 樱粉细框） ----------------

export function Mirror3D({ col }: { col?: string }) {
  const frame = col ?? '#f6e3e9';
  return (
    <group>
      {/* 外框 */}
      <mesh position={[0, 0, 0.02]} castShadow>
        <boxGeometry args={[0.62, 0.84, 0.035]} />
        {mat(frame, 0.6)}
      </mesh>
      {/* 镜面（高金属度 + 微蓝白 → 假反射质感） */}
      <mesh position={[0, 0, 0.041]}>
        <boxGeometry args={[0.54, 0.76, 0.008]} />
        <meshStandardMaterial color="#e8f1f5" roughness={0.06} metalness={0.85} envMapIntensity={1.2} />
      </mesh>
      {/* 顶部柔光（镜面高光条） */}
      <mesh position={[-0.1, 0.24, 0.047]} rotation={[0, 0, 0.5]}>
        <planeGeometry args={[0.3, 0.05]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.5} />
      </mesh>
      <mesh position={[0.12, 0.05, 0.047]} rotation={[0, 0, 0.5]}>
        <planeGeometry args={[0.16, 0.03]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

// ---------------- 毛巾架（挂墙双杆 + 搭着的软毛巾） ----------------

export function TowelRack3D({ col }: { col?: string }) {
  const chrome = '#c9d2d8';
  const towel = col ?? '#f5c9d4';
  return (
    <group>
      {/* 底座 ×2 + 双杆 */}
      {[-0.2, 0.2].map((x) => (
        <mesh key={`b${x}`} position={[x, 0, 0.03]}>
          <cylinderGeometry args={[0.018, 0.018, 0.055, 10]} />
          {mat(chrome, 0.35, { metalness: 0.7 })}
        </mesh>
      ))}
      {[-0.035, 0.045].map((z, i) => (
        <mesh key={`r${i}`} position={[0, 0, z + 0.02]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.011, 0.011, 0.44, 10]} />
          {mat(chrome, 0.35, { metalness: 0.7 })}
        </mesh>
      ))}
      {/* 搭着的毛巾（垂下两折） */}
      <mesh position={[0.02, -0.13, 0.045]} castShadow>
        <boxGeometry args={[0.24, 0.3, 0.022]} />
        {mat(towel, 0.95)}
      </mesh>
      <mesh position={[0.02, -0.28, 0.028]} castShadow>
        <boxGeometry args={[0.22, 0.05, 0.05] } />
        {mat(towel, 0.95)}
      </mesh>
      {/* 毛巾条纹 */}
      <mesh position={[0.02, -0.245, 0.058]}>
        <boxGeometry args={[0.24, 0.02, 0.004]} />
        {mat('#ffffff', 0.9)}
      </mesh>
    </group>
  );
}

// ---------------- 手提电脑（开 = 屏盖翻开 + 屏幕发光；关 = 合盖待机） ----------------

export function Laptop3D({ on, col }: { on?: boolean; col?: string }) {
  const body = col ?? '#e8e6e1';
  const dark = '#3c4046';
  const lid = useRef<THREE.Group>(null);
  useFrame((_, rawDt) => {
    const d = Math.min(rawDt, 0.05);
    if (lid.current) {
      // 屏盖绕后缘铰链开合：合盖 ≈ 平贴键盘（1.52rad），开盖微后仰（0.18rad）
      const target = on ? 0.18 : 1.52;
      lid.current.rotation.x = THREE.MathUtils.damp(lid.current.rotation.x, target, 8, d);
    }
  });
  return (
    <group>
      {/* 底座 */}
      <mesh position={[0, 0.012, 0]} castShadow>
        <boxGeometry args={[0.34, 0.018, 0.24]} />
        {mat(body, 0.5, { metalness: 0.15 })}
      </mesh>
      {/* 键盘面（开盖时透出背光） */}
      <mesh position={[0, 0.023, 0.008]}>
        <boxGeometry args={[0.29, 0.004, 0.16]} />
        {mat(dark, 0.6, { emissive: on ? '#5a7d95' : '#000000', emissiveIntensity: on ? 0.35 : 0 })}
      </mesh>
      {/* 触控板 */}
      <mesh position={[0, 0.023, 0.082]}>
        <boxGeometry args={[0.09, 0.003, 0.048]} />
        {mat('#9aa0a8', 0.5)}
      </mesh>
      {/* 屏盖（绕后缘开合） */}
      <group ref={lid} position={[0, 0.022, -0.115]}>
        <mesh position={[0, 0.105, 0]} castShadow>
          <boxGeometry args={[0.34, 0.21, 0.014]} />
          {mat(body, 0.5, { metalness: 0.15 })}
        </mesh>
        {/* 屏幕（开机发光，关机深黑） */}
        <mesh position={[0, 0.105, 0.009]}>
          <boxGeometry args={[0.305, 0.18, 0.003]} />
          <meshStandardMaterial
            color={on ? '#c8e4f2' : '#23262b'}
            emissive={on ? '#8ec8e6' : '#000000'}
            emissiveIntensity={on ? 0.95 : 0}
            roughness={0.3}
          />
        </mesh>
        {/* 屏上摄像头小点 */}
        <mesh position={[0, 0.197, 0.01]}>
          <sphereGeometry args={[0.005, 8, 8]} />
          {mat('#5a5f66', 0.4)}
        </mesh>
      </group>
    </group>
  );
}
