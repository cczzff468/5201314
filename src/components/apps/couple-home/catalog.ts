'use client';

/**
 * 情侣小家 3D v5 —— 家具目录 / 默认布局 / 持久化（两室一厅）
 *
 * - 模型：Kenney Furniture Kit 2.0（CC0）白色系重着色（云白主体 + 浅灰/浅粉/浅黄/柔黑点缀，无木色）；
 * - MODEL_SCALE = 2.0：家具更饱满大气；fp 脚印 = 实测包围盒（含缩放）；
 * - 户型：客厅 9×6（北）+ 卧室 6×5（南），中间隔墙带门（点击开门后小人可走进卧室）；
 * - 新增：立体壁挂空调（客厅/卧室）/ 立式相框（手机上传照片，永久保存）/ 毛绒玩偶 / 梳妆台；
 * - 金币系统已移除（家具随便买随便摆）；
 * - 持久化：IndexedDB 即时缓存 + Prisma 服务端快照（rev 乐观并发）。
 */

import { kvGet, kvSet, kvSetDebounced } from '@/lib/ios/idb-kv';
import { getWorkspaceId } from '@/lib/ios/workspace';
import type { CatalogEntry, FurnitureItem, FurnitureKind, HomeState, RoomId } from './types';

// ---------------- 世界常量 ----------------

/** 房间宽（米，x 轴） */
export const ROOM_W = 9;
/** 房间深（米，z 轴） */
export const ROOM_D = 6;
/** 墙高（米） */
export const WALL_H = 2.4;
/** 墙厚 */
export const WALL_T = 0.12;
/** 模型统一放大倍数（v4：比 v3 再大一档，更饱满大气） */
export const MODEL_SCALE = 2.0;
/** 编辑模式拖拽吸附（米） */
export const SNAP = 0.25;
/** 小人行走边界内缩 */
export const WALK_MARGIN = 0.4;
/** 小人身高（米） */
export const CHAR_H = 0.95;
/** 家具俯仰旋转上限（弧度，≈±60°） */
export const TILT_LIMIT = 1.05;

export const ROOM_X = ROOM_W / 2;
export const ROOM_Z = ROOM_D / 2;

// ---------------- 卧室（v5 两室一厅） ----------------

/** 卧室西缘（与客厅西墙齐平） */
export const BED_X0 = -ROOM_X;
/** 卧室东缘 */
export const BED_X1 = 1.5;
/** 卧室北缘（= 客厅南墙，隔墙所在） */
export const BED_Z0 = ROOM_Z;
/** 卧室南缘 */
export const BED_Z1 = BED_Z0 + 5;
export const BED_W = BED_X1 - BED_X0;
export const BED_D = BED_Z1 - BED_Z0;
/** 卧室门洞中心（在隔墙上） */
export const DOOR_X = -2.5;
/** 门洞宽（米） */
export const DOOR_W = 0.94;
/** 门洞高（米） */
export const DOOR_H = 2.06;
/** 门走廊半宽（小人穿门判定，比门洞略窄） */
export const DOOR_PASS = 0.3;

// ---------------- 厨房（v5.2 第三房间：卧室东侧） ----------------

/** 厨房西缘（= 卧室东墙，共墙） */
export const KTCH_X0 = BED_X1;
/** 厨房东缘 */
export const KTCH_X1 = 7.5;
/** 厨房北缘（= 客厅南墙延长线，带门洞通客厅） */
export const KTCH_Z0 = ROOM_Z;
/** 厨房南缘（= 卧室南墙齐平） */
export const KTCH_Z1 = BED_Z1;
export const KTCH_W = KTCH_X1 - KTCH_X0;
/** 厨房门洞中心（在厨房北墙上） */
export const KDOOR_X = 2.9;

// ---------------- 卫生间（v5.4：客厅东侧，推门而入） ----------------

/** 卫生间西缘（= 客厅东墙，共墙带门） */
export const BATH_X0 = ROOM_X;
/** 卫生间东缘 */
export const BATH_X1 = 8.5;
/** 卫生间北缘（= 客厅北墙延长线） */
export const BATH_Z0 = -ROOM_Z;
/** 卫生间南缘（= 客厅南墙延长线 / 厨房东侧延长） */
export const BATH_Z1 = ROOM_Z;
export const BATH_W = BATH_X1 - BATH_X0;
export const BATH_D = BATH_Z1 - BATH_Z0;
/** 卫生间门洞中心（在客厅东墙上，沿 z 滑动） */
export const BDOOR_Z = 0.3;

// ---------------- 阳台（v5.7：卧室南侧，休闲阳台） ----------------

/** 阳台西缘（与卧室/客厅西墙齐平） */
export const BAL_X0 = BED_X0;
/** 阳台东缘（= 卧室东墙延长线） */
export const BAL_X1 = BED_X1;
/** 阳台北缘（= 卧室南墙外皮，门所在） */
export const BAL_Z0 = BED_Z1;
/** 阳台南缘（外墙/栏杆） */
export const BAL_Z1 = BED_Z1 + 2.5;
export const BAL_W = BAL_X1 - BAL_X0;
export const BAL_D = BAL_Z1 - BAL_Z0;

// ---------------- 书房（v10 扩建：客厅西侧 annex） ----------------

/** 书房西缘（外墙） */
export const STUDY_X0 = -8.5;
/** 书房东缘（= 客厅西墙，共墙带门洞） */
export const STUDY_X1 = -ROOM_X;
/** 书房北缘（= 客厅北墙延长线） */
export const STUDY_Z0 = -ROOM_Z;
/** 书房南缘（= 客厅南墙延长线） */
export const STUDY_Z1 = ROOM_Z;
export const STUDY_W = STUDY_X1 - STUDY_X0;
export const STUDY_D = STUDY_Z1 - STUDY_Z0;
/**
 * 书房门洞中心（客厅西墙 x=-ROOM_X 上，沿 z 滑不了、固定位）。
 * 取 0.7 而非 0.3：避让客厅西壁已挂的投影幕布（fp 至 z=0.65）与壁炉
 * （fp 自 z=1.11 起，外扩阻挡自 z=0.91 起）——门洞 [0.23, 1.17] 与两者都只余最小视觉搭接。
 */
export const SRDOOR_Z = 0.7;

// ---------------- 花园（v10 扩建：厨房南侧露天） ----------------

/** 花园西缘（= 阳台东墙延长线，栅栏） */
export const GARDEN_X0 = BED_X1;
/** 花园东缘（栅栏） */
export const GARDEN_X1 = 8.5;
/** 花园北缘（栅栏；厨房南墙 z=8 外侧留 0.5m 走廊接门洞） */
export const GARDEN_Z0 = 8.5;
/** 花园南缘（栅栏） */
export const GARDEN_Z1 = 12.5;
export const GARDEN_W = GARDEN_X1 - GARDEN_X0;
export const GARDEN_D = GARDEN_Z1 - GARDEN_Z0;
/** 花园栅栏门中心（北栅栏上，与厨房南墙新门洞对齐，沿 x 固定位） */
export const YDOOR_X = 4.5;

/** 六房间归属：北排西段=书房（x 越过客厅西墙）；北排东段=卫生间；z<隔墙=客厅；隔墙南、卧室东墙西=卧室；
 * z 超过卧室南墙且在西侧=阳台；卧室东墙以东、厨房南墙外（z>8）=花园；其余东侧=厨房 */
export function roomAt(x: number, z: number): RoomId {
  if (z < BED_Z0) {
    if (x < STUDY_X1 - WALL_T / 2) return 'sr';
    return x >= BATH_X0 ? 'ba' : 'lr';
  }
  if (x < BED_X1) return z > BED_Z1 + 0.01 ? 'bal' : 'br';
  return z > BED_Z1 ? 'yd' : 'kt';
}

/** 各房间随机落点范围（x0,x1,z0,z1，已内缩防贴墙） */
export const ROOM_SPANS: Record<RoomId, [number, number, number, number]> = {
  lr: [-ROOM_X + 0.5, ROOM_X - 0.5, -ROOM_Z + 0.5, BED_Z0 - 0.5],
  br: [-ROOM_X + 0.5, BED_X1 - 0.5, BED_Z0 + 0.5, BED_Z1 - 0.5],
  kt: [BED_X1 + 0.5, KTCH_X1 - 0.5, BED_Z0 + 0.5, BED_Z1 - 0.5],
  ba: [BATH_X0 + 0.5, BATH_X1 - 0.5, BATH_Z0 + 0.5, BATH_Z1 - 0.5],
  bal: [BAL_X0 + 0.5, BAL_X1 - 0.5, BAL_Z0 + 0.5, BAL_Z1 - 0.5],
  sr: [STUDY_X0 + 0.5, STUDY_X1 - 0.5, STUDY_Z0 + 0.5, STUDY_Z1 - 0.5],
  yd: [GARDEN_X0 + 0.5, GARDEN_X1 - 0.5, GARDEN_Z0 + 0.5, GARDEN_Z1 - 0.5],
};

export const ROOM_NAMES: Record<RoomId, string> = {
  lr: '客厅',
  br: '卧室',
  kt: '厨房',
  ba: '卫生间',
  bal: '阳台',
  sr: '书房',
  yd: '花园',
};

/** 家具在任意水平角下的占地 AABB（fp 未旋转脚印 × 旋转） */
export function footprintOf(entry: CatalogEntry, ry: number): [number, number] {
  const [w, d] = entry.fp;
  const c = Math.abs(Math.cos(ry));
  const s = Math.abs(Math.sin(ry));
  return [w * c + d * s, w * s + d * c];
}

/** 家具六房间钳制：客厅/卧室/厨房/卫生间/阳台/书房/花园，不许骑墙 */
export function clampFurnToRooms(x: number, z: number, hw: number, hd: number): [number, number] {
  if (z < BED_Z0) {
    if (x >= BATH_X0) {
      // 卫生间（北排东段）
      return [
        Math.min(BATH_X1 - hw, Math.max(BATH_X0 + hw, x)),
        Math.min(BATH_Z1 - hd, Math.max(BATH_Z0 + hd, z)),
      ];
    }
    if (x < STUDY_X1) {
      // 书房（北排西段 v10；西/北/南外墙，东墙 = 客厅西墙共墙）
      return [
        Math.min(STUDY_X1 - hw, Math.max(STUDY_X0 + hw, x)),
        Math.min(STUDY_Z1 - hd, Math.max(STUDY_Z0 + hd, z)),
      ];
    }
    // 客厅
    return [
      Math.min(BATH_X0 - hw, Math.max(-ROOM_X + hw, x)),
      Math.min(BED_Z0 - hd, Math.max(-ROOM_Z + hd, z)),
    ];
  }
  if (x < BED_X1) {
    if (z > BED_Z1) {
      // 阳台（卧室南侧 v5.7）
      return [
        Math.min(BAL_X1 - hw, Math.max(BAL_X0 + hw, x)),
        Math.min(BAL_Z1 - hd, Math.max(BAL_Z0 + hd, z)),
      ];
    }
    // 卧室
    return [
      Math.min(BED_X1 - hw, Math.max(-ROOM_X + hw, x)),
      Math.min(BED_Z1 - hd, Math.max(BED_Z0 + hd, z)),
    ];
  }
  if (z > BED_Z1) {
    // 花园（厨房南侧露天 v10，栅栏内）
    return [
      Math.min(GARDEN_X1 - hw, Math.max(GARDEN_X0 + hw, x)),
      Math.min(GARDEN_Z1 - hd, Math.max(GARDEN_Z0 + hd, z)),
    ];
  }
  // 厨房
  return [
    Math.min(KTCH_X1 - hw, Math.max(BED_X1 + hw, x)),
    Math.min(BED_Z1 - hd, Math.max(BED_Z0 + hd, z)),
  ];
}

// ---------------- 挂墙槽位（相框/电视等自动贴墙） ----------------

/** 一段可用墙面：axis='z' 墙沿 x 走（frame z=at，x 在 from~to）；axis='x' 反之 */
export interface WallSlot {
  room: RoomId;
  axis: 'x' | 'z';
  /** 挂件基准面（内墙脸 + 0.07 缝隙） */
  at: number;
  from: number;
  to: number;
  /** 朝向（面向屋内） */
  ry: number;
  /** 该墙上窗户/门洞的沿墙区间（高挂件避让） */
  avoid?: [number, number][];
}

/** 全屋可用墙面（avoid = 该墙上窗户/门洞的沿墙区间，高挂件避让） */
export const WALL_SLOTS: WallSlot[] = [
  // 客厅
  { room: 'lr', axis: 'z', at: -ROOM_Z + 0.07, from: -4.0, to: 4.0, ry: 0, avoid: [[-3.05, -1.35], [1.35, 3.05]] },
  { room: 'lr', axis: 'x', at: -ROOM_X + 0.07, from: -2.6, to: 2.6, ry: Math.PI / 2, avoid: [[-2.45, -0.75], [SRDOOR_Z - 0.55, SRDOOR_Z + 0.55]] },
  { room: 'lr', axis: 'x', at: ROOM_X - 0.07, from: -2.6, to: 2.6, ry: -Math.PI / 2 },
  { room: 'lr', axis: 'z', at: BED_Z0 - 0.07, from: -1.5, to: 1.9, ry: Math.PI },
  // 书房（v10：西外墙挂画槽，避让装饰窗）
  { room: 'sr', axis: 'x', at: STUDY_X0 + 0.07, from: -2.5, to: 2.5, ry: Math.PI / 2, avoid: [[-2.6, -1.0]] },
  // 卧室
  { room: 'br', axis: 'x', at: -ROOM_X + 0.07, from: 3.3, to: 4.5, ry: Math.PI / 2 },
  { room: 'br', axis: 'x', at: BED_X1 - 0.07, from: 3.5, to: 7.5, ry: -Math.PI / 2 },
  { room: 'br', axis: 'z', at: BED_Z1 - 0.07, from: -4.0, to: 0.9, ry: Math.PI, avoid: [[-2.05, -0.35]] },
  // 厨房（北墙避开门洞与灶台区）
  { room: 'kt', axis: 'z', at: BED_Z0 + 0.19, from: 3.7, to: 7.1, ry: 0 },
  { room: 'kt', axis: 'x', at: KTCH_X1 - 0.07, from: 3.5, to: 7.5, ry: -Math.PI / 2, avoid: [[4.55, 6.25], [6.35, 7.65]] },
  { room: 'kt', axis: 'z', at: BED_Z1 - 0.07, from: 1.9, to: 7.1, ry: Math.PI, avoid: [[3.75, 5.45]] },
  // 卫生间（v5.4：客厅东侧；北墙避窗、东墙避窗）
  { room: 'ba', axis: 'z', at: BATH_Z0 + 0.07, from: 4.9, to: 8.1, ry: 0, avoid: [[5.58, 7.22]] },
  { room: 'ba', axis: 'x', at: BATH_X1 - 0.07, from: -2.5, to: 2.5, ry: -Math.PI / 2, avoid: [[0.38, 2.02]] },
  { room: 'ba', axis: 'z', at: BATH_Z1 - 0.07, from: 4.9, to: 8.1, ry: Math.PI },
  // 阳台（v5.7：卧室南侧；西外墙挂画、北墙门洞东侧留白）
  { room: 'bal', axis: 'x', at: BAL_X0 + 0.07, from: 8.6, to: 10.2, ry: Math.PI / 2 },
];

/** 找离 (x,z) 最近的挂墙槽位并投影到墙上（返回槽位 + 贴墙坐标） */
export function snapToWallSlot(
  x: number,
  z: number,
  room?: RoomId,
): { slot: WallSlot; x: number; z: number } {
  let best: { slot: WallSlot; x: number; z: number } | null = null;
  let bd = Infinity;
  for (const s of WALL_SLOTS) {
    if (room && s.room !== room) continue;
    const along = s.axis === 'z' ? x : z;
    const a = Math.max(s.from, Math.min(s.to, along));
    const px = s.axis === 'z' ? a : s.at;
    const pz = s.axis === 'z' ? s.at : a;
    const d = Math.hypot(px - x, pz - z);
    if (d < bd) {
      bd = d;
      best = { slot: s, x: px, z: pz };
    }
  }
  const s = best?.slot ?? WALL_SLOTS[0];
  const a = Math.max(s.from, Math.min(s.to, s.axis === 'z' ? x : z));
  return { slot: s, x: s.axis === 'z' ? a : s.at, z: s.axis === 'z' ? s.at : a };
}

// ---------------- 窗户 / 门（数据驱动：可选中、沿墙滑行） ----------------

/** 单扇窗定义：axis = 墙走向（'z' 墙沿 x 走），at = 墙内脸坐标，side = 窗组偏离内脸方向 */
export interface WinDef {
  room: RoomId;
  axis: 'x' | 'z';
  at: number;
  side: 1 | -1;
  ry: number;
  /** 默认沿墙坐标 */
  def: number;
  /** 沿墙可滑动范围 */
  min: number;
  max: number;
}

/** 九扇上悬窗（客厅北×2 / 客厅西 / 卧室西 / 卧室南 / 厨房东 / 厨房南 / 卫生间北 / 卫生间东） */
export const WINS: WinDef[] = [
  { room: 'lr', axis: 'z', at: -ROOM_Z, side: 1, ry: 0, def: -2.2, min: -3.6, max: 3.6 },
  { room: 'lr', axis: 'z', at: -ROOM_Z, side: 1, ry: 0, def: 2.2, min: -3.6, max: 3.6 },
  { room: 'lr', axis: 'x', at: -ROOM_X, side: 1, ry: Math.PI / 2, def: -1.6, min: -2.2, max: 2.2 },
  { room: 'br', axis: 'x', at: -ROOM_X, side: 1, ry: Math.PI / 2, def: 5.2, min: 3.7, max: 7.3 },
  { room: 'br', axis: 'z', at: BED_Z1, side: -1, ry: Math.PI, def: 0.35, min: -3.6, max: 0.8 },
  { room: 'kt', axis: 'x', at: KTCH_X1, side: -1, ry: -Math.PI / 2, def: 5.4, min: 3.7, max: 7.3 },
  { room: 'kt', axis: 'z', at: BED_Z1, side: -1, ry: Math.PI, def: 4.6, min: 2.4, max: 7.3 },
  // 卫生间（v5.4：客厅东侧；北窗在浴缸上方、东窗在马桶区上方）
  { room: 'ba', axis: 'z', at: BATH_Z0, side: 1, ry: 0, def: 6.4, min: 5.1, max: 7.7 },
  { room: 'ba', axis: 'x', at: BATH_X1, side: -1, ry: -Math.PI / 2, def: 1.2, min: -1.6, max: 2.0 },
];

/** 每扇窗的名字（编辑模式选中签 / 商店「窗户」tab 用；与 WINS 索引一一对应） */
export const WIN_NAMES: string[] = [
  '客厅北窗·左',
  '客厅北窗·右',
  '客厅西窗',
  '卧室西窗',
  '卧室南窗',
  '厨房东窗',
  '厨房南窗',
  '卫生间北窗',
  '卫生间东窗',
];

/** 门定义：axis/at 同 WinDef（门组落在墙中心线上） */
export interface DoorDef {
  id: 'bed' | 'kt' | 'bath' | 'bal';
  name: string;
  axis: 'x' | 'z';
  at: number;
  ry: number;
  def: number;
  min: number;
  max: number;
}

/** 四扇门（卧室门 / 厨房门在 z=3 隔墙；卫生间门在客厅东墙 x=4.5；阳台门在卧室南墙 z=8） */
export const DOORS: DoorDef[] = [
  { id: 'bed', name: '卧室门', axis: 'z', at: BED_Z0, ry: 0, def: DOOR_X, min: -3.9, max: 0.9 },
  { id: 'kt', name: '厨房门', axis: 'z', at: BED_Z0, ry: 0, def: KDOOR_X, min: 2.1, max: 6.9 },
  { id: 'bath', name: '卫生间门', axis: 'x', at: ROOM_X, ry: Math.PI / 2, def: BDOOR_Z, min: -2.2, max: 2.2 },
  { id: 'bal', name: '阳台门', axis: 'z', at: BED_Z1, ry: 0, def: -1.2, min: -3.4, max: 0.4 },
];

/** 同墙滑行件的半宽（窗 1.5m 宽 / 门 0.94m 宽 + 富余） */
const WIN_HALF = 0.82;
const DOOR_HALF = 0.56;

/** 同墙邻居（用于滑行避让：同墙的窗与门互不重叠；用当前坐标，缺省用默认位） */
function wallNeighbors(
  selfId: string,
  axis: 'x' | 'z',
  at: number,
  winPos?: number[],
  doorPos?: { bed: number; kt: number; bath: number; bal?: number },
): { along: number; half: number }[] {
  const out: { along: number; half: number }[] = [];
  for (const [i, w] of WINS.entries()) {
    if (`win-${i}` === selfId || w.axis !== axis || Math.abs(w.at - at) > 0.01) continue;
    out.push({ along: winPos?.[i] ?? w.def, half: WIN_HALF });
  }
  for (const d of DOORS) {
    if (`door-${d.id}` === selfId || d.axis !== axis || Math.abs(d.at - at) > 0.01) continue;
    out.push({ along: doorPos?.[d.id] ?? d.def, half: DOOR_HALF });
  }
  return out;
}

/** 把沿墙坐标钳回滑行范围并避让同墙邻居（门/窗滑行共用） */
export function clampWallAlong(selfId: string, def: { axis: 'x' | 'z'; at: number; min: number; max: number }, along: number, neighbors: { along: number; half: number }[]): number {
  let a = Math.max(def.min, Math.min(def.max, along));
  for (const o of neighbors) {
    const need = o.half + (selfId.startsWith('door-') ? DOOR_HALF : WIN_HALF) + 0.12;
    if (Math.abs(a - o.along) < need) {
      a = o.along > a ? o.along - need : o.along + need;
    }
  }
  return Math.max(def.min, Math.min(def.max, a));
}

/** 编辑模式拖拽/微调一扇窗：返回沿墙钳制后的完整位置 */
export function resolveWinPos(i: number, along: number, winPos?: number[], doorPos?: { bed: number; kt: number; bath: number; bal?: number }): { x: number; z: number; along: number } {
  const w = WINS[i];
  const cur = winPos?.[i] ?? w.def;
  const others = wallNeighbors(`win-${i}`, w.axis, w.at, winPos, doorPos);
  const a = clampWallAlong(`win-${i}`, w, Number.isFinite(along) ? along : cur, others);
  const x = w.axis === 'z' ? a : w.at + w.side * 0.08;
  const z = w.axis === 'z' ? w.at + w.side * 0.08 : a;
  return { x, z, along: a };
}

/** 编辑模式拖拽/微调一扇门：返回沿墙钳制后的完整位置（门组在墙中心线上） */
export function resolveDoorPos(id: 'bed' | 'kt' | 'bath' | 'bal', along: number, winPos?: number[], doorPos?: { bed: number; kt: number; bath: number; bal?: number }): { x: number; z: number; along: number } {
  const d = DOORS.find((x) => x.id === id)!;
  const cur = doorPos?.[id] ?? d.def;
  const others = wallNeighbors(`door-${id}`, d.axis, d.at, winPos, doorPos);
  const a = clampWallAlong(`door-${id}`, d, Number.isFinite(along) ? along : cur, others);
  const x = d.axis === 'z' ? a : d.at;
  const z = d.axis === 'z' ? d.at : a;
  return { x, z, along: a };
}

// ---------------- 家具目录 ----------------

const G = (f: string) => `/models/furniture/${f}.glb`;

/** 家具目录：kind → 静态配置（fp 为实测占地，单位米） */
export const CATALOG: Record<string, CatalogEntry> = {
  // ---- 沙发区 ----
  sofa: {
    kind: 'sofa', glb: G('sofa'), name: '云白双人沙发', cat: 'sofa', fp: [1.96, 0.82],
    acts: { seat: { y: 0.45, dz: -0.05 } },
  },
  sofaLong: {
    kind: 'sofaLong', glb: G('sofaLong'), name: '云白贵妃沙发', cat: 'sofa', fp: [1.96, 1.64],
    acts: { seat: { y: 0.45, dz: -0.18 } },
  },
  loungeChair: {
    kind: 'loungeChair', glb: G('loungeChair'), name: '米白休闲椅', cat: 'sofa', fp: [0.98, 1.35],
    acts: { seat: { y: 0.42, dz: -0.2 } },
  },
  ottoman: {
    kind: 'ottoman', glb: G('ottoman'), name: '软软脚凳', cat: 'sofa', fp: [0.88, 0.9],
    acts: { seat: { y: 0.38 } },
  },
  // ---- 桌几 ----
  coffeeTable: {
    kind: 'coffeeTable', glb: G('coffeeTable'), name: '云白茶几', cat: 'table', fp: [1.32, 0.8],
    acts: { playful: true },
  },
  diningTable: {
    kind: 'diningTable', glb: G('diningTable'), name: '圆脚餐桌', cat: 'table', fp: [1.39, 1.6],
    // playful 点一下弹跳；饭菜上桌后出现「开饭」（坐在东缘餐椅上吃饭；ryOff π/2 面朝桌子中心）
    acts: { playful: true, eat: { y: 0.45, dx: 1.02, ryOff: Math.PI / 2, out: [1.6, 0] } },
  },
  chair: {
    kind: 'chair', glb: G('chair'), name: '软垫椅', cat: 'table', fp: [0.4, 0.4],
    acts: { seat: { y: 0.45 } },
  },
  sideTable: {
    kind: 'sideTable', glb: G('sideTable'), name: '简约边桌', cat: 'table', fp: [1.07, 0.44],
    acts: { door: true },
  },
  desk: {
    kind: 'desk', glb: G('desk'), name: '简约书桌', cat: 'table', fp: [1.47, 0.78],
    acts: { playful: true },
  },
  // ---- 床品（卧室篇正式开放） ----
  bed: {
    kind: 'bed', glb: G('bed'), name: '粉白双人床', cat: 'bed', fp: [1.91, 2.25],
    acts: { sleep: { y: 0.47, dz: 0.2 } },
  },
  bedSingle: {
    kind: 'bedSingle', glb: G('bedSingle'), name: '单人小床', cat: 'bed', fp: [1.14, 2.25],
    acts: { sleep: { y: 0.47, dz: 0.2 } },
  },
  nightstand: {
    kind: 'nightstand', glb: G('nightstand'), name: '小抽屉床头柜', cat: 'bed', fp: [0.53, 0.43],
    acts: { door: true },
  },
  // ---- 地毯 ----
  rug: {
    kind: 'rug', glb: G('rug'), name: '浅粉圆地毯', cat: 'decor', fp: [1.84, 1.84],
    acts: { playful: true }, flat: true,
  },
  rugRect: {
    kind: 'rugRect', glb: G('rugRect'), name: '云白长地毯', cat: 'decor', fp: [3.14, 1.84],
    acts: { playful: true }, flat: true,
  },
  doormat: {
    kind: 'doormat', glb: G('doormat'), name: '进门地垫', cat: 'decor', fp: [0.86, 0.47],
    acts: { playful: true }, flat: true,
  },
  // ---- 影音 ----
  tvStand: {
    kind: 'tvStand', glb: G('tvStand'), name: '简约电视柜', cat: 'table',
    // 非均匀放大：原宽 1.6m 承不住 1.8m 大屏电视（用户反馈不适配），拉宽至 2.08m 微抬柜体
    scale: [1.3, 1.06, 1.0], fp: [2.08, 0.5],
    acts: { playful: true },
  },
  tv: {
    kind: 'tv', name: '高清大屏电视', cat: 'appliance', fp: [1.8, 0.15],
    // 看电视：小人坐到电视前地板上（屏幕朝本地 +z，人面朝电视 ry+π），电视自动开机
    acts: { toggle: true, watch: { y: 0.02, dz: 1.15 } },
  },
  speaker: {
    kind: 'speaker', glb: G('speaker'), name: '落地音箱', cat: 'appliance', fp: [0.3, 0.3],
    acts: { playful: true },
  },
  radio: {
    kind: 'radio', glb: G('radio'), name: '复古收音机', cat: 'appliance', fp: [0.63, 0.2],
    acts: { toggle: true }, light: { y: 0.25, color: '#ffd9a0', intensity: 0.4 },
  },
  microwave: {
    kind: 'microwave', glb: G('microwave'), name: '小微波炉', cat: 'appliance', fp: [0.58, 0.46], h: 0.36,
    // 点击加热/停止：门缝暖光 + 蒸汽袅袅（v5.9 F2 互动升级）
    acts: { toggle: true }, light: { y: 0.18, color: '#ffd9a0', intensity: 0.3 },
  },
  toaster: {
    kind: 'toaster', glb: G('toaster'), name: '烤面包机', cat: 'appliance', fp: [0.38, 0.2], h: 0.26,
    acts: { playful: true },
  },
  // ---- 灯具 ----
  lampFloor: {
    kind: 'lampFloor', glb: G('lampFloor'), name: '蘑菇落地灯', cat: 'lamp', fp: [0.3, 0.35], h: 1.72,
    acts: { toggle: true }, light: { y: 1.5, color: '#ffd9a0', intensity: 1.2 },
  },
  lampTable: {
    kind: 'lampTable', glb: G('lampTable'), name: '蘑菇小台灯', cat: 'lamp', fp: [0.3, 0.35],
    acts: { toggle: true }, light: { y: 0.5, color: '#ffd9a0', intensity: 0.9 },
  },
  // ---- 植物 ----
  plant: {
    kind: 'plant', glb: G('plant'), name: '大盆绿植', cat: 'plant', fp: [0.42, 0.48], h: 1.31,
    acts: { playful: true },
  },
  plantSmall: {
    kind: 'plantSmall', glb: G('plantSmall'), name: '小多肉', cat: 'plant', fp: [0.19, 0.19],
    acts: { playful: true },
  },
  // ---- 收纳 ----
  bookcase: {
    kind: 'bookcase', glb: G('bookcase'), name: '开放书架', cat: 'decor', fp: [0.8, 0.5], h: 1.76,
    // 「抽本书」：走到最近的沙发/椅子坐下翻页看（v5.8 B3）
    acts: { playful: true, read: true },
  },
  wardrobe: {
    kind: 'wardrobe', glb: G('wardrobe'), name: '双门衣柜', cat: 'decor', fp: [0.8, 0.5], h: 1.7,
    // 点门开合；「换套衣服」走到衣柜前自动开门换装（三套穿搭循环）
    acts: { door: true, dress: { y: 0, dz: 0.6, out: [0, 1.2] } },
  },
  box: {
    kind: 'box', glb: G('box'), glbAlt: G('boxOpen'), name: '收纳纸箱', cat: 'decor', fp: [0.42, 0.42],
    acts: { door: true },
  },
  trashcan: {
    kind: 'trashcan', glb: G('trashcan'), name: '小垃圾桶', cat: 'decor', fp: [0.42, 0.47],
    acts: { playful: true },
  },
  // ---- 家电·空调（程序化建模，壁挂式；客厅/卧室东墙均适用） ----
  aircon: {
    kind: 'aircon', name: '立体壁挂空调', cat: 'appliance', fp: [0.92, 0.28],
    acts: { toggle: true },
  },
  // ---- 装饰·相框（程序化建模，点击上传照片；永久保存） ----
  photoFrame: {
    kind: 'photoFrame', name: '立式相框', cat: 'decor', fp: [0.52, 0.3],
    acts: { photo: true },
  },
  photoWall: {
    kind: 'photoWall', name: '挂墙相框', cat: 'decor', fp: [0.56, 0.1], wallMount: true,
    acts: { photo: true },
  },
  photoWallWide: {
    kind: 'photoWallWide', name: '挂墙横相框', cat: 'decor', fp: [1.1, 0.1], wallMount: true,
    acts: { photo: true },
  },
  polaroid: {
    kind: 'polaroid', name: '拍立得', cat: 'decor', fp: [0.34, 0.3],
    acts: { photo: true },
  },
  // ---- 玩偶（程序化毛绒建模，点击弹跳） ----
  plushBunny: {
    kind: 'plushBunny', name: '毛绒兔玩偶', cat: 'decor', fp: [0.32, 0.32],
    acts: { playful: true },
  },
  plushDuck: {
    kind: 'plushDuck', name: '小黄鸭玩偶', cat: 'decor', fp: [0.28, 0.28],
    acts: { playful: true },
  },
  // ---- 家具·梳妆台（程序化建模：桌面 + 椭圆镜 + 小圆凳） ----
  vanity: {
    kind: 'vanity', name: '粉白梳妆台', cat: 'table', fp: [1.3, 0.95],
    // 坐到梳妆台前的小凳上化妆（面朝镜子），星星特效
    acts: { makeup: { y: 0.45, dz: 0.35, out: [0, 0.95] } },
  },
  books: {
    kind: 'books', glb: G('books'), name: '书堆', cat: 'decor', fp: [0.3, 0.19],
    acts: { playful: true },
  },
  coatRack: {
    kind: 'coatRack', glb: G('coatRack'), name: '衣帽架', cat: 'decor', fp: [0.55, 0.55], h: 1.54,
    acts: { playful: true },
  },
  // ---- 厨卫家电（v5.2 厨房正式开放） ----
  fridge: {
    kind: 'fridge', glb: G('fridge'), name: '云白冰箱', cat: 'appliance', fp: [0.86, 0.58], h: 1.84,
    // 点门开合；「喝一杯」自动开门拿冰饮（喝完自动结束）
    acts: { door: true, drink: { y: 0, dz: 0.62, out: [0, 1.25] } },
  },
  stove: {
    kind: 'stove', glb: G('stove'), name: '复古灶台', cat: 'appliance', fp: [0.86, 0.9], h: 0.9,
    // 站在灶台前颠勺烹饪，几秒后一桌好菜上餐桌（汤锅冒蒸汽）
    acts: { cook: { y: 0, dz: 0.55, out: [0, 1.15] } },
  },
  sink: {
    kind: 'sink', glb: G('sink'), name: '厨房水槽', cat: 'appliance', fp: [0.86, 0.9], h: 0.98,
    acts: { door: true },
  },
  kitchenBar: {
    kind: 'kitchenBar', glb: G('kitchenBar'), name: '小吧台', cat: 'table', fp: [0.86, 0.42], h: 0.84,
    acts: { playful: true },
  },
  washer: {
    kind: 'washer', glb: G('washer'), name: '滚筒洗衣机', cat: 'bathroom', fp: [0.78, 0.78], h: 0.85,
    acts: { door: true, washer: true },
  },
  bathtub: {
    kind: 'bathtub', glb: G('bathtub'), name: '泡泡浴缸', cat: 'bathroom', fp: [2.38, 1.12], h: 0.62,
    acts: { bath: { y: 0.1, dx: -0.35 } },
  },
  toilet: {
    kind: 'toilet', glb: G('toilet'), name: '小白马桶', cat: 'bathroom', fp: [0.63, 0.95], h: 0.72,
    acts: { seat: { y: 0.42, dz: -0.06 } },
  },
  // ---- 卫浴全套（v5.4：淋浴/浴室柜洗手台/挂壁镜/毛巾架） ----
  shower: {
    kind: 'shower', name: '玻璃淋浴房', cat: 'bathroom', fp: [1.02, 1.02], h: 2.05,
    // 站进淋浴房冲澡：背板在 +x/+z 侧，人面朝背板角落（ryOff π/4）；花洒自动开水；
    // 起身从步入口（-x/-z 对角）走出；toggle 保留（单独开水用）
    acts: {
      toggle: true,
      bath: { y: 0.04, dx: -0.06, dz: -0.06, stand: true, ryOff: Math.PI / 4, out: [-0.82, -0.82] },
    },
  },
  basin: {
    kind: 'basin', name: '浴室柜洗手台', cat: 'bathroom', fp: [0.96, 0.54], h: 0.86,
    acts: { playful: true },
  },
  mirror: {
    kind: 'mirror', name: '挂壁大镜子', cat: 'bathroom', fp: [0.66, 0.1], wallMount: true, wallY: 1.55, h: 0.86,
    acts: {},
  },
  towelRack: {
    kind: 'towelRack', name: '毛巾架', cat: 'bathroom', fp: [0.5, 0.1], wallMount: true, wallY: 1.35, h: 0.42,
    acts: {},
  },
  // ---- 宠物 ----
  bear: {
    kind: 'bear', name: '小熊「团团」', cat: 'decor', fp: [0.6, 0.46], h: 0.55,
    acts: { playful: true },
  },
  plushPanda: {
    kind: 'plushPanda', name: '熊猫玩偶「滚滚」', cat: 'decor', fp: [0.3, 0.3], h: 0.3,
    acts: { playful: true },
  },
  plushPig: {
    kind: 'plushPig', name: '小猪玩偶「呼噜」', cat: 'decor', fp: [0.3, 0.3], h: 0.28,
    acts: { playful: true },
  },
  plushCat: {
    kind: 'plushCat', name: '猫咪玩偶「咪咪」', cat: 'decor', fp: [0.3, 0.34], h: 0.3,
    acts: { playful: true },
  },
  // ---- 厨具小物（程序化建模，摆桌/摆灶台） ----
  pot: {
    kind: 'pot', name: '奶油汤锅', cat: 'kitchen', fp: [0.3, 0.3], h: 0.2,
    acts: { playful: true },
  },
  kettle: {
    kind: 'kettle', name: '鸣笛水壶', cat: 'kitchen', fp: [0.26, 0.26], h: 0.22,
    acts: { playful: true },
  },
  bowls: {
    kind: 'bowls', name: '叠叠小碗', cat: 'kitchen', fp: [0.24, 0.24], h: 0.14,
    acts: { playful: true },
  },
  plates: {
    kind: 'plates', name: '白瓷盘子', cat: 'kitchen', fp: [0.28, 0.28], h: 0.07,
    acts: { playful: true },
  },
  chopsticks: {
    kind: 'chopsticks', name: '筷子筒', cat: 'kitchen', fp: [0.14, 0.14], h: 0.24,
    acts: { playful: true },
  },
  spoons: {
    kind: 'spoons', name: '小勺子', cat: 'kitchen', fp: [0.14, 0.1], h: 0.12,
    acts: { playful: true },
  },
  cup: {
    kind: 'cup', name: '马克杯', cat: 'kitchen', fp: [0.2, 0.14], h: 0.12,
    acts: { playful: true },
  },
  juicer: {
    kind: 'juicer', name: '榨汁机', cat: 'appliance', fp: [0.24, 0.24], h: 0.3,
    acts: { playful: true },
  },
  // ---- 电器·风扇（程序化建模，点击开/关叶片旋转） ----
  fan: {
    kind: 'fan', name: '落地风扇', cat: 'appliance', fp: [0.34, 0.34], h: 1.1,
    acts: { toggle: true },
  },
  // ---- 电器·插座（程序化建模，挂墙低位） ----
  socket: {
    kind: 'socket', name: '墙壁插座', cat: 'appliance', fp: [0.14, 0.06], wallMount: true, wallY: 0.38, h: 0.1,
    acts: {},
  },
  // ---- 电器·手提电脑（程序化建模，摆桌面；点击「上网」小人坐到桌前敲键盘） ----
  laptop: {
    kind: 'laptop', name: '手提电脑', cat: 'appliance', fp: [0.36, 0.26], h: 0.24,
    // 屏幕朝本地 +z；小人坐在电脑前（y=椅面高）敲键盘；开屏盖/关屏盖动画
    acts: { work: { y: 0.45, dz: 0.5 } },
  },
  // ---- 灯具·吊灯（程序化建模，挂在天花板；点击开/关） ----
  chandelier: {
    kind: 'chandelier', name: '奶油吊灯', cat: 'lamp', fp: [0.42, 0.42], h: 0.62,
    acts: { toggle: true },
  },

  // ==================== v5.6 温馨扩展（Cozy3D 程序化建模） ====================
  // ---- 客厅 ----
  curtain: {
    kind: 'curtain', name: '落地窗帘', cat: 'decor', fp: [2.3, 0.16], h: 2.3,
    // 点击开合：拉开见星空，拉上挡光
    acts: { toggle: true },
  },
  fireplace: {
    kind: 'fireplace', name: '暖暖壁炉', cat: 'decor', fp: [1.58, 0.5], h: 1.1,
    // 点击点火/熄火：火焰跳动 + 暖光闪烁
    acts: { toggle: true },
  },
  fishtank: {
    kind: 'fishtank', name: '小鱼缸', cat: 'decor', fp: [0.9, 0.45], h: 1.1,
    // 点一下撒鱼食：6 秒鱼群聚食
    acts: { feed: true, playful: true },
  },
  beanbag: {
    kind: 'beanbag', name: '懒人豆袋', cat: 'sofa', fp: [0.98, 0.9],
    // 一坐就陷进去（坐点低）
    acts: { seat: { y: 0.3, dz: 0.02 } },
  },
  piano: {
    kind: 'piano', name: '立式小钢琴', cat: 'decor', fp: [1.5, 1.15], h: 1.24,
    // 坐上琴凳弹一曲（音符飘出）；fp 含前方琴凳
    acts: { play: { y: 0.45, dz: 0.72, out: [0, 1.3] } },
  },
  guitar: {
    kind: 'guitar', name: '角落木吉他', cat: 'decor', fp: [0.55, 0.45], h: 1.05,
    // 站着抱琴弹一段（音符飘出）
    acts: { play: { y: 0, dz: 0.5, out: [0, 1.05] } },
  },
  standingMirror: {
    kind: 'standingMirror', name: '穿衣落地镜', cat: 'decor', fp: [0.95, 0.55], h: 1.65,
    // 走到镜前照一照（微微摆 pose 自恋一下）
    acts: { mirror: { y: 0, dz: 0.55, out: [0, 1.1] } },
  },
  starLamp: {
    kind: 'starLamp', name: '星空投影灯', cat: 'lamp', fp: [0.24, 0.24], h: 0.13,
    // 点击开/关：夜晚天花板上星点旋转
    acts: { toggle: true },
  },
  canopy: {
    kind: 'canopy', name: '奶油床幔', cat: 'bed', fp: [2.0, 2.34], h: 1.95,
    // 罩在床上（无碰撞，跟随床位摆放）；点点小摆动
    acts: { playful: true }, flat: true,
  },
  // ---- 厨房 ----
  coffeeMaker: {
    kind: 'coffeeMaker', name: '迷你咖啡机', cat: 'appliance', fp: [0.38, 0.28], h: 0.38,
    // 点击煮一杯：蒸汽升腾 + 指示灯亮；「端一杯」小人走到咖啡机前煮一杯热咖啡端着逛（v5.8 A3）
    acts: { toggle: true, coffee: { y: 0, dz: 0.45, out: [0, 0.95] } },
  },
  fruitBasket: {
    kind: 'fruitBasket', name: '满满果盘', cat: 'kitchen', fp: [0.4, 0.4], h: 0.24,
    acts: { playful: true },
  },
  // ---- 卫生间 ----
  bathCurtain: {
    kind: 'bathCurtain', name: '浴缸拉帘', cat: 'bathroom', fp: [2.1, 0.08], h: 2.0,
    // 点击开合：泡澡时拉上有隐私感
    acts: { toggle: true },
  },
  toiletries: {
    kind: 'toiletries', name: '洗漱小套装', cat: 'bathroom', fp: [0.4, 0.2], h: 0.26,
    acts: { playful: true },
  },
  scale: {
    kind: 'scale', name: '体重秤', cat: 'bathroom', fp: [0.34, 0.34], h: 0.06,
    // 点击踩上去称一称（弹个可爱数字）
    acts: { playful: true },
  },
  // ---- 挂墙 ----
  wallShelf: {
    kind: 'wallShelf', name: '挂墙置物架', cat: 'decor', fp: [0.9, 0.1], wallMount: true, wallY: 1.4, h: 0.22,
    acts: { playful: true },
  },

  // ==================== v5.7 拾光扩展（用户选择清单 J1~J11） ====================
  // J1a 投影仪（吊装/摆桌面均可；点击开/关 → 光锥亮起，幕布自动放下播放电影）
  projector: {
    kind: 'projector', name: '迷你投影仪', cat: 'appliance', fp: [0.36, 0.3], h: 0.17,
    acts: { toggle: true }, light: { y: 0.06, color: '#cfe0ff', intensity: 0.3 },
  },
  // J1b 幕布（挂墙；任一投影仪开着 = 幕布放下放电影，投影仪全关 = 收起）
  screen: {
    kind: 'screen', name: '高清幕布', cat: 'appliance', fp: [2.3, 0.12], wallMount: true, wallY: 1.5, h: 1.32,
    acts: {},
  },
  // J2 吊篮秋千椅（坐上去轻轻摇晃）；座位 = 吊篮内坐垫顶面（挂架 1.88 − 垫心 0.92 + 垫半高 ≈ 1.0m，
  // v6.1 修正：老值 0.5 让小人整个沉进吊篮、腿从开口篮底穿出）
  swingChair: {
    kind: 'swingChair', name: '吊篮秋千椅', cat: 'sofa', fp: [1.08, 1.0], h: 1.95,
    acts: { seat: { y: 0.99, dz: -0.02 } },
  },
  // J3 玄关鞋柜（开门收纳，柜底摆拖鞋）
  shoeCabinet: {
    kind: 'shoeCabinet', name: '玄关鞋柜', cat: 'decor', fp: [1.0, 0.42], h: 1.14,
    acts: { door: true },
  },
  // J4 装饰挂画组（三联抽象画，挂墙）
  wallArt: {
    kind: 'wallArt', name: '装饰挂画组', cat: 'decor', fp: [1.6, 0.1], wallMount: true, wallY: 1.5, h: 0.64,
    acts: { playful: true },
  },
  // J5 香薰加湿器（点击开/关：雾气袅袅 + 柔光）
  humidifier: {
    kind: 'humidifier', name: '香薰加湿器', cat: 'appliance', fp: [0.28, 0.28], h: 0.36,
    acts: { toggle: true }, light: { y: 0.1, color: '#b8e6d9', intensity: 0.4 },
  },
  // J6 玻璃酒柜（开门见酒瓶酒杯）
  wineCabinet: {
    kind: 'wineCabinet', name: '玻璃酒柜', cat: 'decor', fp: [0.92, 0.5], h: 1.62,
    acts: { door: true },
  },
  // J7 棋盘桌（点击开一局五子棋，AI 陪练；桌上常摆棋子）
  chessTable: {
    kind: 'chessTable', name: '棋盘桌', cat: 'table', fp: [0.98, 0.98], h: 0.7,
    acts: { playful: true },
  },
  // J8 火锅桌（点击开火：红汤翻滚冒泡；「开涮」小人坐桌边吃火锅；座位离桌沿留出腿部空间；ryOff -π/2 面朝锅）
  hotpotTable: {
    kind: 'hotpotTable', name: '火锅桌', cat: 'table', fp: [1.15, 1.15], h: 0.78,
    acts: { toggle: true, hotpot: { y: 0.46, dx: 1.02, ryOff: -Math.PI / 2, out: [1.55, 0] } },
  },
  // J10 游戏主机（点击开机：附近电视自动亮；开机后小人自由走动，同电视 v5.8）
  gameConsole: {
    kind: 'gameConsole', name: '游戏主机', cat: 'appliance', fp: [0.44, 0.32], h: 0.13,
    acts: { toggle: true },
  },
  // J11 花架（开花植物三层架，点一点落花瓣）
  flowerStand: {
    kind: 'flowerStand', name: '开花花架', cat: 'plant', fp: [0.78, 0.38], h: 1.08,
    acts: { playful: true },
  },

  // ==================== v5.8 旋律扩展（B1：黑胶唱片机 + 八音盒） ====================
  // 黑胶唱片机（摆电视柜台面）：点击开机转盘旋转 + 联动音乐 App 放歌（再点暂停）
  vinyl: {
    kind: 'vinyl', name: '黑胶唱片机', cat: 'appliance', fp: [0.52, 0.4], h: 0.2,
    acts: { toggle: true },
  },
  // 复古八音盒（摆电视柜台面）：点击弹点歌面板选歌，盒盖/芭蕾舞者随播放开合起舞（v6.0，暂停即合盖）
  musicBox: {
    kind: 'musicBox', name: '复古八音盒', cat: 'decor', fp: [0.26, 0.2], h: 0.24,
    acts: {},
  },

  // ==================== v5.9 节日限定（F1：按月份自动出现，商店不售） ====================
  // 圣诞树（11~12月自动出现）：彩灯闪烁 + 顶星发光
  xmasTree: {
    kind: 'xmasTree', name: '圣诞树', cat: 'decor', fp: [1.0, 1.0], h: 1.9,
    acts: { playful: true }, light: { y: 1.7, color: '#ffe6a8', intensity: 0.55 },
  },
  // 礼物堆（11~12月）：点点彩盒弹跳
  giftPile: {
    kind: 'giftPile', name: '礼物堆', cat: 'decor', fp: [0.9, 0.7], h: 0.5,
    acts: { playful: true },
  },
  // 红灯笼（1~2月新春）：暖光圆灯
  lantern: {
    kind: 'lantern', name: '红灯笼', cat: 'lamp', fp: [0.34, 0.34], h: 0.62,
    acts: { toggle: true }, light: { y: 0.4, color: '#ff8a5c', intensity: 0.6 },
  },
  // 春联（1~2月新春，挂墙）：福字竖联
  springCouplet: {
    kind: 'springCouplet', name: '新春春联', cat: 'decor', fp: [0.42, 0.08], wallMount: true, wallY: 1.45, h: 1.15,
    acts: { playful: true },
  },
  // 南瓜灯（10月万圣节）：点亮点亮鬼脸蜡烛
  pumpkin: {
    kind: 'pumpkin', name: '南瓜灯', cat: 'lamp', fp: [0.34, 0.34], h: 0.34,
    acts: { toggle: true }, light: { y: 0.2, color: '#ff9a3d', intensity: 0.5 },
  },

  // ==================== v5.9 阳台扩充（F4） ====================
  // 吊床（长轴沿 x）：躺下时 ryOff π/2 让小人顺长轴躺
  hammock: {
    kind: 'hammock', name: '悠闲吊床', cat: 'sofa', fp: [2.1, 0.9], h: 0.75,
    acts: { sleep: { y: 0.42, ryOff: Math.PI / 2, out: [1.2, 0] } },
  },
  // BBQ 烤架：点击开炭火（火光 + 烟雾）
  bbq: {
    kind: 'bbq', name: 'BBQ 烤架', cat: 'appliance', fp: [0.8, 0.6], h: 1.0,
    acts: { toggle: true }, light: { y: 0.5, color: '#ff9a3d', intensity: 0.45 },
  },
  // 户外躺椅：坐上去晒太阳
  loungeOutdoor: {
    kind: 'loungeOutdoor', name: '户外躺椅', cat: 'sofa', fp: [0.8, 1.7], h: 0.78,
    acts: { seat: { y: 0.4, dz: -0.3 } },
  },
  // 花箱栅栏：阳台装饰（一排小花）
  flowerBox: {
    kind: 'flowerBox', name: '花箱栅栏', cat: 'plant', fp: [1.8, 0.3], h: 0.55,
    acts: { playful: true },
  },

  // ==================== v5.9 墙面装饰（F5） ====================
  // 挂钟：指针跟真实时间走
  wallClock: {
    kind: 'wallClock', name: '挂钟', cat: 'decor', fp: [0.4, 0.08], wallMount: true, wallY: 1.55, h: 0.4,
    acts: {},
  },
  // 世界地图挂图：手绘风
  worldMap: {
    kind: 'worldMap', name: '世界地图', cat: 'decor', fp: [1.5, 0.08], wallMount: true, wallY: 1.5, h: 0.95,
    acts: { playful: true },
  },
  // 恋爱纪念照片墙：心形相框组，可换自己的合照（photo 流程同相框）
  photoWallLove: {
    kind: 'photoWallLove', name: '纪念照片墙', cat: 'decor', fp: [1.3, 0.1], wallMount: true, wallY: 1.5, h: 0.9,
    acts: { photo: true },
  },

  // ==================== v5.9 绿植系列（F6） ====================
  monstera: {
    kind: 'monstera', name: '龟背竹', cat: 'plant', fp: [0.6, 0.55], h: 1.0,
    acts: { playful: true },
  },
  cactus: {
    kind: 'cactus', name: '小仙人掌', cat: 'plant', fp: [0.26, 0.26], h: 0.42,
    acts: { playful: true },
  },
  // 水培瓶：摆桌面小物
  hydro: {
    kind: 'hydro', name: '水培瓶', cat: 'plant', fp: [0.14, 0.14], h: 0.26,
    acts: { playful: true },
  },

  // ==================== v5.9 毛绒伙伴（F7） ====================
  // 大号泰迪熊：小人可以坐进怀里抱抱（seat = 熊腿上）
  teddyBig: {
    kind: 'teddyBig', name: '大号泰迪熊', cat: 'decor', fp: [1.0, 0.8], h: 1.25,
    acts: { playful: true, seat: { y: 0.62, dz: 0.08 } },
  },
  // 抱枕堆：坐上去软软的
  pillowPile: {
    kind: 'pillowPile', name: '抱枕堆', cat: 'sofa', fp: [0.72, 0.55], h: 0.35,
    acts: { playful: true, seat: { y: 0.26, dz: 0 } },
  },
  // 懒人豆袋毯：豆袋 + 盖毯，一坐就陷进去
  beanbagBlanket: {
    kind: 'beanbagBlanket', name: '懒人豆袋毯', cat: 'sofa', fp: [1.05, 0.95], h: 0.55,
    acts: { playful: true, seat: { y: 0.3, dz: 0.02 } },
  },

  // ==================== v5.9 下午茶角（F8） ====================
  // 茶几套餐具（茶壶 + 杯组，摆桌面小物）
  teaSet: {
    kind: 'teaSet', name: '下午茶具', cat: 'kitchen', fp: [0.3, 0.22], h: 0.16,
    acts: { playful: true },
  },
  // 蛋糕架（双层点心台）
  cakeStand: {
    kind: 'cakeStand', name: '蛋糕架', cat: 'kitchen', fp: [0.28, 0.28], h: 0.28,
    acts: { playful: true },
  },
  // ---- v6.1 留言板 + 娃娃机（G8 共享留言板 / G10 小游戏） ----
  clawMachine: {
    kind: 'clawMachine', name: '娃娃机', cat: 'decor', fp: [0.82, 0.66], h: 1.78,
    // 点击开一局抓娃娃（接线在 CoupleHome：抓中的毛绒直接摆进房间）
    acts: {},
  },
  noteBoard: {
    kind: 'noteBoard', name: '软木留言板', cat: 'decor', fp: [0.72, 0.08], wallMount: true, wallY: 1.5, h: 0.6,
    // 点击打开留言面板（给 TA 留言 / 待办）
    acts: {},
  },
  // ---- v7.1 宠物小窝（程序化建模；夜晚团子自己回窝睡觉 + Zzz） ----
  petBed: {
    kind: 'petBed', name: '奶油猫窝', cat: 'decor', fp: [0.66, 0.58],
    // 纯装饰（无交互）；宠物夜晚自动寻路回窝蜷成团睡觉
    acts: { playful: true },
  },
};

// ---------------- 成套摆放（F3：一键把一组家具按预设相对位放进房间） ----------------

/** 套装单件：kind + 相对锚点偏移（dx/dz 米，锚点 = findSpot 找到的落点）；可选 ry / y（抬上桌） */
export interface FurnSetItem {
  kind: FurnitureKind;
  dx: number;
  dz: number;
  ry?: number;
  y?: number;
}

export interface FurnSet {
  id: string;
  name: string;
  desc: string;
  /** 锚点定位用的代表家具（最大的那件，findSpot 用它找空位） */
  anchor: FurnitureKind;
  items: FurnSetItem[];
}

/** 商店「套装」tab 的套装清单（相对偏移已验证不重叠，clamped 到当前房间） */
export const FURN_SETS: FurnSet[] = [
  {
    id: 'bedSet',
    name: '温馨卧室套装',
    desc: '双人床 + 床头柜×2 + 衣柜',
    anchor: 'bed',
    items: [
      { kind: 'bed', dx: 0, dz: 0 },
      { kind: 'nightstand', dx: -1.35, dz: -0.2 },
      { kind: 'nightstand', dx: 1.35, dz: -0.2 },
      { kind: 'wardrobe', dx: 0, dz: -1.75 },
    ],
  },
  {
    id: 'sofaSet',
    name: '客厅沙发套装',
    desc: '长地毯 + 双人沙发 + 茶几',
    anchor: 'rugRect',
    items: [
      { kind: 'rugRect', dx: 0, dz: 0 },
      { kind: 'sofa', dx: 0, dz: -1.6 },
      { kind: 'coffeeTable', dx: 0, dz: -0.1 },
    ],
  },
  {
    id: 'studySet',
    name: '元气书房套装',
    desc: '书桌 + 软垫椅 + 书架 + 台灯',
    anchor: 'desk',
    items: [
      { kind: 'desk', dx: 0, dz: 0 },
      { kind: 'chair', dx: 0, dz: 0.75 },
      { kind: 'bookcase', dx: 0, dz: -1.1 },
      { kind: 'lampTable', dx: -0.5, dz: 0, y: 0.78 },
    ],
  },
  {
    id: 'teaCorner',
    name: '下午茶角套装',
    desc: '边桌 + 椅×2 + 茶具 + 蛋糕架',
    anchor: 'sideTable',
    items: [
      { kind: 'sideTable', dx: 0, dz: 0 },
      { kind: 'chair', dx: -0.55, dz: 0.62, ry: Math.PI },
      { kind: 'chair', dx: 0.55, dz: 0.62, ry: Math.PI },
      { kind: 'teaSet', dx: 0, dz: 0, y: 0.56 },
      { kind: 'cakeStand', dx: 0.32, dz: 0, y: 0.56 },
    ],
  },
  {
    id: 'balconySet',
    name: '假日烧烤套装',
    desc: '吊床 + BBQ + 躺椅 + 花箱',
    anchor: 'hammock',
    items: [
      { kind: 'hammock', dx: 0, dz: 0 },
      { kind: 'bbq', dx: 2.2, dz: -0.3 },
      { kind: 'loungeOutdoor', dx: 1.0, dz: 1.1 },
      { kind: 'flowerBox', dx: 2.1, dz: 0.85 },
    ],
  },
];

// ---------------- 节日限定（F1：按月份自动出现） ----------------

/** 月份（1~12）→ 当月应自动出现的节日家具 kind；商店不售、删掉当月不再补（下月/来年再来） */
export const SEASONAL: Record<number, FurnitureKind[]> = {
  10: ['pumpkin'],
  11: ['xmasTree', 'giftPile'],
  12: ['xmasTree', 'giftPile'],
  1: ['lantern', 'springCouplet'],
  2: ['lantern', 'springCouplet'],
};

/** 商店分类 tab 配置（编辑模式底部栏；纯文字，无图标；set = 成套摆放 F3） */
export const SHOP_TABS: { key: import('./types').FurnCategory; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'set', label: '套装' },
  { key: 'sofa', label: '沙发' },
  { key: 'table', label: '桌几' },
  { key: 'bed', label: '床品' },
  { key: 'lamp', label: '灯具' },
  { key: 'plant', label: '植物' },
  { key: 'appliance', label: '家电' },
  { key: 'kitchen', label: '厨具' },
  { key: 'bathroom', label: '卫浴' },
  { key: 'decor', label: '装饰' },
];

// ---------------- 默认布局（完整客厅） ----------------

let seq = 0;
const F = (
  kind: FurnitureItem['kind'],
  x: number,
  z: number,
  opts: { ry?: number; y?: number; rx?: number } = {},
): FurnitureItem => ({
  id: `${kind}-${Date.now().toString(36)}-${++seq}`,
  kind,
  x,
  z,
  ry: opts.ry ?? 0,
  y: opts.y,
  rx: opts.rx,
  st: {},
});

/**
 * 初始 v5.4 四室：客厅 + 卧室 + 厨房 + 卫生间（客厅东侧，门开在客厅）
 * 客厅：北墙电视墙 + 沙发对坐 + 西侧工作角 + 玄关 + 风扇 + 吊灯
 * 卧室：双人床 + 床头柜×2 + 衣柜 + 梳妆台 + 空调 + 玩偶×3 + 挂墙相框 + 吊灯
 * 厨房：冰箱灶台水槽沿北墙 + 吧台 + 餐桌 + 锅碗筷盘勺杯榨汁机 + 吊灯
 * 卫生间：浴缸(北窗下) + 淋浴房 + 马桶 + 洗手台 + 大镜子 + 毛巾架 + 洗衣机 + 吊灯
 */
export function defaultHome(): HomeState {
  seq = 0;
  return {
    v: 5,
    night: false,
    win: [false, false, false, false, false, false, false, false, false],
    doorOpen: false,
    kitchenDoorOpen: false,
    bathDoorOpen: false,
    studyDoorOpen: false,
    gardenGateOpen: false,
    furniture: [
      // —— 客厅·电视墙（北） ——
      F('tvStand', 0, -2.7),
      F('tv', 0, -2.88, { y: 1.19 }), // 挂墙：屏幕底缘恰在电视柜顶上方
      F('speaker', -1.55, -2.72),
      F('speaker', 1.55, -2.72),
      F('bookcase', -2.7, -2.7),
      F('plant', 2.62, -2.62),

      // —— 客厅·中心 ——
      F('rugRect', 0.15, -0.3),
      F('coffeeTable', 0.15, -0.35),
      F('books', 0.55, -0.3, { y: 0.46, ry: 0.4 }), // 摆上茶几
      F('sofa', 0.15, 1.35, { ry: Math.PI }), // 面向北（电视）
      F('loungeChair', 2.05, -0.2, { ry: -2.35 }), // 斜角面向电视
      F('ottoman', -1.5, 0.45),
      F('sideTable', 2.15, 1.2, { ry: -Math.PI / 2 }),
      F('lampTable', 2.28, 1.0, { y: 0.77 }), // 摆上边桌
      F('plantSmall', 1.98, 1.55, { y: 0.77 }), // 摆上边桌
      F('lampFloor', -1.95, 2.0),

      // —— 客厅·工作角（西） ——
      F('desk', -3.95, 0.3, { ry: Math.PI / 2 }),
      F('chair', -3.15, 0.3, { ry: -Math.PI / 2 }),
      F('radio', -3.9, 0.1, { y: 0.77, ry: Math.PI / 2 }), // 摆上书桌
      F('laptop', -3.61, 0.62, { y: 0.78, ry: Math.PI / 2 }), // 手提电脑摆上书桌（前缘）

      // —— 客厅·空调（东壁挂）+ 玄关（南，门旁） ——
      F('aircon', 4.34, -1.6, { y: 1.85, ry: -Math.PI / 2 }),
      F('photoFrame', 3.4, 2.45, { ry: Math.PI }), // 立式相框（东南角，不挡去卧室的门路）
      F('bear', 1.45, 2.35, { ry: -2.6 }),
      F('doormat', DOOR_X, 2.62),
      F('coatRack', -3.55, 2.5),
      F('trashcan', -3.62, -2.58),
      F('fan', 3.7, 1.75, { ry: -2.4 }), // 落地风扇
      F('petBed', -3.42, -1.42, { ry: 0.5 }), // 奶油猫窝（西侧书桌旁角落：团子的固定小床）
      F('chandelier', 0, 0.2, { y: WALL_H - 0.04 }), // 客厅吊灯
      F('socket', ROOM_X - 0.07, -0.9, { y: 0.38, ry: -Math.PI / 2 }), // 客厅东壁插座

      // —— 卧室（隔墙南侧，推门而入；家具齐备） ——
      F('bed', -3.32, 5.6, { ry: -Math.PI / 2 }), // 双人床靠西墙（床头朝西）
      F('plushBunny', -2.62, 5.12, { y: 0.42, ry: -2.3 }), // 毛绒兔坐在床上
      F('plushPig', -2.85, 5.95, { y: 0.42, ry: 2.2 }), // 小猪玩偶坐床上
      F('nightstand', -3.4, 4.25),
      F('plushDuck', -3.4, 4.25, { y: 0.53, ry: 0.5 }), // 小黄鸭摆上床头柜
      F('nightstand', -3.4, 6.95),
      F('lampTable', -3.4, 6.95, { y: 0.56 }), // 床头灯
      F('wardrobe', 0.95, 3.35), // 衣柜靠卧室北墙（隔墙）
      F('vanity', 0.95, 7.5, { ry: Math.PI }), // 梳妆台靠卧室南墙（凳子朝北）
      F('aircon', 1.4, 5.6, { y: 1.85, ry: -Math.PI / 2 }), // 卧室东壁空调
      F('lampFloor', -4.05, 7.3), // 卧室角落落地灯
      F('rug', -0.9, 5.5), // 圆地毯
      F('plant', -1.15, 7.55), // 绿植（钢琴西侧，不塞进琴身）
      F('photoFrame', -1.7, 7.45, { ry: Math.PI }), // 卧室相框
      F('photoWall', 1.43, 4.6, { y: 1.45, ry: -Math.PI / 2 }), // 卧室东壁挂墙相框
      F('plushCat', -1.5, 0.45, { y: 0.4, ry: -0.7 }), // 猫咪玩偶坐脚凳 —— 改放客厅
      F('chandelier', -1.5, 5.5, { y: WALL_H - 0.04 }), // 卧室吊灯
      F('socket', -ROOM_X + 0.07, 3.7, { y: 0.38, ry: Math.PI / 2 }), // 卧室西壁插座

      // —— 厨房（卧室东侧，北墙开门洞通客厅） ——
      F('fridge', 7.0, 3.41), // 冰箱靠北墙
      F('stove', 6.0, 3.57), // 灶台
      F('pot', 5.82, 3.52, { y: 0.92 }), // 汤锅上灶
      F('kettle', 6.3, 3.35, { y: 0.92, ry: -0.5 }), // 水壶上灶
      F('sink', 5.0, 3.57), // 水槽
      F('kitchenBar', 7.2, 5.4, { ry: -Math.PI / 2 }), // 吧台靠东墙（窗下）
      F('chair', 6.55, 5.12, { ry: Math.PI / 2 }), // 吧台椅×2
      F('chair', 6.55, 5.68, { ry: Math.PI / 2 }),
      F('plantSmall', 7.2, 5.68, { y: 0.85 }), // 吧台小多肉
      F('cup', 7.2, 5.4, { y: 0.86, ry: 0.4 }), // 马克杯摆吧台
      F('polaroid', 7.2, 5.08, { y: 0.85, ry: -Math.PI / 2 + 0.2 }), // 拍立得摆吧台
      F('diningTable', 3.3, 6.5), // 餐桌
      F('chair', 2.2, 6.5, { ry: Math.PI / 2 }), // 餐椅×2
      F('chair', 4.4, 6.5, { ry: -Math.PI / 2 }),
      F('microwave', 3.0, 6.2, { y: 0.74, ry: 0.3 }), // 微波炉上桌
      F('toaster', 3.6, 6.75, { y: 0.74, ry: -0.2 }), // 烤面包机上桌
      F('bowls', 2.85, 6.62, { y: 0.74 }), // 碗上桌
      F('plates', 3.72, 6.32, { y: 0.74 }), // 盘子上桌
      F('chopsticks', 3.28, 6.78, { y: 0.74 }), // 筷子筒上桌
      F('juicer', 3.62, 6.6, { y: 0.74, ry: 0.5 }), // 榨汁机上桌
      F('doormat', KDOOR_X, 3.75), // 厨房门垫
      F('plant', 1.95, 7.5),
      F('photoWall', 6.4, BED_Z1 - 0.07, { y: 1.45, ry: Math.PI }), // 厨房南壁挂墙相框
      F('photoWallWide', -ROOM_X + 0.07, 1.7, { y: 1.5, ry: Math.PI / 2 }), // 客厅西墙横相框
      F('socket', 4.2, BED_Z0 + 0.19, { y: 0.38, ry: 0 }), // 厨房北壁插座
      F('chandelier', 4.5, 5.5, { y: WALL_H - 0.04 }), // 厨房吊灯

      // —— 卫生间（客厅东侧，v5.4；推门而入，门在客厅东墙） ——
      F('bathtub', 6.35, -2.28), // 泡泡浴缸靠北墙（窗下）
      F('shower', 7.98, 2.5), // 玻璃淋浴房东南角（贴墙）
      F('toilet', 4.98, 2.3, { ry: Math.PI / 2 }), // 小白马桶靠西墙
      F('basin', 6.3, 2.62, { ry: Math.PI }), // 浴室柜洗手台靠南墙
      F('mirror', 6.3, 2.93, { y: 1.55, ry: Math.PI }), // 大镜子挂洗手台上方
      F('towelRack', 8.43, -1.3, { y: 1.35, ry: -Math.PI / 2 }), // 毛巾架东墙
      F('washer', 8.02, 0.2, { ry: -Math.PI / 2 }), // 洗衣机靠东墙
      F('doormat', 5.2, 0.3, { ry: Math.PI / 2 }), // 卫生间门垫
      F('plant', 4.95, -2.5), // 绿植
      F('chandelier', 6.5, 0, { y: WALL_H - 0.04 }), // 卫生间吊灯
      F('socket', BATH_X0 + 0.07, -1.5, { y: 0.38, ry: Math.PI / 2 }), // 卫生间西壁插座

      // —— 客厅补充：熊猫玩偶坐沙发 ——
      F('plushPanda', 0.52, 1.32, { y: 0.47, ry: 2.9 }),

      // —— v5.6 温馨扩展（客厅/卧室/厨房/卫浴） ——
      F('curtain', -1.35, -2.82), // 客厅北墙窗帘（电视旁）
      F('curtain', -ROOM_X + 0.18, 5.5, { ry: Math.PI / 2 }), // 卧室西壁窗帘
      F('fireplace', -ROOM_X + 0.42, 1.9, { ry: Math.PI / 2 }), // 客厅西壁壁炉
      F('fishtank', 3.5, -2.55), // 客厅东北角鱼缸
      F('beanbag', 2.6, 0.55), // 懒人豆袋
      F('guitar', -2.85, 2.5), // 角落吉他
      F('wallShelf', ROOM_X - 0.07, 0.8, { y: 1.4, ry: -Math.PI / 2 }), // 客厅东壁置物架
      F('piano', -0.2, 7.25, { ry: Math.PI }), // 卧室南墙钢琴（西移避开梳妆台，琴凳朝屋内）
      F('standingMirror', 1.25, 4.4, { ry: -Math.PI / 2 }), // 卧室穿衣镜
      F('starLamp', 1.1, 6.3), // 卧室星空灯
      F('canopy', -3.32, 5.6, { ry: -Math.PI / 2 }), // 床幔跟随床位
      F('coffeeMaker', 7.0, 4.3), // 厨房咖啡机
      F('fruitBasket', 2.9, 6.9, { y: 0.74 }), // 餐桌果盘
      F('bathCurtain', 6.35, -1.58), // 浴缸拉帘
      F('toiletries', 6.0, 2.62, { y: 0.86, ry: Math.PI }), // 洗手台洗漱套装
      F('scale', 5.7, 1.5), // 卫生间体重秤

      // —— v5.7 拾光扩展（客厅影音 + 玄关 + 阳台） ——
      // 吊装投影仪：面对西壁幕布对投（v5.9 矫正朝向，老默认光锥朝 +z 打不到幕布）
      F('projector', -2.3, -0.5, { y: WALL_H - 0.34, ry: -Math.PI / 2, rx: 0.16 }),
      F('screen', -ROOM_X + 0.07, -0.5, { y: 1.5, ry: Math.PI / 2 }), // 客厅西壁挂幕布
      F('wallArt', ROOM_X - 0.07, 1.9, { y: 1.5, ry: -Math.PI / 2 }), // 客厅东壁挂画组（置物架旁）
      F('shoeCabinet', 2.6, 2.7, { ry: Math.PI }), // 玄关鞋柜（门旁东墙）
      F('humidifier', -2.9, -2.55), // 客厅书架旁加湿器
      F('wineCabinet', 4.1, 0.4, { ry: -Math.PI / 2 }), // 客厅东南角酒柜
      F('chessTable', -2.4, -1.7), // 客厅西北角棋盘桌
      F('hotpotTable', 3.1, -1.35), // 客厅东北火锅桌
      F('gameConsole', -0.55, -2.72, { y: 0.62 }), // 游戏主机摆上电视柜
      F('vinyl', -1.15, -2.72, { y: 0.62 }), // 黑胶唱片机摆上电视柜（v5.8）
      F('musicBox', 0.1, -2.72, { y: 0.62 }), // 八音盒摆上电视柜（v5.8）
      F('flowerStand', 1.98, 2.62), // 边桌旁花架

      // —— 阳台（卧室南侧，推门而出） ——
      F('swingChair', -3.5, 9.35), // 吊篮秋千椅
      F('loungeChair', -1.5, 9.35, { ry: Math.PI }), // 躺椅面朝南
      F('flowerStand', 1.05, 9.7, { ry: -Math.PI / 2 }), // 花架靠东墙
      F('plant', 0.1, 9.8), // 大绿植
      F('doormat', -1.2, 8.45), // 阳台门垫

      // —— 书房（客厅西侧 annex，v10 推门而入；门洞在东墙 z=0.7） ——
      F('bookcase', -6.6, -2.7), // 开放书架靠北墙
      F('desk', -8.02, -1.8, { ry: Math.PI / 2 }), // 书桌靠西墙（装饰窗下）
      F('chair', -7.12, -1.8, { ry: -Math.PI / 2 }), // 座椅面朝书桌
      F('lampTable', -8.05, -2.42, { y: 0.77 }), // 台灯摆上书桌（北端）
      F('laptop', -7.98, -1.35, { y: 0.78, ry: Math.PI / 2 }), // 手提电脑摆上书桌（南端）
      F('rug', -6.35, 0.6), // 圆地毯（门旁）
      F('doormat', -4.85, 0.7, { ry: Math.PI / 2 }), // 书房门垫
      F('plantSmall', -8.1, 2.55), // 西南角小多肉

      // —— 花园（厨房南侧露天，v10；栅栏门在北栅栏 x=4.5） ——
      F('flowerBox', 2.55, 8.82), // 花箱靠北栅栏（门洞西侧）
      F('flowerBox', 6.9, 8.82), // 花箱靠北栅栏（门洞东侧）
      F('loungeOutdoor', 5.6, 10.7, { ry: -0.5 }), // 户外躺椅（斜朝南）
      F('plant', 7.95, 12.0), // 大绿植（东南角）
    ],
    chars: {
      me: { x: 0.15, z: 2.3, dir: 'up' },
      partner: { x: -0.9, z: 2.1, dir: 'right' },
    },
  };
}

// ---------------- 持久化（idb 缓存 + Prisma 服务端） ----------------

/** 本地缓存（含 rev 的完整包） */
export interface HomePersist {
  home: HomeState;
  rev: number;
}

const KEY = 'couple-home:state3d';
const API = '/api/couple-home';

const valid = (h: HomeState | null | undefined): h is HomeState =>
  !!h && (h as HomeState).v === 5 && Array.isArray(h.furniture) && !!h.chars?.me && !!h.chars?.partner;

// ---------------- v5.1 卧室家具补全迁移（老档案增量补插，不动用户已有布置） ----------------

/** 某个落点附近是否已有落地家具占位（flat 地毯/抬升摆件不算） */
function spotBusy(furn: FurnitureItem[], x: number, z: number, r = 0.55): boolean {
  return furn.some((f) => {
    const e = CATALOG[f.kind];
    if (!e || e.flat || (f.y ?? 0) > 0.45) return false;
    return Math.abs(f.x - x) < r && Math.abs(f.z - z) < r;
  });
}

let migSeq = 0;

/**
 * v5.1 卧室家具补全：老档案缺新家具（毛绒兔/小黄鸭/梳妆台/卧室空调/卧室落地灯）时
 * 按默认布局补插 —— 玩偶跟随床/床头柜的实际位置，其余在落点空闲时才补；幂等，可反复调用。
 */
export function migrateBedroomV51(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const furn = h.furniture.slice();
  const stamp = Date.now().toString(36);
  const add = (kind: FurnitureKind, x: number, z: number, y?: number, ry?: number) =>
    furn.push({ id: `${kind}-mig-${stamp}-${++migSeq}`, kind, x, z, y, ry, st: {} });

  const kinds = new Set(furn.map((f) => f.kind));
  const inBedroom = (kind: string) => furn.some((f) => f.kind === kind && f.z >= BED_Z0 - 0.1);

  // 毛绒兔坐在床上（跟随床的位置与朝向；没有床就放地毯边）
  if (!kinds.has('plushBunny')) {
    const bed = furn.find((f) => f.kind === 'bed');
    if (bed) {
      // 默认：床 ry=-π/2、兔偏移 (+0.70, -0.48)；按用户床的实际朝向旋转变换偏移
      const a = (bed.ry ?? 0) + Math.PI / 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      add('plushBunny', bed.x + 0.7 * c - 0.48 * s, bed.z - 0.7 * s - 0.48 * c, 0.42, (bed.ry ?? 0) - 0.8);
    } else if (!spotBusy(furn, -0.2, 5.6, 0.4)) {
      add('plushBunny', -0.2, 5.6, 0, -2.3);
    }
  }
  // 小黄鸭摆上床头柜（跟随第一只床头柜实际位置）
  if (!kinds.has('plushDuck')) {
    const ns = furn.find((f) => f.kind === 'nightstand');
    if (ns) add('plushDuck', ns.x, ns.z, 0.53, 0.5);
  }
  // 梳妆台（卧室南墙东侧）：老档案的绿植常占着这个位（旧默认 (1.0,7.4)）→ 让位到新默认点再补
  if (!kinds.has('vanity')) {
    if (!spotBusy(furn, 0.95, 7.5, 0.85)) {
      add('vanity', 0.95, 7.5, 0, Math.PI);
    } else {
      const blocker = furn.find(
        (f) => f.kind === 'plant' && f.z >= BED_Z0 && Math.abs(f.x - 0.95) < 0.85 && Math.abs(f.z - 7.5) < 0.85 && (f.y ?? 0) <= 0.45,
      );
      if (blocker && !spotBusy(furn.filter((f) => f !== blocker), -0.35, 7.55, 0.6)) {
        blocker.x = -0.35;
        blocker.z = 7.55;
        add('vanity', 0.95, 7.5, 0, Math.PI);
      }
    }
  }
  // 卧室空调（全屋只有一台且卧室没有 → 补到卧室东墙）
  if (furn.filter((f) => f.kind === 'aircon').length === 1 && !inBedroom('aircon')) {
    add('aircon', 1.4, 5.6, 1.85, -Math.PI / 2);
  }
  // 卧室落地灯（西南角，空闲才补）
  if (!inBedroom('lampFloor') && !spotBusy(furn, -4.05, 7.3, 0.5)) add('lampFloor', -4.05, 7.3, 0, 0);

  if (furn.length === h.furniture.length) return h;
  return { ...h, furniture: furn };
}

let migSeq2 = 0;

/**
 * v5.2 厨房开放迁移：老档案补插整套厨房家具 + 三款新相框（幂等，不动用户已有布置）。
 * 厨房区域（卧室东侧）老档必为空，直接按默认布局落位；拍立得跟随吧台有无决定上桌/落地。
 */
export function migrateKitchenV52(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const furn = h.furniture.slice();
  const stamp = Date.now().toString(36);
  const add = (kind: FurnitureKind, x: number, z: number, y?: number, ry?: number) =>
    furn.push({ id: `${kind}-mig2-${stamp}-${++migSeq2}`, kind, x, z, y, ry, st: {} });

  const kinds = new Set(furn.map((f) => f.kind));
  const hasKitchen = kinds.has('fridge') || kinds.has('stove') || kinds.has('sink') || kinds.has('kitchenBar');

  if (!hasKitchen) {
    add('fridge', 7.0, 3.41, 0, 0);
    add('stove', 6.0, 3.57, 0, 0);
    add('sink', 5.0, 3.57, 0, 0);
    add('kitchenBar', 7.2, 5.4, 0, -Math.PI / 2);
    add('chair', 6.55, 5.12, 0, Math.PI / 2);
    add('chair', 6.55, 5.68, 0, Math.PI / 2);
    add('plantSmall', 7.2, 5.68, 0.85, 0);
    add('diningTable', 3.3, 6.5, 0, 0);
    add('chair', 2.2, 6.5, 0, Math.PI / 2);
    add('chair', 4.4, 6.5, 0, -Math.PI / 2);
    add('microwave', 3.0, 6.2, 0.74, 0.3);
    add('toaster', 3.6, 6.75, 0.74, -0.2);
    add('doormat', KDOOR_X, 3.75, 0, 0);
    add('plant', 1.95, 7.5, 0, 0);
  }
  // 拍立得：有吧台就上吧台，否则落地
  if (!kinds.has('polaroid')) {
    if (kinds.has('kitchenBar')) add('polaroid', 7.2, 5.08, 0.85, -Math.PI / 2 + 0.2);
    else add('polaroid', 6.6, 4.6, 0, -Math.PI / 2 + 0.2);
  }
  // 三款新相框：厨房南壁 / 客厅西墙横框（老档这两面墙均空余；厨房东壁留给卫生间门）
  if (!kinds.has('photoWall')) add('photoWall', 6.4, BED_Z1 - 0.07, 1.45, Math.PI);
  if (!kinds.has('photoWallWide')) add('photoWallWide', -ROOM_X + 0.07, 1.7, 1.5, Math.PI / 2);

  if (furn.length === h.furniture.length) return h;
  return { ...h, furniture: furn };
}

let migSeq3 = 0;

/**
 * v5.3 卫生间 + 小物全家桶迁移（幂等，不动用户已有布置）：
 * - 卫生间（厨房东侧）老档必空 → 补浴缸/马桶/洗衣机/门垫/绿植；
 * - 吊灯（四房间逐间检查）/ 插座（四房间）/ 落地风扇 / 厨具小物（跟随灶台/餐桌/吧台实际位置）；
 * - 新玩偶（滚滚/呼噜/咪咪）跟随沙发/床/脚凳实际位置；
 * - 旧档挂在厨房东壁的相框让位给卫生间门 → 挪到厨房南壁。
 */
export function migrateBathV53(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const furn = h.furniture.slice();
  const stamp = Date.now().toString(36);
  const add = (kind: FurnitureKind, x: number, z: number, y?: number, ry?: number) =>
    furn.push({ id: `${kind}-mig3-${stamp}-${++migSeq3}`, kind, x, z, y, ry, st: {} });
  const kinds = new Set(furn.map((f) => f.kind));
  const inRoom = (kind: string, room: RoomId) =>
    furn.some((f) => f.kind === kind && roomAt(f.x, f.z) === room);

  // 旧档相框挂在厨房东壁（卫生间门的位置）→ 挪到厨房南壁
  const ktEastFrame = furn.find(
    (f) => f.kind === 'photoWall' && Math.abs(f.x - (KTCH_X1 - 0.07)) < 0.12,
  );
  if (ktEastFrame) {
    ktEastFrame.x = 6.4;
    ktEastFrame.z = BED_Z1 - 0.07;
    ktEastFrame.ry = Math.PI;
  }

  // 卫生间（老档必空：无任何家具落在卫生间区域）
  const hasBath = furn.some((f) => roomAt(f.x, f.z) === 'ba');
  if (!hasBath) {
    add('bathtub', 9.5, 3.7, 0, 0);
    add('toilet', 8.05, 3.62, 0, -Math.PI / 2);
    add('washer', 10.85, 7.3, 0, Math.PI);
    add('doormat', 8.35, 7.0, 0, Math.PI / 2);
    add('plant', 11.0, 3.45, 0, 0);
  }
  // 吊灯：逐间补（阳台不装吊灯/插座）
  for (const room of ['lr', 'br', 'kt', 'ba'] as const) {
    if (!inRoom('chandelier', room)) {
      const spot: Partial<Record<RoomId, [number, number]>> = {
        lr: [0, 0.2], br: [-1.5, 5.5], kt: [4.5, 5.5], ba: [9.5, 5.5],
      };
      const s = spot[room];
      if (s) add('chandelier', s[0], s[1], WALL_H - 0.04, 0);
    }
  }
  // 插座：逐间补
  for (const room of ['lr', 'br', 'kt', 'ba'] as const) {
    if (!inRoom('socket', room)) {
      const spot: Partial<Record<RoomId, [number, number, number]>> = {
        lr: [ROOM_X - 0.07, -0.9, -Math.PI / 2],
        br: [-ROOM_X + 0.07, 3.7, Math.PI / 2],
        kt: [4.2, BED_Z0 + 0.19, 0],
        ba: [KTCH_X1 + 0.07, 3.6, Math.PI / 2],
      };
      const s = spot[room];
      if (s) add('socket', s[0], s[1], 0.38, s[2]);
    }
  }
  // 落地风扇
  if (!kinds.has('fan')) add('fan', 3.7, 1.75, 0, -2.4);
  // 厨具小物：跟随灶台/餐桌/吧台实际位置
  if (!kinds.has('pot')) {
    const stove = furn.find((f) => f.kind === 'stove');
    if (stove) {
      add('pot', stove.x - 0.18, stove.z - 0.05, 0.92, 0);
      add('kettle', stove.x + 0.3, stove.z - 0.22, 0.92, -0.5);
    }
  }
  if (!kinds.has('bowls')) {
    const dt = furn.find((f) => f.kind === 'diningTable');
    if (dt) {
      add('bowls', dt.x - 0.45, dt.z + 0.12, 0.74, 0);
      add('plates', dt.x + 0.42, dt.z - 0.18, 0.74, 0);
      add('chopsticks', dt.x - 0.02, dt.z + 0.28, 0.74, 0);
      add('juicer', dt.x + 0.32, dt.z + 0.1, 0.74, 0.5);
    }
  }
  if (!kinds.has('cup')) {
    const bar = furn.find((f) => f.kind === 'kitchenBar');
    if (bar) add('cup', bar.x, bar.z, 0.86, 0.4);
  }
  // 新玩偶：跟随沙发/床/脚凳
  if (!kinds.has('plushPanda')) {
    const sofa = furn.find((f) => f.kind === 'sofa');
    if (sofa) add('plushPanda', sofa.x + 0.37, sofa.z - 0.03, 0.47, (sofa.ry ?? 0) + 2.9);
    else add('plushPanda', 0.5, 2.0, 0, 2.9);
  }
  if (!kinds.has('plushPig')) {
    const bed = furn.find((f) => f.kind === 'bed');
    if (bed) add('plushPig', bed.x + 0.47, bed.z + 0.35, 0.42, (bed.ry ?? 0) + 2.2);
    else add('plushPig', -1.0, 5.8, 0, 2.2);
  }
  if (!kinds.has('plushCat')) {
    const ot = furn.find((f) => f.kind === 'ottoman');
    if (ot) add('plushCat', ot.x, ot.z, 0.4, -0.7);
    else add('plushCat', -1.5, 0.5, 0, -0.7);
  }

  if (furn.length === h.furniture.length && !ktEastFrame) return h;
  return { ...h, furniture: furn };
}

let migSeq4 = 0;

/**
 * v5.4 卫生间搬家迁移（幂等）：卫生间从厨房东侧（x 7.5~11.5, z 3~8）整体搬到客厅东侧
 * （x 4.5~8.5, z -3~3），门改开在客厅东墙；旧位默认洁具按新布局重摆，用户自买件钳进新浴室，
 * 并补齐淋浴房/洗手台/大镜子/毛巾架；旧门位/旧窗位越界自动复位到新默认。
 */
export function migrateBathV54(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const OLD_BATH = (x: number, z: number) => x > 7.52 && z > 3.05;
  const NEW_BATH = (x: number, z: number) =>
    x >= BATH_X0 - 0.1 && x <= BATH_X1 + 0.1 && z >= BATH_Z0 - 0.1 && z <= BATH_Z1 + 0.1;
  const hadOld = h.furniture.some((f) => OLD_BATH(f.x, f.z));
  const hadNew = h.furniture.some((f) => NEW_BATH(f.x, f.z));
  const doorPos = h.doorPos ? { ...h.doorPos } : undefined;
  const winPos = h.winPos ? h.winPos.slice() : undefined;
  const bathDefaults: [FurnitureKind, number, number, number?, number?][] = [
    ['bathtub', 6.35, -2.28, 0, 0],
    ['shower', 7.98, 2.5, 0, 0],
    ['toilet', 4.98, 2.3, 0, Math.PI / 2],
    ['basin', 6.3, 2.62, 0, Math.PI],
    ['mirror', 6.3, 2.93, 1.55, Math.PI],
    ['towelRack', 8.43, -1.3, 1.35, -Math.PI / 2],
    ['washer', 8.02, 0.2, 0, -Math.PI / 2],
    ['doormat', 5.2, 0.3, 0, Math.PI / 2],
    ['plant', 4.95, -2.5, 0, 0],
    ['chandelier', 6.5, 0, WALL_H - 0.04, 0],
    ['socket', BATH_X0 + 0.07, -1.5, 0.38, Math.PI / 2],
  ];
  const doorReset = !!doorPos?.bath && (doorPos.bath < -2.2 || doorPos.bath > 2.2);
  const win7Reset = !!winPos && winPos[7] != null && (winPos[7] < 5.1 || winPos[7] > 7.7);
  const win8Reset = !!winPos && winPos[8] != null && (winPos[8] < -1.6 || winPos[8] > 2.0);
  if (!hadOld && hadNew && !doorReset && !win7Reset && !win8Reset) return h;

  const furn = h.furniture.slice();
  const stamp = Date.now().toString(36);
  const add = (kind: FurnitureKind, x: number, z: number, y?: number, ry?: number) =>
    furn.push({ id: `${kind}-mig4-${stamp}-${++migSeq4}`, kind, x, z, y, ry, st: {} });

  // 1) 旧浴室里的默认套装删除（按新布局重加），用户自买件平移进新浴室
  const defaultKinds = new Set(bathDefaults.map(([k]) => k));
  for (let i = furn.length - 1; i >= 0; i--) {
    const f = furn[i];
    if (!OLD_BATH(f.x, f.z)) continue;
    if (defaultKinds.has(f.kind)) {
      furn.splice(i, 1);
      continue;
    }
    f.x = Math.min(BATH_X1 - 0.4, Math.max(BATH_X0 + 0.4, f.x - 3));
    f.z = Math.min(BATH_Z1 - 0.4, Math.max(BATH_Z0 + 0.4, f.z - 6));
  }

  // 2) 新浴室缺的默认件补齐
  const inNew = (kind: string) => furn.some((f) => f.kind === kind && NEW_BATH(f.x, f.z));
  for (const [kind, x, z, y, ry] of bathDefaults) {
    if (!inNew(kind)) add(kind, x, z, y, ry);
  }

  // 3) 旧门位/旧窗位越界 → 复位到新默认
  if (doorPos && doorReset) doorPos.bath = BDOOR_Z;
  if (winPos) {
    if (win7Reset) winPos[7] = 6.4;
    if (win8Reset) winPos[8] = 1.2;
  }

  return { ...h, furniture: furn, doorPos, winPos };
}

let migSeq5 = 0;

/**
 * v5.5 家具互动迁移（幂等）：老档案补一台手提电脑 —— 跟随书桌实际位置与朝向
 * 落在桌面前缘（local (-0.3, 0.34)，避开常驻的收音机 local (0.2, 0.05)）；没有书桌就不补（可商店购买）。
 */
export function migrateActV55(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  if (h.furniture.some((f) => f.kind === 'laptop')) return h;
  const desk = h.furniture.find((f) => f.kind === 'desk');
  if (!desk) return h;
  const ry = desk.ry ?? 0;
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const lx = -0.3;
  const lz = 0.34;
  const furn: FurnitureItem[] = [
    ...h.furniture,
    {
      id: `laptop-mig5-${Date.now().toString(36)}-${++migSeq5}`,
      kind: 'laptop',
      x: desk.x + lx * c + lz * s,
      z: desk.z - lx * s + lz * c,
      y: 0.78,
      ry,
      st: {},
    },
  ];
  return { ...h, furniture: furn };
}

let migSeq6 = 0;

/**
 * v5.6 温馨扩展迁移（幂等）：老档案补新家具 —— 窗帘×2/壁炉/鱼缸/豆袋/钢琴/吉他/
 * 穿衣镜/星空灯/咖啡机/果盘/浴帘/洗漱套装/体重秤/挂墙架/床幔（跟随床位）。
 * 同类件全屋已有就不补（尊重用户删除），落点被占也不补。
 */
export function migrateCozyV56(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const has = (kind: string) => h.furniture.some((f) => f.kind === kind);
  // 首版 v5.6 迁移坐标落错房间（x>1.5 已是厨房）→ 老档矫正（仅当坐标仍等于旧默认值，不动用户已搬动的）
  const COZY_FIX: [string, number, number, number, number, number?][] = [
    // kind, 旧x, 旧z, 新x, 新z, 新ry
    ['piano', 2.35, 7.25, 0.35, 7.25, Math.PI],
    ['standingMirror', 2.2, 4.1, 1.25, 4.4, -Math.PI / 2],
    ['starLamp', 2.3, 6.35, 1.1, 6.3],
  ];
  let fixed = false;
  for (const f of h.furniture) {
    const fix = COZY_FIX.find(([k]) => f.kind === k);
    if (!fix) continue;
    const [, ox, oz, nx, nz, nry] = fix;
    if (Math.abs(f.x - ox) < 0.02 && Math.abs(f.z - oz) < 0.02) {
      f.x = nx;
      f.z = nz;
      if (nry != null) f.ry = nry;
      fixed = true;
    }
  }
  const missing = [
    'curtain', 'fireplace', 'fishtank', 'beanbag', 'piano', 'guitar', 'standingMirror',
    'starLamp', 'canopy', 'coffeeMaker', 'fruitBasket', 'bathCurtain', 'toiletries', 'scale', 'wallShelf',
  ].filter((k) => !has(k));
  if (missing.length === 0) return h; // fixed 已原地生效（矫正直接改 h.furniture）

  const furn = h.furniture.slice();
  const stamp = Date.now().toString(36);
  const add = (kind: FurnitureKind, x: number, z: number, opts: { ry?: number; y?: number } = {}) =>
    furn.push({ id: `${kind}-mig6-${stamp}-${++migSeq6}`, kind, x, z, ry: opts.ry ?? 0, y: opts.y, st: {} });

  // 落点空闲才补（避开用户摆好的家具；y>0.45 的台面件/flat 件不算占位）
  const free = (x: number, z: number, r = 0.5) =>
    !furn.some((f) => {
      const e = CATALOG[f.kind];
      if (!e || e.flat || (f.y ?? 0) > 0.45) return false;
      return Math.abs(f.x - x) < r && Math.abs(f.z - z) < r;
    });

  if (missing.includes('curtain')) {
    if (free(-1.35, -2.82, 0.4)) add('curtain', -1.35, -2.82); // 客厅北墙电视旁
    if (!furn.some((f) => f.kind === 'curtain') && free(-ROOM_X + 0.18, 5.5, 0.5))
      add('curtain', -ROOM_X + 0.18, 5.5, { ry: Math.PI / 2 }); // 卧室西壁
  }
  if (missing.includes('fireplace') && free(-ROOM_X + 0.42, 1.9, 0.55)) add('fireplace', -ROOM_X + 0.42, 1.9, { ry: Math.PI / 2 });
  if (missing.includes('fishtank') && free(3.5, -2.55, 0.5)) add('fishtank', 3.5, -2.55);
  if (missing.includes('beanbag') && free(2.6, 0.55, 0.5)) add('beanbag', 2.6, 0.55);
  if (missing.includes('piano') && free(0.35, 7.25, 0.62)) add('piano', 0.35, 7.25, { ry: Math.PI }); // 卧室东南角（琴凳朝屋内）
  if (missing.includes('guitar') && free(-2.85, 2.5, 0.45)) add('guitar', -2.85, 2.5);
  if (missing.includes('standingMirror') && free(1.25, 4.4, 0.5)) add('standingMirror', 1.25, 4.4, { ry: -Math.PI / 2 });
  if (missing.includes('starLamp') && free(1.1, 6.3, 0.4)) add('starLamp', 1.1, 6.3);
  if (missing.includes('coffeeMaker') && free(7.0, 4.3, 0.4)) add('coffeeMaker', 7.0, 4.3); // 厨房落地待上柜
  if (missing.includes('fruitBasket') && free(2.9, 6.9, 0.3)) add('fruitBasket', 2.9, 6.9, { y: 0.74 }); // 餐桌上
  if (missing.includes('bathCurtain') && free(6.35, -1.58, 0.4)) add('bathCurtain', 6.35, -1.58); // 浴缸前
  if (missing.includes('toiletries')) add('toiletries', 6.0, 2.62, { y: 0.86, ry: Math.PI }); // 洗手台上
  if (missing.includes('scale') && free(5.7, 1.5, 0.35)) add('scale', 5.7, 1.5);
  if (missing.includes('wallShelf')) add('wallShelf', ROOM_X - 0.07, 0.8, { y: 1.4, ry: -Math.PI / 2 }); // 客厅东壁
  if (missing.includes('canopy')) {
    const bed = furn.find((f) => f.kind === 'bed');
    if (bed) add('canopy', bed.x, bed.z, { ry: bed.ry ?? 0 }); // 跟随床位罩在床上
  }
  return { ...h, furniture: furn };
}

let migSeq7 = 0;

/**
 * v5.7 拾光扩展迁移（幂等）：老档案补新家具 —— 投影仪/幕布/挂画组/玄关鞋柜/加湿器/酒柜/
 * 棋盘桌/火锅桌/游戏主机（跟随电视柜）/吊床/花架 + 阳台默认套装（阳台老档必空）。
 * 同类件全屋已有就不补（尊重用户删除），落点被占也不补（阳台套装除外，阳台保证可玩）。
 */
export function migrateShineV57(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const has = (kind: string) => h.furniture.some((f) => f.kind === kind);
  const need: [string, number, number, number?, number?][] = [
    // kind, x, z, y, ry（客厅优先位；落点被占则放弃该件）
    ['projector', -2.3, -0.5, WALL_H - 0.34, -Math.PI / 2],
    ['screen', -ROOM_X + 0.07, -0.5, 1.5, Math.PI / 2],
    ['wallArt', ROOM_X - 0.07, 1.9, 1.5, -Math.PI / 2],
    ['shoeCabinet', 2.6, 2.7, 0, Math.PI],
    ['humidifier', -2.9, -2.55, 0, 0],
    ['wineCabinet', 4.1, 0.4, 0, -Math.PI / 2],
    ['chessTable', -2.4, -1.7, 0, 0],
    ['hotpotTable', 3.1, -1.35, 0, 0],
  ];
  const missing = need.filter(([k]) => !has(k));
  const gameConsoleMissing = !has('gameConsole');
  const flowerStandMissing = !has('flowerStand');
  // 阳台老档必空（v5.7 新增区域）
  const balconyEmpty = !h.furniture.some((f) => roomAt(f.x, f.z) === 'bal');
  if (missing.length === 0 && !gameConsoleMissing && !flowerStandMissing && !balconyEmpty) return h;

  const furn = h.furniture.slice();
  const stamp = Date.now().toString(36);
  const add = (kind: FurnitureKind, x: number, z: number, y?: number, ry?: number) =>
    furn.push({ id: `${kind}-mig7-${stamp}-${++migSeq7}`, kind, x, z, ry: ry ?? 0, y, st: {} });

  // 落点空闲才补（台面件/flat 件不算占位）
  const free = (x: number, z: number, r = 0.5) =>
    !furn.some((f) => {
      const e = CATALOG[f.kind];
      if (!e || e.flat || (f.y ?? 0) > 0.45) return false;
      return Math.abs(f.x - x) < r && Math.abs(f.z - z) < r;
    });

  for (const [kind, x, z, y, ry] of missing) {
    if (free(x, z, 0.55)) add(kind as FurnitureKind, x, z, y, ry);
  }
  // 游戏主机跟随电视柜（柜面摆机 + 手柄）；没电视柜就落地客厅北墙边
  if (gameConsoleMissing) {
    const tvStand = furn.find((f) => f.kind === 'tvStand');
    if (tvStand) add('gameConsole', tvStand.x - 0.55, tvStand.z, 0.62, tvStand.ry ?? 0);
    else if (free(-3.4, -2.6, 0.4)) add('gameConsole', -3.4, -2.6);
  }
  if (flowerStandMissing && free(1.98, 2.62, 0.45)) add('flowerStand', 1.98, 2.62);
  // 阳台默认套装（阳台保证可玩：吊椅 + 躺椅 + 花架 + 绿植 + 门垫）
  if (balconyEmpty) {
    add('swingChair', -3.5, 9.35);
    add('loungeChair', -1.5, 9.35, 0, Math.PI);
    add('flowerStand', 1.05, 9.7, 0, -Math.PI / 2);
    add('plant', 0.1, 9.8);
    add('doormat', -1.2, 8.45);
  }
  return { ...h, furniture: furn };
}

let migSeq14 = 0;

/**
 * v5.8 旋律扩展迁移（幂等）：
 * ① 老档补黑胶唱片机 + 八音盒（电视柜台面，落点被占则贴柜落地）；
 * ② 修复 v5.6/v5.7 自动落点的卧室南岸撞车（钢琴压梳妆台/绿植塞进琴身/吊床压钢琴琴凳）——
 *    仅当家具仍在自动落点（用户没自己挪过）时才矫正。
 */
export function migrateMelodyV14(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const furn = h.furniture.slice();
  const stamp = Date.now().toString(36);
  const add = (kind: FurnitureKind, x: number, z: number, y?: number, ry?: number) =>
    furn.push({ id: `${kind}-mig14-${stamp}-${++migSeq14}`, kind, x, z, ry: ry ?? 0, y, st: {} });

  // ① 黑胶唱片机 + 八音盒：跟电视柜台面（同 v5.7 主机规则直接摆上柜，柜面互不重叠）；
  //    首版迁移曾因 free() 被电视柜本体/窗帘挡住而落到柜前地面（-?,-2.25, y=0）→ 顺手挪上柜面
  const tvStand = furn.find((f) => f.kind === 'tvStand');
  const vinyl = furn.find((f) => f.kind === 'vinyl');
  if (!vinyl) {
    if (tvStand) add('vinyl', tvStand.x - 1.15, tvStand.z, 0.62, tvStand.ry ?? 0);
    else add('vinyl', -1.15, -2.4);
  } else if (
    tvStand &&
    Math.abs(vinyl.x - (tvStand.x - 1.15)) < 0.06 &&
    Math.abs(vinyl.z + 2.25) < 0.06 &&
    (vinyl.y ?? 0) < 0.45
  ) {
    vinyl.x = tvStand.x - 1.15;
    vinyl.z = tvStand.z;
    vinyl.y = 0.62;
    vinyl.ry = tvStand.ry ?? 0;
  }
  const musicBox = furn.find((f) => f.kind === 'musicBox');
  if (!musicBox) {
    if (tvStand) add('musicBox', tvStand.x + 0.1, tvStand.z, 0.62, tvStand.ry ?? 0);
    else add('musicBox', 0.55, -2.4);
  } else if (
    tvStand &&
    Math.abs(musicBox.x - (tvStand.x + 0.1)) < 0.06 &&
    Math.abs(musicBox.z + 2.25) < 0.06 &&
    (musicBox.y ?? 0) < 0.45
  ) {
    musicBox.x = tvStand.x + 0.1;
    musicBox.z = tvStand.z;
    musicBox.y = 0.62;
    musicBox.ry = tvStand.ry ?? 0;
  }

  // ② 卧室南岸撞车矫正（只动仍在自动落点的件）
  // 绿植（v5.1 自动落点 -0.35,7.55 会塞进钢琴）→ 先挪，钢琴才能西移
  // ⚑ 直接按落点匹配（全屋有多盆 plant，find 第一个会找错）
  const plant = furn.find((f) => f.kind === 'plant' && Math.abs(f.x + 0.35) < 0.06 && Math.abs(f.z - 7.55) < 0.06);
  if (plant) {
    plant.x = -1.15;
  }
  // 钢琴（v5.6 自动落点 0.35,7.25 东端压梳妆台）→ 西移 0.55
  const piano = furn.find((f) => f.kind === 'piano');
  if (piano && Math.abs(piano.x - 0.35) < 0.06 && Math.abs(piano.z - 7.25) < 0.06) {
    piano.x = -0.2;
  }
  return { ...h, furniture: furn };
}

/**
 * v5.9 静修迁移（幂等）：① 吊床删除（用户要求下架）；
 * ② 投影仪老默认吊点 (0,0.2) 光锥朝 +z 打不到西壁幕布 → 挪到幕布对面吊装对投（俯角 0.16）；
 * ③ 卧室南窗老默认与阳台门同位（都在 x=-1.2，窗浮在门洞上）→ 窗挪到门洞东侧 0.35。
 */
export function migrateSereneV15(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const furn = h.furniture.slice();
  // ① 吊床删除（kind 已从类型移除，老档按字符串匹配移除）
  const hammockIdx = furn.findIndex((f) => (f.kind as string) === 'hammock');
  if (hammockIdx >= 0) furn.splice(hammockIdx, 1);
  // ② 投影仪朝向矫正（仅动仍在老默认吊点的件）
  const proj = furn.find((f) => f.kind === 'projector');
  if (proj && Math.abs(proj.x) < 0.06 && Math.abs(proj.z - 0.2) < 0.06) {
    proj.x = -2.3;
    proj.z = -0.5;
    proj.y = WALL_H - 0.34;
    proj.ry = -Math.PI / 2;
    proj.rx = 0.16;
  }
  // ③ 卧室南窗避让阳台门（老默认重叠；门也滑到东侧时同样避让）
  const balDoor = h.doorPos?.bal ?? -1.2;
  const win4 = h.winPos?.[4];
  if (win4 === undefined || Math.abs(win4 - balDoor) < 1.5) {
    const winPos = h.winPos ? h.winPos.slice() : [];
    winPos[4] = 0.35;
    h = { ...h, winPos };
  }
  return { ...h, furniture: furn };
}

/** 老档全量迁移链：卧室补全 → 厨房开放 → 卫生间+小物全家桶 → 卫生间搬家（v5.4 客厅东侧） → 家具互动补全 → 温馨扩展 → 拾光扩展 → 旋律扩展 → 静修扩展 */
export function migrateHome(h: HomeState): HomeState {
  return migrateSereneV15(
    migrateMelodyV14(
      migrateShineV57(migrateCozyV56(migrateActV55(migrateBathV54(migrateBathV53(migrateKitchenV52(migrateBedroomV51(h))))))),
    ),
  );
}

/** 同步读缓存（首屏即时渲染；无则 null） */
export function loadCache(): HomePersist | null {
  const saved = kvGet<HomePersist>(KEY);
  if (saved && valid(saved.home)) return { ...saved, home: migrateHome(saved.home) };
  return null;
}

/** 写缓存（节流） */
export function saveCache(p: HomePersist): void {
  kvSetDebounced(KEY, p);
}

/** 立即写缓存（重要节点：进出编辑模式等） */
export function saveCacheNow(p: HomePersist): void {
  kvSet(KEY, p);
}

/** 拉服务端档案；返回 null = 无档案（客户端播种默认布局） */
export async function fetchRemote(): Promise<HomePersist | null> {
  try {
    const res = await fetch(API, { headers: { 'X-Workspace-Id': getWorkspaceId() }, cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: HomeState | null; rev: number };
    if (!valid(json.data)) return null;
    return { home: migrateHome(json.data), rev: json.rev ?? 0 };
  } catch {
    return null;
  }
}

/** 推送结果：成功（新 rev）/ 冲突（带服务端最新供采纳）/ 离线或服务端异常（保持本地稍后重试） */
export type PushResult = HomePersist | 'offline' | { conflict: HomePersist };

/** 推服务端（防抖由调用方控制）；409 冲突时返回服务端最新档案供采纳 */
export async function pushRemote(p: HomePersist): Promise<PushResult> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': getWorkspaceId() },
      body: JSON.stringify({ data: p.home, rev: p.rev }),
    });
    if (res.status === 409) {
      const json = (await res.json()) as { data: HomeState | null; rev: number };
      if (!valid(json.data)) return 'offline';
      return { conflict: { home: json.data, rev: json.rev } };
    }
    if (!res.ok) return 'offline';
    const json = (await res.json()) as { rev: number };
    return { home: p.home, rev: json.rev ?? p.rev };
  } catch {
    return 'offline'; // 网络失败：保持本地，下次再推
  }
}

/** 重置：服务端删档 + 清本地缓存，返回默认包 */
export async function resetRemote(): Promise<HomePersist> {
  try {
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': getWorkspaceId() },
      body: JSON.stringify({ action: 'reset' }),
    });
  } catch {
    /* 离线也照样本地重置 */
  }
  const fresh: HomePersist = { home: defaultHome(), rev: 0 };
  kvSet(KEY, fresh);
  return fresh;
}

// ---------------- 交互节奏 ----------------

/** playful 家具点击弹跳冷却（秒） */
export const PLAY_COOLDOWN = 3;
