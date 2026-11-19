'use client';

/**
 * 情侣小家 3D —— 商城 1:1 家具缩略图（离屏 R3F 画布逐件渲染快照）
 *
 * - 商城打开时挂载一块隐藏画布（viewport 外，pointer-events 关闭）；
 * - 父组件每次只传一个待处理 kind：把家具挂进画布 → 等模型就绪 → 包围盒自适应取景
 *   → gl.render 后同步 toDataURL 存 PNG（透明底）→ 回调父组件缓存并推进下一件；
 * - 程序化家具（电视/空调/相框/玩偶）直接复用 Furn3D，与实机 1:1 同渲染路径。
 * - 套装缩略图（F3）：kind 传 `set:${套装id}`，整组按预设相对位落进画布一次成型，
 *   偏俯拍视角让整套布局一目了然；缓存键即 `set:${id}`。
 */

import { useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CATALOG, FURN_SETS } from '../catalog';
import type { FurnitureItem } from '../types';
import { isModelReady } from './model-kit';
import Furn3D from './Furn3D';

/** 会话级缩略图缓存（模块级，跨商店开合保留；单件 kind 与 `set:${id}` 共用一个命名空间） */
const MEM = new Map<string, string>();

export function getCachedThumb(kind: string): string | undefined {
  return MEM.get(kind);
}

const noop = () => {};

/** 解析目标：`set:xxx` = 套装合成，否则单件目录条目 */
function parseTarget(kind: string):
  | { mode: 'single'; entry: (typeof CATALOG)[string] }
  | { mode: 'set'; set: (typeof FURN_SETS)[number] }
  | null {
  if (kind.startsWith('set:')) {
    const set = FURN_SETS.find((s) => s.id === kind.slice(4));
    return set ? { mode: 'set', set } : null;
  }
  const entry = CATALOG[kind];
  return entry ? { mode: 'single', entry } : null;
}

/** 目标涉及的全部目录条目（套装 = 整组；等待 GLB 就绪用） */
function entriesOf(kind: string): (typeof CATALOG)[string][] {
  const t = parseTarget(kind);
  if (!t) return [];
  return t.mode === 'set' ? t.set.items.map((si) => CATALOG[si.kind]).filter(Boolean) : [t.entry];
}

/** 目标的落位实例清单（套装按预设相对位；单件原点） */
function itemsOf(kind: string): FurnitureItem[] {
  const t = parseTarget(kind);
  if (!t) return [];
  if (t.mode === 'single') {
    return [{ id: `thumb-${kind}`, kind: t.entry.kind, x: 0, z: 0, st: {} } as FurnitureItem];
  }
  return t.set.items.map((si, i) =>
    ({
      id: `thumb-${kind}-${i}`,
      kind: si.kind,
      x: si.dx,
      z: si.dz,
      y: si.y,
      ry: si.ry,
      st: {},
    }) as FurnitureItem,
  );
}

/** 单个目标捕获器：模型就绪后取景 → 渲染 → 截图 → 上报 */
function Capturer({
  kind,
  groupRef,
  onDone,
}: {
  kind: string;
  groupRef: React.RefObject<THREE.Group | null>;
  onDone: (url: string | null) => void;
}) {
  const { camera, gl, scene } = useThree();
  const f = useRef(0);
  const done = useRef(false);

  useFrame(() => {
    if (done.current) return;
    f.current++;
    const entries = entriesOf(kind);
    if (!entries.length) {
      if (f.current > 30) {
        done.current = true;
        onDone(null);
      }
      return;
    }
    const ready = entries.every((e) => !e?.glb || isModelReady(e.glb));
    // 就绪后多等几帧让 Furn3D 的异步 clone 挂载；加载失败/超时也放行（跳过）
    if (!(ready && f.current > 5) && f.current < 600) return;
    done.current = true;

    try {
      const grp = groupRef.current;
      if (!grp) {
        onDone(null);
        return;
      }
      const box = new THREE.Box3().setFromObject(grp);
      if (box.isEmpty()) {
        onDone(null);
        return;
      }
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      // 包围球半径 → 视野内刚好放下（留边距；套装更宽再放宽一点）
      const isSet = kind.startsWith('set:');
      const radius = Math.max(size.x, size.y * 1.15, size.z) * 0.5;
      const dir =
        isSet || entries[0]?.flat
          ? new THREE.Vector3(0.4, 1.05, 0.82).normalize() // 套装/地毯类：偏俯视，布局一目了然
          : new THREE.Vector3(0.85, 0.52, 1.05).normalize(); // 常规 3/4 视角
      const fov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
      const dist = (radius / Math.sin(fov / 2)) * (isSet ? 1.22 : 1.1);
      camera.position.copy(center).addScaledVector(dir, dist);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      gl.render(scene, camera);
      onDone(gl.domElement.toDataURL('image/png'));
    } catch {
      onDone(null);
    }
  });
  return null;
}

/** 隐藏画布：父组件每次传入一个待快照目标（kind 或 `set:${id}`），完成后回调并换下一件 */
export default function ShopThumbStudio({
  kind,
  onThumb,
}: {
  kind: string;
  onThumb: (kind: string, url: string) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const items = itemsOf(kind);
  if (!items.length) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: -9999,
        top: 0,
        width: 224,
        height: 224,
        pointerEvents: 'none',
        opacity: 1,
      }}
    >
      <Canvas
        dpr={1}
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: 34, near: 0.05, far: 60, position: [2.4, 1.7, 3] }}
      >
        <ambientLight intensity={1.05} />
        <hemisphereLight args={['#fff7ea', '#d9d2c4', 0.55]} />
        <directionalLight position={[3, 5, 4]} intensity={1.35} />
        <directionalLight position={[-3, 2, -3]} intensity={0.45} />
        <group ref={groupRef}>
          {items.map((item) => (
            <Furn3D
              key={item.id}
              item={item}
              entry={CATALOG[item.kind]}
              night={false}
              mode="live"
              selected={false}
              onPointerDown={noop}
              onTap={noop}
            />
          ))}
        </group>
        <Capturer
          key={kind}
          kind={kind}
          groupRef={groupRef}
          onDone={(url) => onThumb(kind, url ?? '')}
        />
      </Canvas>
    </div>
  );
}
