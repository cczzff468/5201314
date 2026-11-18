/** 拾光小屋 · 全屋 A* 网格寻路（v8.0 陪伴交互系统的物理层）
 *
 * 设计目标（避坑要求：防穿墙 + 防穿透家具）：
 * - 0.2m 网格覆盖七区域（客厅/卫生间/卧室/厨房/阳台 + v10 书房/花园）与门洞；
 * - 静态阻挡 = 墙段 AABB（Room.buildWallBoxes，含门洞缺口）+ 关闭的门洞补挡 + 家具脚印（膨胀 0.26 人身半径）；
 * - A* 8 方向（对角需两正交向可走，杜绝切角穿家具）→ 视线拉直（LOS 采样）输出稀疏路点；
 * - 目标点被挡时螺旋外扩找最近可站点（「走到沙发前」永远有解）。
 *
 * 房间图跨房间规划（ROOM_ADJ/planDoors/planRoute）自 HomeScene v7.1 迁移至此，
 * 由陪伴状态机（companion-rt）与漫游系统共用同一份实现，避免双份漂移。
 */

import * as THREE from 'three';
import {
  BAL_Z1,
  BATH_X0,
  BATH_X1,
  BED_X1,
  BED_Z0,
  BED_Z1,
  CATALOG,
  DOORS,
  GARDEN_X0,
  GARDEN_X1,
  GARDEN_Z0,
  GARDEN_Z1,
  KTCH_X1,
  ROOM_SPANS,
  ROOM_X,
  ROOM_Z,
  SRDOOR_Z,
  STUDY_X0,
  STUDY_X1,
  YDOOR_X,
  footprintOf,
  roomAt,
} from '../catalog';
import type { FurnitureItem, RoomId } from '../types';

/** 门开态 + 沿墙坐标（与 HomeScene.DoorLive 结构兼容；结构化类型避免循环依赖） */
export interface DoorGate {
  open: boolean;
  /** axis 'z' 墙 → x 坐标；axis 'x' 墙 → z 坐标 */
  along: number;
}

/** 平面点 */
export interface Pt {
  x: number;
  z: number;
}

// ---------------- 房间图跨房间规划（自 HomeScene v7.1 迁移） ----------------

/** 门 key：老四扇（bed/kt/bath/bal）+ v10 固定门位新两扇（sr 书房木门 / yd 花园栅栏门） */
export type DoorKey = 'bed' | 'kt' | 'bath' | 'bal' | 'sr' | 'yd';

/** 房间邻接图（树：客厅为中心；val = 连接两房间的门） */
export const ROOM_ADJ: Record<RoomId, Partial<Record<RoomId, DoorKey>>> = {
  lr: { br: 'bed', kt: 'kt', ba: 'bath', sr: 'sr' },
  br: { lr: 'bed', bal: 'bal' },
  kt: { lr: 'kt', yd: 'yd' },
  ba: { lr: 'bath' },
  bal: { br: 'bal' },
  sr: { lr: 'sr' },
  yd: { kt: 'yd' },
};

/** 门两侧路点离墙距离（穿门走廊的「踏板点」，DOOR_PASS=0.3 取 0.5 更稳） */
const DOOR_STEP = 0.5;

/** 门两侧的通行路点：aSide = 门北/西侧房间、bSide = 门南/东侧房间 */
export function doorPoints(d: DoorKey, along: number): { aSide: Pt; bSide: Pt } {
  if (d === 'bath') {
    // 客厅西 / 卫生间东（竖墙 x=BATH_X0）
    return { aSide: { x: BATH_X0 - DOOR_STEP, z: along }, bSide: { x: BATH_X0 + DOOR_STEP, z: along } };
  }
  if (d === 'sr') {
    // 书房西 / 客厅东（竖墙 x=STUDY_X1 = -ROOM_X；aSide = 书房侧）
    return { aSide: { x: STUDY_X1 - DOOR_STEP, z: along }, bSide: { x: STUDY_X1 + DOOR_STEP, z: along } };
  }
  if (d === 'yd') {
    // 厨房北 / 花园南（北栅栏 z=GARDEN_Z0；aSide = 厨房/走廊侧，踏板点落在厨房南墙门洞内）
    return { aSide: { x: along, z: GARDEN_Z0 - DOOR_STEP }, bSide: { x: along, z: GARDEN_Z0 + DOOR_STEP } };
  }
  // bed/kt：客厅北（z=BED_Z0）；bal：卧室北（z=BED_Z1）
  const wall = d === 'bal' ? BED_Z1 : BED_Z0;
  return { aSide: { x: along, z: wall - DOOR_STEP }, bSide: { x: along, z: wall + DOOR_STEP } };
}

/** BFS：from → to 的门序列（房间图是树，最多 3 扇门；不可达 = null 不可能发生） */
export function planDoors(from: RoomId, to: RoomId): DoorKey[] | null {
  if (from === to) return [];
  const prev = new Map<RoomId, { r: RoomId; d: DoorKey }>();
  const q: RoomId[] = [from];
  const seen = new Set<RoomId>([from]);
  while (q.length) {
    const cur = q.shift()!;
    for (const [nb, d] of Object.entries(ROOM_ADJ[cur])) {
      const nxt = nb as RoomId;
      if (seen.has(nxt)) continue;
      seen.add(nxt);
      prev.set(nxt, { r: cur, d: d as DoorKey });
      if (nxt === to) {
        const doors: DoorKey[] = [];
        let node: RoomId = to;
        while (node !== from) {
          const p = prev.get(node)!;
          doors.unshift(p.d);
          node = p.r;
        }
        return doors;
      }
      q.push(nxt);
    }
  }
  return null;
}

/** 生成跨房间路点：每扇门产出「进侧点 → 出侧点」；沿途任一门关着 → null（稍后再试）。
 *  doors 允许只传老四扇（Partial）：sr/yd 缺省视为关门，新房间不可达。 */
export function planRoute(from: RoomId, to: RoomId, doors: Partial<Record<DoorKey, DoorGate>>): Pt[] | null {
  const seq = planDoors(from, to);
  if (seq === null) return null;
  const pts: Pt[] = [];
  let cur = from;
  for (const d of seq) {
    const live = doors[d];
    if (!live?.open) return null;
    const { aSide, bSide } = doorPoints(d, live.along);
    // 进/出方向：aSide 恒为「北/西侧房间」（bath：lr；bal：br；bed/kt：lr；sr：书房；yd：厨房）——按 cur 是否在 a 侧分流
    const curIsA =
      d === 'sr'
        ? cur === 'sr'
        : d === 'yd'
          ? cur === 'kt'
          : d === 'bal'
            ? cur === 'br'
            : cur === 'lr';
    pts.push(curIsA ? aSide : bSide, curIsA ? bSide : aSide);
    // 经 d 门从 cur 走到的下一个房间
    const nxt = (Object.entries(ROOM_ADJ[cur]).find(([, dd]) => dd === d)?.[0] ?? 'lr') as RoomId;
    cur = nxt;
  }
  return pts;
}

// ---------------- 网格与阻挡 ----------------

/** 网格步长（米）：0.2 对 0.25 吸附家具更精细，全屋 ~3600 格 A* 毫秒级 */
export const CELL = 0.2;

/**
 * 网格世界范围（盖七区域外扩 0.4：客厅/卫生间/卧室/厨房/阳台 + v10 书房/花园）
 */
const GRID_X0 = STUDY_X0 - 0.4;
const GRID_X1 = Math.max(KTCH_X1, GARDEN_X1) + 0.4;
const GRID_Z0 = -ROOM_Z - 0.4;
const GRID_Z1 = Math.max(BAL_Z1, GARDEN_Z1) + 0.4;

/** 网格尺寸 */
const GW = Math.ceil((GRID_X1 - GRID_X0) / CELL);
const GH = Math.ceil((GRID_Z1 - GRID_Z0) / CELL);

/** 小人身体半径（阻挡膨胀量；与 collideAndClamp 的 0.2 家具膨胀同量级再富余一点） */
const BODY_PAD = 0.26;

/** 门洞半宽（关门补挡用，门板 0.94 宽 → 0.62 含框） */
const DOOR_HOLE_HALF = 0.62;
/** 墙体半厚（关门补挡块厚度） */
const WALL_T = 0.12;

/** 阻挡网格（Uint8：1 = 不可走） */
export interface BlockGrid {
  blocked: Uint8Array;
  /** 版本号（items/墙/门任一变化时递增，寻路缓存失效用） */
  ver: number;
}

let gridVer = 1;

/** 世界坐标 → 网格下标（越界返回 -1） */
function cellIdx(x: number, z: number): number {
  const i = Math.floor((x - GRID_X0) / CELL);
  const j = Math.floor((z - GRID_Z0) / CELL);
  if (i < 0 || j < 0 || i >= GW || j >= GH) return -1;
  return j * GW + i;
}

function cellCenter(i: number, j: number): Pt {
  return { x: GRID_X0 + (i + 0.5) * CELL, z: GRID_Z0 + (j + 0.5) * CELL };
}

/** AABB（含膨胀）覆盖的格子置阻挡 */
function blockBox(blocked: Uint8Array, x0: number, x1: number, z0: number, z1: number): void {
  const i0 = Math.max(0, Math.floor((x0 - GRID_X0) / CELL));
  const i1 = Math.min(GW - 1, Math.ceil((x1 - GRID_X0) / CELL));
  const j0 = Math.max(0, Math.floor((z0 - GRID_Z0) / CELL));
  const j1 = Math.min(GH - 1, Math.ceil((z1 - GRID_Z0) / CELL));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) blocked[j * GW + i] = 1;
  }
}

/**
 * 重建阻挡网格（HomeScene 在 items / 墙段 / 门态变化时调用，节流后毫秒级）：
 * - 墙段盒（buildWallBoxes 已含门洞缺口 + v10 书房三面外墙）膨胀 BODY_PAD；
 * - 关闭的门：门洞缺口处补一块「关门板」阻挡（开门 = 缺口可走）；含可滑行四扇（DOORS 表）
 *   与 v10 固定门位两扇（sr 书房门 / yd 花园栅栏门）；
 * - 花园栅栏（半高不挡视线，但挡寻路出界）：四边细阻挡条，北边留门洞（开门 = 缺口可走）；
 * - 家具脚印：非 flat、y≤0.45（地上物）膨胀 BODY_PAD。
 */
export function buildBlockGrid(items: FurnitureItem[], walls: THREE.Box3[], doors: Partial<Record<DoorKey, DoorGate>>): BlockGrid {
  const blocked = new Uint8Array(GW * GH);
  // ① 墙段（外扩身体半径）
  for (const b of walls) {
    blockBox(blocked, b.min.x - BODY_PAD, b.max.x + BODY_PAD, b.min.z - BODY_PAD, b.max.z + BODY_PAD);
  }
  // ② 关闭的门：把门洞缺口堵上（沿墙 ±0.62、墙厚方向 ±0.18）
  for (const d of DOORS) {
    if (doors[d.id]?.open) continue;
    const along = doors[d.id]?.along ?? d.def;
    if (d.axis === 'z') {
      blockBox(blocked, along - DOOR_HOLE_HALF, along + DOOR_HOLE_HALF, d.at - WALL_T, d.at + WALL_T);
    } else {
      blockBox(blocked, d.at - WALL_T, d.at + WALL_T, along - DOOR_HOLE_HALF, along + DOOR_HOLE_HALF);
    }
  }
  // ②b v10 固定门位两扇（不在可滑行 DOORS 表）：关门 → 堵门洞
  if (!doors.sr?.open) {
    blockBox(blocked, STUDY_X1 - WALL_T, STUDY_X1, SRDOOR_Z - DOOR_HOLE_HALF, SRDOOR_Z + DOOR_HOLE_HALF);
  }
  if (!doors.yd?.open) {
    blockBox(blocked, YDOOR_X - DOOR_HOLE_HALF, YDOOR_X + DOOR_HOLE_HALF, GARDEN_Z0 - WALL_T, GARDEN_Z0 + WALL_T);
  }
  // ②c 花园栅栏（挡寻路出界；北栅栏留门洞 x ∈ YDOOR_X ± DOOR_HOLE_HALF，开门 = 可穿）
  const F_T = 0.05; // 栅栏阻挡半厚
  blockBox(blocked, GARDEN_X0 - F_T, YDOOR_X - DOOR_HOLE_HALF, GARDEN_Z0 - F_T, GARDEN_Z0 + F_T); // 北栅栏·西段
  blockBox(blocked, YDOOR_X + DOOR_HOLE_HALF, GARDEN_X1 + F_T, GARDEN_Z0 - F_T, GARDEN_Z0 + F_T); // 北栅栏·东段
  blockBox(blocked, GARDEN_X0 - F_T, GARDEN_X1 + F_T, GARDEN_Z1 - F_T, GARDEN_Z1 + F_T); // 南栅栏
  blockBox(blocked, GARDEN_X0 - F_T, GARDEN_X0 + F_T, GARDEN_Z0 - F_T, GARDEN_Z1 + F_T); // 西栅栏
  blockBox(blocked, GARDEN_X1 - F_T, GARDEN_X1 + F_T, GARDEN_Z0 - F_T, GARDEN_Z1 + F_T); // 东栅栏
  // ③ 家具脚印
  for (const it of items) {
    const e = CATALOG[it.kind];
    if (!e || e.flat) continue;
    if ((it.y ?? 0) > 0.45) continue; // 桌上物/上墙件不挡路
    const [w, d] = footprintOf(e, it.ry ?? 0);
    blockBox(blocked, it.x - w / 2 - BODY_PAD, it.x + w / 2 + BODY_PAD, it.z - d / 2 - BODY_PAD, it.z + d / 2 + BODY_PAD);
  }
  return { blocked, ver: ++gridVer };
}

/** 格子是否可走 */
function freeAt(blocked: Uint8Array, i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= GW || j >= GH) return false;
  return blocked[j * GW + i] === 0;
}

/** 世界点是否可走（越界 = 不可走） */
function freeWorld(blocked: Uint8Array, x: number, z: number): boolean {
  const idx = cellIdx(x, z);
  if (idx < 0) return false;
  return blocked[idx] === 0;
}

/** 螺旋外扩找 (x,z) 附近最近可走点（找不到返回原点） */
export function nearestFree(blocked: Uint8Array, x: number, z: number): Pt {
  if (freeWorld(blocked, x, z)) return { x, z };
  for (let r = 1; r <= 14; r++) {
    for (let k = 0; k < 24; k++) {
      const ang = (k / 24) * Math.PI * 2;
      const px = x + Math.cos(ang) * r * CELL;
      const pz = z + Math.sin(ang) * r * CELL;
      if (freeWorld(blocked, px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

/** 线段采样：a→b 沿途全部可走（含两端；步长 CELL/2） */
function segmentFree(blocked: Uint8Array, a: Pt, b: Pt): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(d / (CELL / 2)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    if (!freeWorld(blocked, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

// ---------------- A* 搜索 ----------------

/** A* 开放节点 */
interface Node {
  i: number;
  j: number;
  g: number;
  f: number;
  parent: number; // 平铺数组下标；-1 = 起点
}

const DIRS: [number, number, number][] = [
  // [di, dj, cost]：四正向 + 四对角（对角 1.414）
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * A* 全屋寻路：返回稀疏路点（已拉直、不含起点、含终点）。
 * 目标被挡 → 自动落点最近可走格；不可达 / 起点越界 → null。
 */
export function findPath(grid: BlockGrid, from: Pt, to: Pt): Pt[] | null {
  const { blocked } = grid;
  const startFree = nearestFree(blocked, from.x, from.z);
  const goalFree = nearestFree(blocked, to.x, to.z);
  const si = Math.floor((startFree.x - GRID_X0) / CELL);
  const sj = Math.floor((startFree.z - GRID_Z0) / CELL);
  const gi = Math.floor((goalFree.x - GRID_X0) / CELL);
  const gj = Math.floor((goalFree.z - GRID_Z0) / CELL);
  if (si < 0 || sj < 0 || si >= GW || sj >= GH) return null;
  if (gi < 0 || gj < 0 || gi >= GW || gj >= GH) return null;
  if (!freeAt(blocked, si, sj) || !freeAt(blocked, gi, gj)) return null;
  if (si === gi && sj === gj) return [{ x: goalFree.x, z: goalFree.z }];

  // 平铺数组 A*（gScore/parent 用 Map，规模 ~3.6k 格无压力）
  const key = (i: number, j: number) => j * GW + i;
  const gScore = new Map<number, number>();
  const parent = new Map<number, number>();
  const open: Node[] = [];
  const h = (i: number, j: number): number => {
    const dx = Math.abs(i - gi);
    const dj = Math.abs(j - gj);
    return Math.max(dx, dj) + (Math.SQRT2 - 1) * Math.min(dx, dj);
  };
  gScore.set(key(si, sj), 0);
  open.push({ i: si, j: sj, g: 0, f: h(si, sj), parent: -1 });
  const closed = new Set<number>();
  let found = false;
  let iter = 0;
  while (open.length > 0 && iter++ < 9000) {
    // 取 f 最小（线性扫：开放集通常很小）
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.i, cur.j);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (cur.i === gi && cur.j === gj) {
      found = true;
      break;
    }
    for (const [di, dj, cost] of DIRS) {
      const ni = cur.i + di;
      const nj = cur.j + dj;
      if (!freeAt(blocked, ni, nj)) continue;
      // 对角禁止切角：两正交向必须都可走
      if (di !== 0 && dj !== 0 && (!freeAt(blocked, cur.i + di, cur.j) || !freeAt(blocked, cur.i, cur.j + dj))) continue;
      const nk = key(ni, nj);
      if (closed.has(nk)) continue;
      const ng = cur.g + cost;
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        parent.set(nk, ck);
        open.push({ i: ni, j: nj, g: ng, f: ng + h(ni, nj), parent: -1 });
      }
    }
  }
  if (!found) return null;
  // 回溯（世界坐标格心）
  const cells: Pt[] = [];
  let ck = key(gi, gj);
  while (ck !== key(si, sj)) {
    const i = ck % GW;
    const j = Math.floor(ck / GW);
    cells.push(cellCenter(i, j));
    const p = parent.get(ck);
    if (p === undefined) return null;
    ck = p;
  }
  cells.reverse();
  // 终点精确到目标（nearestFree 已保证可走）
  if (cells.length > 0) cells[cells.length - 1] = goalFree;
  // 视线拉直：贪心跳过共线点
  const out: Pt[] = [];
  let curPt = startFree;
  let idx = 0;
  while (idx < cells.length) {
    let far = idx;
    for (let k = idx; k < cells.length; k++) {
      if (segmentFree(blocked, curPt, cells[k])) far = k;
      else break;
    }
    out.push(cells[far]);
    curPt = cells[far];
    idx = far + 1;
  }
  return out;
}

/** 指定房间内一个随机可走落点（寻路目标用；20 次尝试，兜底房间中心外扩） */
export function randPointInRoomFree(grid: BlockGrid, room: RoomId): Pt {
  const [x0, x1, z0, z1] = ROOM_SPANS[room];
  for (let k = 0; k < 20; k++) {
    const x = x0 + Math.random() * (x1 - x0);
    const z = z0 + Math.random() * (z1 - z0);
    if (freeWorld(grid.blocked, x, z)) return { x, z };
  }
  return nearestFree(grid.blocked, (x0 + x1) / 2, (z0 + z1) / 2);
}

/** 当前所在房间（roomAt 包装：恒有值；含 v10 书房/花园） */
export function roomOf(x: number, z: number): RoomId {
  return roomAt(x, z);
}
