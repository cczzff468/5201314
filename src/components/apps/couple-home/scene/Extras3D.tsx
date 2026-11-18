'use client';

/**
 * 情侣小家 3D —— 程序化新家具（v5.2）
 *
 * - Aircon3D：立体壁挂空调（圆角机身 + 导风板摆动 + 运行冷风丝 + 指示灯 + 夜间冷光）；
 * - PhotoFrame3D：立式相框（木框 + 斜撑脚架），相片来自手机上传（st.photo dataURL），
 *   没有照片时显示「点我传合照」粉系占位画；照片永久保存在小家档案里；
 * - WallPhoto3D：挂墙相框（竖版 / 横版），贴墙平挂；
 * - Polaroid3D：拍立得（白边厚相纸 + 胶带 + 小支架，微微倾角）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

// ---------------- 立体壁挂空调 ----------------

export function Aircon3D({ on, night, col }: { on: boolean; night: boolean; col?: string }) {
  const flap = useRef<THREE.Group>(null);

  useFrame((state, dt) => {
    if (!flap.current) return;
    // 关 = 贴合机身；开 = 导风板张开并缓缓上下摆动送风
    const target = on ? 0.78 + Math.sin(state.clock.elapsedTime * 2.2) * 0.2 : 0.04;
    flap.current.rotation.x = THREE.MathUtils.damp(flap.current.rotation.x, target, 6, dt);
  });

  const body = col ?? '#fbfaf7';

  return (
    <group>
      {/* 主机身 */}
      <mesh position={[0, 0.16, 0]} castShadow>
        <boxGeometry args={[0.88, 0.32, 0.22]} />
        <meshStandardMaterial color={body} roughness={0.5} metalness={0.05} />
      </mesh>
      {/* 顶盖细腻亮条 */}
      <mesh position={[0, 0.325, 0]}>
        <boxGeometry args={[0.9, 0.018, 0.24]} />
        <meshStandardMaterial color="#ffffff" roughness={0.35} />
      </mesh>
      {/* 机身侧面装饰线 */}
      <mesh position={[0, 0.16, -0.108]}>
        <boxGeometry args={[0.82, 0.24, 0.008]} />
        <meshStandardMaterial color="#ecebe6" roughness={0.7} />
      </mesh>
      {/* 顶部进风格栅 */}
      <mesh position={[0, 0.318, -0.05]}>
        <boxGeometry args={[0.78, 0.006, 0.12]} />
        <meshStandardMaterial color="#dcdbd5" roughness={0.85} />
      </mesh>
      {/* 显示窗（开 = 柔绿呼吸灯感） */}
      <mesh position={[0.27, 0.14, 0.112]}>
        <boxGeometry args={[0.15, 0.05, 0.006]} />
        <meshStandardMaterial
          color={on ? '#b9ecd0' : '#e3e2dd'}
          emissive={on ? '#57d98a' : '#000000'}
          emissiveIntensity={on ? 0.85 : 0}
        />
      </mesh>
      {/* 品牌小圆点 */}
      <mesh position={[-0.3, 0.14, 0.112]}>
        <sphereGeometry args={[0.014, 8, 8]} />
        <meshStandardMaterial color="#cfcecb" metalness={0.4} roughness={0.4} />
      </mesh>

      {/* 导风板（铰链在机身下缘，绕 x 摆动） */}
      <group ref={flap} position={[0, 0.05, 0.1]}>
        <mesh position={[0, -0.05, 0.024]} castShadow>
          <boxGeometry args={[0.8, 0.016, 0.095]} />
          <meshStandardMaterial color="#f3f1eb" roughness={0.6} />
        </mesh>
      </group>

      {/* 冷风丝（开着才飘） */}
      {on && <Breeze />}

      {/* 夜晚送来一点冷色光 */}
      {on && (
        <pointLight
          position={[0, -0.35, 0.55]}
          color="#cfe8ff"
          intensity={night ? 0.5 : 0.2}
          distance={2.8}
          decay={2}
        />
      )}
    </group>
  );
}

/** 空调冷风丝：三缕淡蓝薄纱向左下飘，循环 */
function Breeze() {
  const g = useRef<THREE.Group>(null);
  useFrame((state) => {
    const grp = g.current;
    if (!grp) return;
    const t = state.clock.elapsedTime;
    grp.children.forEach((c, i) => {
      const m = c as THREE.Mesh;
      m.position.y = -0.16 - ((t * 0.55 + i * 0.37) % 0.62) * 0.75;
      m.position.x = (i - 1) * 0.24 + Math.sin(t * 2.4 + i * 1.7) * 0.05;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.2 + Math.sin(t * 5 + i * 1.3) * 0.09;
    });
  });
  return (
    <group ref={g}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, -0.3, 0.3]} rotation={[0.5, 0, 0]}>
          <planeGeometry args={[0.07, 0.4]} />
          <meshBasicMaterial color="#e3f2ff" transparent opacity={0.16} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 毛绒兔玩偶（坐在床上/地上的软软兔） ----------------

export function PlushBunny3D({ col }: { col?: string }) {
  const fur = col ?? '#fdf9f4';
  const pink = '#f6c2cf';
  const blush = '#f7ccd6';
  return (
    <group>
      {/* 身体（胖乎乎水滴形） */}
      <mesh position={[0, 0.15, 0]} scale={[1, 0.95, 0.88]} castShadow>
        <sphereGeometry args={[0.15, 20, 16]} />
        <meshStandardMaterial color={fur} roughness={0.95} />
      </mesh>
      {/* 肚皮 */}
      <mesh position={[0, 0.14, 0.075]} scale={[1, 1.05, 0.55]}>
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshStandardMaterial color="#ffffff" roughness={0.95} />
      </mesh>
      {/* 头 */}
      <mesh position={[0, 0.37, 0.01]} castShadow>
        <sphereGeometry args={[0.125, 20, 16]} />
        <meshStandardMaterial color={fur} roughness={0.95} />
      </mesh>
      {/* 长耳朵 ×2（微外撇） */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0.05 * s, 0.55, -0.01]} rotation={[0.08, 0, 0.22 * s]}>
          <mesh scale={[1, 1, 0.62]}>
            <capsuleGeometry args={[0.036, 0.15, 6, 12]} />
            <meshStandardMaterial color={fur} roughness={0.95} />
          </mesh>
          <mesh position={[0, 0, 0.016]} scale={[0.62, 0.85, 0.4]}>
            <capsuleGeometry args={[0.026, 0.12, 4, 8]} />
            <meshStandardMaterial color={pink} roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* 眼睛 + 鼻子 + 腮红 */}
      {[-1, 1].map((s) => (
        <mesh key={`e${s}`} position={[0.048 * s, 0.39, 0.105]}>
          <sphereGeometry args={[0.015, 8, 8]} />
          <meshStandardMaterial color="#4a3f3a" roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 0.362, 0.122]}>
        <sphereGeometry args={[0.011, 8, 8]} />
        <meshStandardMaterial color={pink} roughness={0.6} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`b${s}`} position={[0.082 * s, 0.355, 0.088]} scale={[1, 0.7, 0.35]}>
          <sphereGeometry args={[0.026, 10, 8]} />
          <meshStandardMaterial color={blush} roughness={0.9} />
        </mesh>
      ))}
      {/* 小手（贴身） */}
      {[-1, 1].map((s) => (
        <mesh key={`a${s}`} position={[0.135 * s, 0.2, 0.03]} scale={[0.75, 1.15, 0.75]}>
          <sphereGeometry args={[0.05, 12, 10]} />
          <meshStandardMaterial color={fur} roughness={0.95} />
        </mesh>
      ))}
      {/* 脚丫（往前伸） */}
      {[-1, 1].map((s) => (
        <mesh key={`f${s}`} position={[0.075 * s, 0.055, 0.1]} scale={[1, 0.62, 1.3]}>
          <sphereGeometry args={[0.055, 12, 10]} />
          <meshStandardMaterial color={fur} roughness={0.95} />
        </mesh>
      ))}
      {/* 圆尾巴 */}
      <mesh position={[0, 0.1, -0.14]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial color="#ffffff" roughness={0.95} />
      </mesh>
    </group>
  );
}

// ---------------- 小黄鸭玩偶（床头柜摆件） ----------------

export function PlushDuck3D({ col }: { col?: string }) {
  const body = col ?? '#f7dc8f';
  return (
    <group>
      {/* 身体 */}
      <mesh position={[0, 0.105, 0]} scale={[1, 0.88, 1.1]} castShadow>
        <sphereGeometry args={[0.105, 18, 14]} />
        <meshStandardMaterial color={body} roughness={0.95} />
      </mesh>
      {/* 头 */}
      <mesh position={[0, 0.25, 0.012]} castShadow>
        <sphereGeometry args={[0.082, 18, 14]} />
        <meshStandardMaterial color={body} roughness={0.95} />
      </mesh>
      {/* 橙嘴 */}
      <mesh position={[0, 0.242, 0.088]} scale={[1.35, 0.5, 0.85]}>
        <sphereGeometry args={[0.028, 10, 8]} />
        <meshStandardMaterial color="#efaf62" roughness={0.7} />
      </mesh>
      {/* 眼睛 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.034 * s, 0.272, 0.07]}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshStandardMaterial color="#4a3f3a" roughness={0.4} />
        </mesh>
      ))}
      {/* 翅膀 ×2 */}
      {[-1, 1].map((s) => (
        <mesh key={`w${s}`} position={[0.098 * s, 0.115, 0]} rotation={[0, 0, 0.25 * s]} scale={[0.45, 0.85, 1.1]}>
          <sphereGeometry args={[0.05, 12, 10]} />
          <meshStandardMaterial color="#f2d07e" roughness={0.95} />
        </mesh>
      ))}
      {/* 翘尾巴 */}
      <mesh position={[0, 0.15, -0.105]} rotation={[-0.6, 0, 0]} scale={[1, 1, 0.6]}>
        <sphereGeometry args={[0.04, 10, 8]} />
        <meshStandardMaterial color={body} roughness={0.95} />
      </mesh>
    </group>
  );
}

// ---------------- 粉白梳妆台（桌面 + 椭圆镜 + 小圆凳） ----------------

export function Vanity3D({ col }: { col?: string }) {
  const white = '#fbfaf7';
  const frame = col ?? '#f3efe6';
  const pink = '#f6cdd6';
  const mirrorBlue = '#dfeaf0';
  return (
    <group>
      {/* 桌面 */}
      <mesh position={[0, 0.72, -0.125]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 0.05, 0.46]} />
        <meshStandardMaterial color={white} roughness={0.6} />
      </mesh>
      {/* 两侧板式桌腿 */}
      {[-1, 1].map((s) => (
        <mesh key={`l${s}`} position={[0.51 * s, 0.35, -0.125]} castShadow>
          <boxGeometry args={[0.05, 0.7, 0.42]} />
          <meshStandardMaterial color={white} roughness={0.7} />
        </mesh>
      ))}
      {/* 抽屉面板 + 拉手 */}
      <mesh position={[0, 0.615, 0.098]}>
        <boxGeometry args={[0.98, 0.13, 0.024]} />
        <meshStandardMaterial color={frame} roughness={0.75} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`k${s}`} position={[0.22 * s, 0.615, 0.118]}>
          <sphereGeometry args={[0.017, 10, 8]} />
          <meshStandardMaterial color="#d9cfb8" metalness={0.4} roughness={0.4} />
        </mesh>
      ))}

      {/* 椭圆镜（背倾 8°，细框圈住） */}
      <group position={[0, 1.12, -0.3]} rotation={[-0.14, 0, 0]}>
        <mesh scale={[1, 1.28, 1]}>
          <cylinderGeometry args={[0.2, 0.2, 0.018, 28]} />
          <meshStandardMaterial color={frame} roughness={0.75} />
        </mesh>
        <mesh position={[0, 0, 0.011]} scale={[1, 1.28, 1]}>
          <cylinderGeometry args={[0.172, 0.172, 0.014, 28]} />
          <meshStandardMaterial color={mirrorBlue} roughness={0.12} metalness={0.35} />
        </mesh>
        {/* 镜顶小蝴蝶结 */}
        <mesh position={[0, 0.262, 0.01]}>
          <sphereGeometry args={[0.024, 10, 8]} />
          <meshStandardMaterial color={pink} roughness={0.6} />
        </mesh>
      </group>
      {/* 镜子支撑柱 */}
      <mesh position={[0, 0.87, -0.275]}>
        <boxGeometry args={[0.06, 0.3, 0.035]} />
        <meshStandardMaterial color={frame} roughness={0.8} />
      </mesh>

      {/* 桌面小物：香水瓶 + 珍珠盒 */}
      <mesh position={[-0.32, 0.775, -0.1]} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 0.1, 12]} />
        <meshStandardMaterial color={pink} roughness={0.35} />
      </mesh>
      <mesh position={[-0.32, 0.84, -0.1]}>
        <sphereGeometry args={[0.018, 8, 8]} />
        <meshStandardMaterial color="#d9cfb8" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0.34, 0.775, -0.08]}>
        <sphereGeometry args={[0.05, 14, 12]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} />
      </mesh>

      {/* 小圆凳（粉垫白腿，位于桌前） */}
      <group position={[0, 0, 0.32]}>
        <mesh position={[0, 0.44, 0]} castShadow>
          <cylinderGeometry args={[0.165, 0.165, 0.05, 20]} />
          <meshStandardMaterial color={pink} roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.405, 0]}>
          <cylinderGeometry args={[0.15, 0.15, 0.025, 20]} />
          <meshStandardMaterial color={white} roughness={0.7} />
        </mesh>
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.11, 0.19, Math.sin(a) * 0.11]} castShadow>
              <cylinderGeometry args={[0.018, 0.014, 0.38, 10]} />
              <meshStandardMaterial color={white} roughness={0.7} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/** 无照片时的占位画（粉系渐变 + 爱心 + 提示字；wide 横版变体） */
function makePlaceholderTexture(wide = false): THREE.CanvasTexture {
  const W = wide ? 384 : 256;
  const H = wide ? 256 : 344;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#fdf4f5');
  g.addColorStop(1, '#f4dbe2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 爱心
  ctx.fillStyle = '#f2a9bc';
  const cx = wide ? W * 0.32 : W / 2;
  const cy = H * 0.42;
  const s = wide ? 30 : 34;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.4, cy - s * 0.2, cx - s * 0.6, cy - s * 1.2, cx, cy - s * 0.4);
  ctx.bezierCurveTo(cx + s * 0.6, cy - s * 1.2, cx + s * 1.4, cy - s * 0.2, cx, cy + s * 0.9);
  ctx.fill();
  // 小爱心点缀
  ctx.fillStyle = 'rgba(242,169,188,0.45)';
  for (const [dx, dy, r] of wide
    ? [[-70, -52, 9], [72, -40, 8], [64, 44, 8], [-58, 52, 7]]
    : [[-62, -70, 10], [58, -52, 8], [48, 66, 9], [-50, 78, 7]] as const) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 提示文字
  ctx.fillStyle = '#b07193';
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  if (wide) {
    ctx.fillText('点我传合照哦', W * 0.68, H * 0.52);
  } else {
    ctx.fillText('点我传', cx, H * 0.68);
    ctx.fillText('合照哦', cx, H * 0.68 + 40);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 照片 dataURL → texture（异步加载，变化时重建） */
function usePhotoTexture(photo?: string): THREE.Texture | null {
  const [texState, setTexState] = useState<{ photo: string; tex: THREE.Texture } | null>(null);
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
      setTexState({ photo, tex: t });
    };
    img.src = photo;
    return () => {
      alive = false;
    };
  }, [photo]);
  return texState && texState.photo === photo ? texState.tex : null;
}

export function PhotoFrame3D({ col, photo }: { col?: string; photo?: string }) {
  const placeholder = useMemo(() => makePlaceholderTexture(), []);
  const photoTex = usePhotoTexture(photo);
  const frameCol = col ?? '#f5f1e8';
  const frameDark = useMemo(() => new THREE.Color(frameCol).multiplyScalar(0.88), [frameCol]);

  return (
    <group>
      {/* 主背板（相片基底） */}
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[0.5, 0.72, 0.034]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} />
      </mesh>

      {/* 相片窗（3:4 竖幅） */}
      <mesh position={[0, 0.44, 0.019]}>
        <planeGeometry args={[0.4, 0.56]} />
        <meshStandardMaterial map={photoTex ?? placeholder} roughness={0.55} />
      </mesh>

      {/* 内衬细边（略凸出，相片压边感） */}
      <mesh position={[0, 0.44 + 0.295, 0.016]}>
        <boxGeometry args={[0.43, 0.028, 0.04]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.44 - 0.295, 0.016]}>
        <boxGeometry args={[0.43, 0.028, 0.04]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>
      <mesh position={[-0.209, 0.44, 0.016]}>
        <boxGeometry args={[0.028, 0.62, 0.04]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>
      <mesh position={[0.209, 0.44, 0.016]}>
        <boxGeometry args={[0.028, 0.62, 0.04]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>

      {/* 顶部小蝴蝶结装饰 */}
      <mesh position={[0, 0.8, 0.02]}>
        <sphereGeometry args={[0.032, 10, 8]} />
        <meshStandardMaterial color="#f2b3c2" roughness={0.6} />
      </mesh>

      {/* 斜撑脚架（背后） */}
      <mesh position={[0, 0.34, -0.12]} rotation={[-0.42, 0, 0]} castShadow>
        <boxGeometry args={[0.4, 0.56, 0.02]} />
        <meshStandardMaterial color={frameDark} roughness={0.85} />
      </mesh>
    </group>
  );
}

// ---------------- 挂墙相框（竖版 0.56×0.72 / 横版 1.1×0.7，贴墙平挂） ----------------

export function WallPhoto3D({ col, photo, wide }: { col?: string; photo?: string; wide?: boolean }) {
  const placeholder = useMemo(() => makePlaceholderTexture(wide), [wide]);
  const photoTex = usePhotoTexture(photo);
  const frameCol = col ?? '#f5f1e8';
  const frameDark = useMemo(() => new THREE.Color(frameCol).multiplyScalar(0.87), [frameCol]);

  const W = wide ? 1.1 : 0.56;
  const H = wide ? 0.7 : 0.72;
  const PW = wide ? 1.0 : 0.46;
  const PH = wide ? 0.6 : 0.6;
  const cy = H / 2;

  return (
    <group>
      {/* 主背板（贴墙） */}
      <mesh position={[0, cy, 0]} castShadow>
        <boxGeometry args={[W, H, 0.042]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} />
      </mesh>

      {/* 相片窗 */}
      <mesh position={[0, cy, 0.023]}>
        <planeGeometry args={[PW, PH]} />
        <meshStandardMaterial map={photoTex ?? placeholder} roughness={0.55} />
      </mesh>

      {/* 内衬细边 */}
      <mesh position={[0, cy + PH / 2 + 0.014, 0.02]}>
        <boxGeometry args={[PW + 0.05, 0.028, 0.05]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>
      <mesh position={[0, cy - PH / 2 - 0.014, 0.02]}>
        <boxGeometry args={[PW + 0.05, 0.028, 0.05]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>
      <mesh position={[-PW / 2 - 0.014, cy, 0.02]}>
        <boxGeometry args={[0.028, PH + 0.05, 0.05]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>
      <mesh position={[PW / 2 + 0.014, cy, 0.02]}>
        <boxGeometry args={[0.028, PH + 0.05, 0.05]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>

      {/* 顶部小蝴蝶结（竖版） / 角落小心心（横版） */}
      {wide ? (
        <mesh position={[-W / 2 + 0.09, cy + PH / 2 + 0.055, 0.026]} rotation={[0, 0, 0.3]} scale={[1, 0.85, 1]}>
          <sphereGeometry args={[0.026, 10, 8]} />
          <meshStandardMaterial color="#f2b3c2" roughness={0.6} />
        </mesh>
      ) : (
        <mesh position={[0, cy + H / 2 + 0.035, 0.02]}>
          <sphereGeometry args={[0.03, 10, 8]} />
          <meshStandardMaterial color="#f2b3c2" roughness={0.6} />
        </mesh>
      )}
    </group>
  );
}

// ---------------- 拍立得（白边厚相纸 + 胶带 + 小支架，微微倾角） ----------------

export function Polaroid3D({ col, photo }: { col?: string; photo?: string }) {
  const placeholder = useMemo(() => makePlaceholderTexture(false), []);
  const photoTex = usePhotoTexture(photo);
  const paper = col ?? '#fdfcf8';

  // 相纸 0.34×0.42：上边 0.03 / 侧边 0.03 / 下边 0.11（经典拍立得比例）
  const W = 0.34;
  const H = 0.42;
  const PH = 0.28;
  const cy = H / 2;

  return (
    <group rotation={[0, 0, 0.035]}>
      {/* 相纸主体 */}
      <mesh position={[0, cy, 0]} castShadow>
        <boxGeometry args={[W, H, 0.02]} />
        <meshStandardMaterial color={paper} roughness={0.85} />
      </mesh>
      {/* 方形相片窗 */}
      <mesh position={[0, cy + 0.035, 0.012]}>
        <planeGeometry args={[PH, PH]} />
        <meshStandardMaterial map={photoTex ?? placeholder} roughness={0.5} />
      </mesh>
      {/* 底部留白手写字（无照片时更俏皮；有照片时隐去） */}
      {!photo && (
        <mesh position={[0, cy - 0.115, 0.012]}>
          <planeGeometry args={[0.22, 0.05]} />
          <meshBasicMaterial color="#e8b7c4" transparent opacity={0.55} toneMapped={false} />
        </mesh>
      )}
      {/* 顶部胶带（微斜的半透米黄胶带） */}
      <mesh position={[0.01, H - 0.008, 0.006]} rotation={[0, 0, -0.12]}>
        <boxGeometry args={[0.12, 0.036, 0.004]} />
        <meshStandardMaterial color="#f4e8c8" roughness={0.5} transparent opacity={0.82} />
      </mesh>
      {/* 背后小支架（斜撑） */}
      <mesh position={[0, 0.16, -0.05]} rotation={[-0.5, 0, 0]} castShadow>
        <boxGeometry args={[0.24, 0.3, 0.012]} />
        <meshStandardMaterial color={paper} roughness={0.85} />
      </mesh>
    </group>
  );
}
