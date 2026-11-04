/**
 * 情侣小家 3D —— Kenney GLB 模型加工工具（白色系 v4）
 *
 * 1) 白色主调重着色：以白 / 暖白为主，点缀浅灰 / 浅粉 / 浅黄 / 柔黑 / 鼠尾草绿，
 *    不再使用木色（用户指定：白色可以和其他颜色混着，简约大气）；
 * 2) 归一化：按包围盒把模型放到「底部贴地、XZ 居中」并统一放大 MODEL_SCALE；
 * 3) 门轴装配：doorLeft/doorRight/door… 等独立门节点包进 pivot 组放在铰链边；
 * 4) 用户调色：tint 选项对「主体材质」按所选颜色重着色（保留植物绿 / 灯罩黄 / 柔黑
 *    等点缀色，形成白 + 彩的混搭感）。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_SCALE } from '../catalog';

// ---------------- 白色系调色板 ----------------

/** 材质名 → 白色系颜色（主白 + 少量点缀） */
const PALETTE: Record<string, number> = {
  // 主体一律白系
  wood: 0xf7f4ee, // 云白（原木框架 → 白）
  woodDark: 0xe4e1da, // 浅暖灰（次级框架）
  carpet: 0xfdfcf9, // 覆盖白（坐垫主体）
  carpetDarker: 0xe9e6df, // 浅灰白（坐垫阴影）
  carpetWhite: 0xfffefb, // 纯白
  metal: 0xf1efeb, // 亮白金属
  metalLight: 0xfbfaf6, // 白
  metalMedium: 0xd6d4cf, // 浅灰（桌面 / 台面）
  metalDark: 0x43464b, // 柔黑（支脚 / 点缀）
  // 点缀色（偶尔的个别色）
  plant: 0xa8d8bb, // 鼠尾草绿（植物保持自然绿）
  lamp: 0xffe9ac, // 浅黄灯罩
  glass: 0xeef0ec, // 雾白玻璃
  fur: 0xf3ece0, // 奶油白（小熊）
};

/** 兜底：未知材质 → 原色降饱和提亮为白系 */
function fallbackLighten(c: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(hsl.s, 0.12), THREE.MathUtils.lerp(hsl.l, 0.9, 0.6));
  return c;
}

/** 可被用户调色重着色的「主体材质」 */
const TINTABLE = new Set(['wood', 'woodDark', 'carpet', 'carpetDarker', 'carpetWhite', 'metal', 'metalLight', 'metalMedium', 'fur']);

/** 对单个材质应用用户色（保持明暗层次，混出高级感） */
function tintMaterial(mat: THREE.MeshStandardMaterial, hex: string, role: string): void {
  const c = new THREE.Color(hex);
  switch (role) {
    case 'woodDark':
    case 'carpetDarker':
      c.multiplyScalar(0.86); // 次级框架压暗一档
      break;
    case 'metal':
    case 'metalMedium': {
      // 金属面：混 18% 浅灰，避免大面积高饱和
      const gray = new THREE.Color(0xd8d6d1);
      c.lerp(gray, 0.18);
      break;
    }
    case 'carpetWhite':
      c.lerp(new THREE.Color(0xffffff), 0.25); // 坐垫提亮
      break;
    default:
      break;
  }
  mat.color = c;
}

/** 共享调色板材质缓存（同材质名全屋共享；toggle / tint 家具由调用方 clone） */
const sharedMats = new Map<string, THREE.MeshStandardMaterial>();

export function paletteMaterial(name: string, baseColor?: THREE.Color): THREE.MeshStandardMaterial {
  const cached = sharedMats.get(name);
  if (cached) return cached;
  const hex = PALETTE[name];
  const color =
    hex !== undefined ? new THREE.Color(hex) : fallbackLighten((baseColor ?? new THREE.Color(0xefede7)).clone());
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
  mat.name = name; // 克隆后仍可按名识别（灯罩发光用）
  sharedMats.set(name, mat);
  return mat;
}

/** 材质是否为灯罩/屏幕（toggle 家具要克隆它以便单独发光） */
export function isGlowMaterial(name: string): boolean {
  return name === 'lamp' || name === 'glass';
}

// ---------------- GLB 加载器 ----------------

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
/** 原始场景缓存（loadModel 后写入，供 cloneFurniture 同步取用） */
const protoMap = new Map<string, THREE.Group>();

/** 加载并缓存原始场景（共享，禁止直接挂树；用 cloneFurniture 复制实例） */
export function loadModel(url: string): Promise<THREE.Group> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<THREE.Group>((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const scene = gltf.scene as unknown as THREE.Group;
          protoMap.set(url, scene);
          resolve(scene);
        },
        undefined,
        reject,
      );
    });
    cache.set(url, p);
  }
  return p;
}

/** 预加载（商店等提前暖缓存） */
export function preloadModel(url: string): void {
  loadModel(url).catch(() => {});
}

/** 加载并登记 proto（cloneFurniture 前必须先调用） */
export function ensureModel(url: string): Promise<THREE.Group> {
  return loadModel(url);
}

/** 模型是否已加载完毕（商城缩略图捕获前轮询用） */
export function isModelReady(url: string): boolean {
  return protoMap.has(url);
}

// ---------------- 归一化与克隆 ----------------

export interface FurnModel {
  /** 模型根（已贴地居中，直接挂到家具组即可） */
  root: THREE.Group;
  /** 归一化后的包围盒尺寸（米） */
  size: THREE.Vector3;
  /** 门轴 pivot 列表（已 attach 门节点） */
  doors: DoorPivot[];
}

export interface DoorPivot {
  /** 基础名（doorLeft / doorRight / door / doorFridge / doorFreezer / washerDoor…） */
  base: string;
  pivot: THREE.Group;
  /** 目标开角（弧度，含正负） */
  swing: number;
}

/**
 * 克隆 + 归一化一个家具模型（须先 await loadModel(url)）：
 * - scale = MODEL_SCALE（可叠加 opts.scale 非均匀缩放：用于拉宽电视柜等单件适配）；
 *   底部贴地（minY → 0）、XZ 居中；
 * - 材质替换为白色系（cloneMats=true 时每实例独立材质，供发光调光）；
 * - tint 时主体材质按用户色重着色（点缀色保留）；
 * - 门节点装配 pivot。
 */
export function cloneFurniture(
  url: string,
  opts: { cloneMats?: boolean; yaw?: number; tint?: string; scale?: [number, number, number] } = {},
): FurnModel {
  const proto = protoMap.get(url);
  if (!proto) throw new Error(`model not loaded: ${url}`);

  const root = new THREE.Group();
  const inner = proto.clone(true);

  // 归一化：贴地 + XZ 居中 + 放大（可选非均匀乘子）
  const [sx, sy, sz] = opts.scale ?? [1, 1, 1];
  const box = new THREE.Box3().setFromObject(inner);
  const size = box
    .getSize(new THREE.Vector3())
    .multiplyScalar(MODEL_SCALE)
    .multiply(new THREE.Vector3(sx, sy, sz));
  const center = box.getCenter(new THREE.Vector3());
  inner.scale.set(MODEL_SCALE * sx, MODEL_SCALE * sy, MODEL_SCALE * sz);
  inner.position.set(-center.x * MODEL_SCALE * sx, -box.min.y * MODEL_SCALE * sy, -center.z * MODEL_SCALE * sz);
  root.add(inner);
  inner.updateMatrixWorld(true); // D4：微件测量前刷新世界矩阵（克隆后 matrixWorld 已过期）

  // 材质替换（白色系 + 可选用户色）
  const needClone = !!opts.cloneMats || !!opts.tint;
  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // D4 性能：微小组件（拉手/铰链/小脚等 <12cm）不投影 —— 阴影 pass 少一半 draw call，
    // 视觉上几乎无差别（影子仍由家具主体投出）；接收阴影保留
    m.castShadow = true;
    m.receiveShadow = true;
    const geo = m.geometry;
    if (geo) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      if (geo.boundingBox) {
        tmpBox.copy(geo.boundingBox).applyMatrix4(m.matrixWorld);
        tmpBox.getSize(tmpSize);
        if (Math.max(tmpSize.x, tmpSize.y, tmpSize.z) * MODEL_SCALE < 0.12) m.castShadow = false;
      }
    }
    const src = m.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    const mapOne = (mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
      const name = mat.name || 'default';
      const base = paletteMaterial(name, mat.color);
      if (needClone) {
        const own = base.clone();
        if (opts.tint && TINTABLE.has(name)) tintMaterial(own, opts.tint, name);
        return own;
      }
      return base;
    };
    m.material = Array.isArray(src) ? src.map(mapOne) : mapOne(src);
  });

  if (opts.yaw) inner.rotation.y = opts.yaw;

  // 门轴装配
  const doors = buildDoorPivots(root);

  return { root, size, doors };
}

// ---------------- 门轴装配 ----------------

const DOOR_SWING = 1.85; // ~106° 开角

/** mesh 名 → 门基础名（Mesh_doorLeft_1 → doorLeft；Mesh_door → door） */
function doorBase(name: string): string | null {
  const m = /^Mesh_(door[A-Za-z]*)(?:_\d+)?$/.exec(name);
  if (!m) return null;
  return m[1] || 'door';
}

/** 把模型里名字含 door 的 mesh 按基础名分组，包进铰链 pivot */
function buildDoorPivots(root: THREE.Group): DoorPivot[] {
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const base = doorBase(mesh.name);
    if (!base) return;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push(mesh);
  });

  const doors: DoorPivot[] = [];
  for (const [base, meshes] of groups) {
    if (meshes.length === 0) continue;
    // 合并包围盒（root 本地坐标；先更新世界矩阵保证 expandByObject 准确）
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const mesh of meshes) box.expandByObject(mesh);
    if (box.isEmpty()) continue;

    const hingeLeft = !/right/i.test(base);
    const pivot = new THREE.Group();
    pivot.position.set(hingeLeft ? box.min.x : box.max.x, 0, (box.min.z + box.max.z) / 2);
    root.add(pivot);
    for (const mesh of meshes) pivot.attach(mesh);

    // 左铰链门向外开（+角），右铰链门对称（-角）
    const swing = (hingeLeft ? 1 : -1) * DOOR_SWING;
    doors.push({ base, pivot, swing });
  }
  return doors;
}

/** 门轴开合动画（useFrame 里调用；返回是否仍在动画中） */
export function animateDoors(doors: DoorPivot[], open: boolean, dt: number): boolean {
  let busy = false;
  for (const d of doors) {
    const target = open ? d.swing : 0;
    const cur = d.pivot.rotation.y;
    const next = THREE.MathUtils.damp(cur, target, 8, dt);
    if (Math.abs(next - cur) > 1e-4) busy = true;
    d.pivot.rotation.y = next;
  }
  return busy;
}
