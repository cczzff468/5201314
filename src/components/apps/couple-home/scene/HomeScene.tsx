'use client';

/* eslint-disable react-hooks/immutability -- R3F/游戏循环需要原地修改 three 对象与运行时小人状态 */

/**
 * 情侣小家 3D —— 场景主体（R3F Canvas 内核，v5 两室一厅）
 *
 * - 生活模式：镜头跟随小人（滑动全方位旋转视角：左右任意转 + 上下低角↔近俯瞰；
 *   拖拽时 1:1 直接控制，松手恢复平滑跟随）+ 摇杆/WASD 移动 + 碰撞；
 *   指针系统按 pointerId 跟踪（双指捏合在生活模式不再引发旋转/缩放混乱）；
 *   从装修模式退出时从当前相机位置反推球坐标无缝接管 + 缩短追赶窗口；
 * - 走出家门：点门开门后，小人可经门洞走进卧室（隔墙两侧行走钳制 + 门走廊判定）；
 * - 编辑模式：OrbitControls 上帝视角 + 家具拖拽（双房间钳制 + 0.25m 吸附）
 *   + 移动模式（选中后拖动画面任意位置搬运）+ 四向按钮微调 + 缩放按钮；
 *   拖拽辅助 DragAid：全屋对齐网格增亮 + 吸附底座 + 重叠红框警告（E2）；
 * - 昼夜灯光切换：白天暖阳光 + 夜晚冷月光 + 灯具/窗户点光；开灯越多环境光越亮越暖（E7）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor } from '@react-three/drei';
import Room, { buildWallBoxes } from './Room';
import Furn3D from './Furn3D';
import CharChibi3D from './CharChibi3D';
import {
  BAL_X0,
  BAL_X1,
  BAL_Z0,
  BAL_Z1,
  BATH_X0,
  BATH_X1,
  BATH_Z0,
  BATH_Z1,
  BED_X1,
  BED_Z0,
  BED_Z1,
  CATALOG,
  clampFurnToRooms,
  DOOR_PASS,
  KTCH_X1,
  ROOM_SPANS,
  ROOM_X,
  ROOM_Z,
  SNAP,
  DOORS,
  WINS,
  footprintOf,
  resolveDoorPos,
  resolveWinPos,
  roomAt,
} from '../catalog';
import type { BoyWear, CatalogEntry, CharAction, CharPose, CharRT, FurnitureItem, GirlWear, HomeMode, HomeWeather, Pet2State, PetCareKind, PetCoat, PetState, PetWear, RoomId } from '../types';
import { sfx } from '../sfx';
import { buildBlockGrid, planRoute, type BlockGrid, type DoorKey, type Pt } from './pathfind';
import { SRDOOR_Z, STUDY_X0, STUDY_X1, STUDY_Z0, STUDY_Z1, YDOOR_X, GARDEN_X0, GARDEN_X1, GARDEN_Z0, GARDEN_Z1 } from '../catalog';
import { weatherBusSet, seasonNow, type Season } from './weather-bus';
import { companionStep, createCompanionRT, type CompanionCmd, type CompanionEvent, type CompanionRT, type PoseSlot } from './companion-rt';
import { notifyTaBubbleIfHidden } from './cabin-notify';
import { silenceThreeClockWarn } from './three-quiet';

// C4 技术债：R3F 9.x 内部仍 new THREE.Clock()（three r183 起已弃用）→ 每次进小屋
// 控制台都刷弃用警告。模块加载时先装上静默过滤器（透传其余 log/warn/error）再挂 Canvas。
silenceThreeClockWarn();

// ---------------- 对外 Props ----------------

export interface HomeSceneProps {
  items: FurnitureItem[];
  mode: HomeMode;
  night: boolean;
  selId: string | null;
  /** 移动模式：true = 拖动画面即可搬运选中家具 */
  moveOn: boolean;
  meRT: CharRT;
  taRT: CharRT;
  joyRef: RefObject<{ dx: number; dy: number }>;
  /** 缩放指令队列（HUD 按钮 → 场内相机） */
  zoomCmd: RefObject<{ v: number; dir: number }>;
  /** 四向微调指令（HUD 方向按钮 → 按当前视角方位换算世界轴） */
  moveCmd: RefObject<{ v: number; dir: 'up' | 'down' | 'left' | 'right' }>;
  onNudge: (dx: number, dz: number) => void;
  /** 第一人称视角（true = 小人就是「我」） */
  fp?: boolean;
  fpRef: RefObject<{ on: boolean }>;
  /** 「我」的姿势 + 支撑面高度（坐下/睡觉/泡澡） */
  poseRef: RefObject<{ pose: CharPose; y: number }>;
  /** 正在执行的家具动作 */
  actRef: RefObject<CharAction | null>;
  /** 手持物（true = 右手拿小水杯，拿饮料/咖啡后端着到处逛） */
  carryRef?: RefObject<{ cup: boolean; coffee?: boolean; pet?: boolean }>;
  /** v7.2 抱抱指令（on=true 抱起 / on=false 放下；seq 变化触发） */
  petCarryCmdRef?: RefObject<{ on: boolean; seq: number; target?: string }>;
  /** 乐器弹奏特写（非 null = 镜头推近该乐器；覆盖层 UI 发声） */
  instRef?: RefObject<{ kind: 'piano' | 'guitar'; itemId: string } | null>;
  /** 浴缸水龙头点击（放水/关水） */
  onFaucetTap?: (item: FurnitureItem) => void;
  /** 九扇窗开态 + 切换回调 */
  win?: boolean[];
  onToggleWin?: (i: number) => void;
  /** 每扇窗是否存在（false = 已被收起不渲染） */
  winExist?: boolean[];
  /** 每扇窗沿墙坐标 / 三扇门沿墙坐标 */
  winPos?: number[];
  doorPos?: { bed: number; kt: number; bath: number; bal?: number };
  /** 用户自定义地板/墙/门/窗框颜色（客厅） */
  floorCol?: string;
  wallCol?: string;
  doorCol?: string;
  winCol?: string;
  /** 卧室/厨房/卫生间地板墙壁 + 四房间天花板自定义色 */
  floorColBed?: string;
  wallColBed?: string;
  floorColK?: string;
  wallColK?: string;
  floorColB?: string;
  wallColB?: string;
  ceilCol?: string;
  ceilColBed?: string;
  ceilColK?: string;
  ceilColB?: string;
  /** 三/四扇门开态 + 切换（v10 +书房门/花园栅栏门） */
  doorOpen?: boolean;
  kitchenDoorOpen?: boolean;
  bathDoorOpen?: boolean;
  balconyDoorOpen?: boolean;
  studyDoorOpen?: boolean;
  gardenGateOpen?: boolean;
  onToggleDoor?: () => void;
  onToggleKitchenDoor?: () => void;
  onToggleBathDoor?: () => void;
  onToggleBalconyDoor?: () => void;
  onToggleStudyDoor?: () => void;
  onToggleGardenGateDoor?: () => void;
  /** 阳台地板/墙自定义色（v5.7） */
  floorColBal?: string;
  wallColBal?: string;
  onFloorTap: () => void;
  onFurnTap: (item: FurnitureItem) => void;
  onDragEnd: (id: string) => void;
  /** 拖拽中的实时移动（吸附/钳位在此做） */
  onDragMove: (id: string, x: number, z: number) => void;
  onDragSelect: (id: string) => void;
  /** 编辑模式点选门窗（不开合） */
  onWallTap?: (id: string) => void;
  /** 「我」的衣柜穿搭（发型 + 连衣裙/分体 + 鞋；v6.2） */
  wear?: GirlWear;
  /** 「对方」的衣柜穿搭（发型 + 上衣/裤子 + 鞋；v6.3 男生换装） */
  wear2?: BoyWear;
  /** 正在进行的家具动作（灶台蒸汽 / 乐器音符联动） */
  activeAct?: { type: CharAction['type']; itemId: string; active: boolean } | null;
  /** 音响放歌中（音箱上方飘音符） */
  musicPlaying?: boolean;
  /** 天气特效：sunny 晴 / cloudy 多云 / overcast 阴 / rain 雨 / snow 雪（v9 室外世界全家桶） */
  weatherFx?: HomeWeather;
  /** 宠物照顾指令队列（HUD 面板 → PetBuddy；seq 变化即触发新指令，v6.9） */
  petCmdRef?: RefObject<{ kind: PetCareKind; seq: number; carry?: boolean; target?: string } | null>;
  /** 点宠物（打开状态面板回调；v9 带宠物 id —— 'cat' / 'p2:<i>'） */
  onPetTap?: (petId?: string) => void;
  /** 宠物照顾事件：arrive 到位（小人摆 petcare 姿势）/ done 完成 / cancel 中断 / dropped 放下；v9 带宠物 id 路由 */
  onPetEvent?: (ev: 'arrive' | 'done' | 'cancel' | 'dropped', kind: PetCareKind, petId?: string) => void;
  /** 宠物状态（v7.1：需求气泡 —— 体力低=饿了 / 心情低=想喝水 / 清洁低=要洗澡） */
  petState?: PetState;
  /** 好菜上桌的餐桌 id（null = 没有饭菜） */
  mealTableId?: string | null;
  /** 地板纹理（全屋通用）：wood 木纹（默认）/ plain 素色 / check 瓷砖 */
  floorTex?: 'plain' | 'wood' | 'check';
  /** 墙纸纹理（全屋通用）：plain 素色（默认）/ dot 碎花 / stripe 条纹 */
  wallTex?: 'plain' | 'dot' | 'stripe';
  /** E7 灯光氛围：当前亮着的灯具数量（开灯越多环境光越亮越暖；缺省 0） */
  litLamps?: number;
  /** G3 彩蛋小生物：点击惊飞回调（kind = 蝴蝶/小鸟） */
  onCritterTap?: (kind: 'butterfly' | 'bird') => void;
  /** v8.0 陪伴指令通道（CoupleHome 发起；seq 变化即触发新指令） */
  companionCmdRef?: RefObject<CompanionCmd | null>;
  /** v8.0 陪伴事件（状态机 → 宿主：到位/拥抱开始/牵手开始/释放/放弃/进新房间） */
  onCompanionEvent?: (e: CompanionEvent) => void;
  /** v8.0 点陪伴小人（拥抱/牵手环形菜单；生活模式） */
  onPartnerTap?: () => void;
  /** v8.0 3D 头顶气泡指令队列（CoupleHome push，HeadBubbles 消费） */
  bubbleRef?: RefObject<BubbleCmd[]>;
  /** v8.1 陪伴小人正在弹奏的乐器家具 id（null = 没在弹；Furn3D 音符飘出联动） */
  partnerPlayingId?: string | null;
  /** v8.3 宠物毛色（缺省奶油猫） */
  petCoat?: PetCoat;
  /** v8.3 宠物装扮（项圈颜色/围巾/蝴蝶结） */
  petWear?: PetWear;
  /** v8.3 玩具球扔球指令（seq 变化 = 扔一次；v9 target 路由到对应宠物） */
  petBallCmdRef?: RefObject<{ seq: number; target?: string }>;
  /** v9 领养宠物全家福（小狗/小兔子，可无数只；每只全功能：照顾/抱抱/扔球/把戏/装扮） */
  pets2?: Pet2State[];
  /** v11 长按陪伴小人 ≥550ms 触发一次（生活模式；透传给 TA 的 CharChibi3D 热区） */
  onPartnerLongPress?: () => void;
  /** v11 宠物成长等级 1~9（缺省 1）：驱动全部宠物体型缩放 Lv1=0.62 → Lv9=1.0 */
  petGrowLv?: number;
}

/** v8.0 头顶气泡指令（who = 挂在谁头上；hold = 展示秒数，缺省按字数；kind='thought' 想法泡 / 'love' 摸头爱心泡） */
export interface BubbleCmd {
  who: 'me' | 'ta';
  text: string;
  hold?: number;
  /** v10 A7：thought = 想法气泡（云朵淡蓝描边 + 💭 前缀）；v11：love = 摸头专属爱心气泡（粉描边 + 顶部小爱心装饰） */
  kind?: 'thought' | 'love';
}

/** 生活模式视角俯仰范围：接近水平（低角仰视）↔ 近乎俯瞰（全方位拉动视角） */
const PITCH_MIN = 0.22;
const PITCH_MAX = 1.5;

/** 家具动作 → 小人姿势（watch/work/game 也是坐姿；play 按乐器分流，见 act.pose） */
const POSE_OF_ACT: Record<CharAction['type'], CharPose> = {
  sit: 'sit',
  lie: 'lie',
  bath: 'bath',
  shower: 'shower',
  watch: 'sit',
  work: 'sit',
  cook: 'cook',
  eat: 'eat',
  drink: 'drink',
  play: 'sit',
  makeup: 'makeup',
  mirror: 'mirror',
  dress: 'stand',
  game: 'sit',
  hotpot: 'eat',
  coffee: 'drink',
  read: 'read',
};

// ---------------- 小工具 ----------------

const clamp = THREE.MathUtils.clamp;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function lerpAngle(cur: number, target: number, k: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}

/** 家具双房间钳制：见 catalog.clampFurnToRooms（z < 隔墙 → 客厅；否则卧室） */

/**
 * 方案 B 兕底：把点推出墙体 AABB（外扩 pad 余量，沿最小穿透轴推出）——
 * 低俯仰/近距离时相机不再钻进墙里（字面穿墙）。只处理墙段盒，门洞区域可自由穿过。
 */
function pushCameraOutWalls(p: THREE.Vector3, boxes: THREE.Box3[]) {
  const pad = 0.15;
  for (const b of boxes) {
    const x0 = b.min.x - pad;
    const x1 = b.max.x + pad;
    const y0 = b.min.y - pad;
    const y1 = b.max.y + pad;
    const z0 = b.min.z - pad;
    const z1 = b.max.z + pad;
    if (p.x <= x0 || p.x >= x1 || p.y <= y0 || p.y >= y1 || p.z <= z0 || p.z >= z1) continue;
    const dx0 = p.x - x0;
    const dx1 = x1 - p.x;
    const dy0 = p.y - y0;
    const dy1 = y1 - p.y;
    const dz0 = p.z - z0;
    const dz1 = z1 - p.z;
    const m = Math.min(dx0, dx1, dy0, dy1, dz0, dz1);
    if (m === dx0) p.x = x0;
    else if (m === dx1) p.x = x1;
    else if (m === dy0) p.y = Math.max(y0, 0.3);
    else if (m === dy1) p.y = y1;
    else if (m === dz0) p.z = z0;
    else p.z = z1;
  }
}

/** 门开态 + 沿墙坐标（碰撞走廊判定用；ref 高频读取） */
export interface DoorLive {
  open: boolean;
  /** axis 'z' 墙 → x 坐标；axis 'x' 墙 → z 坐标 */
  along: number;
}

/**
 * 小人 vs 家具 AABB（膨胀 0.2）推出 + 房间边界钳制（抬升家具不挡路）。
 * v5.7 五区：客厅（西北）/ 卫生间（客厅东侧）/ 卧室 / 厨房（南排）/ 阳台（卧室南侧）——
 * 隔墙挡路，只有「对应门开着且在门走廊内」才能穿过（partner 传全关门永远留在客厅）。
 * v10 七区：+ 书房（客厅西侧 annex，客厅西墙门）+ 花园（厨房南侧露天，栅栏门）。
 */
function collideAndClamp(
  c: CharRT,
  items: FurnitureItem[],
  bedDoor: DoorLive,
  ktDoor: DoorLive,
  bathDoor: DoorLive,
  balDoor: DoorLive,
  srDoor?: DoorLive,
  ydDoor?: DoorLive,
) {
  for (const it of items) {
    const e = CATALOG[it.kind];
    if (!e || e.flat) continue;
    if ((it.y ?? 0) > 0.45) continue; // 电视上墙 / 桌面小物不参与行走碰撞
    const [w, d] = footprintOf(e, it.ry ?? 0);
    const hw = w / 2 + 0.2;
    const hd = d / 2 + 0.2;
    const dx = c.x - it.x;
    const dz = c.z - it.z;
    if (Math.abs(dx) > hw || Math.abs(dz) > hd) continue;
    const penX = hw - Math.abs(dx);
    const penZ = hd - Math.abs(dz);
    if (penX < penZ) c.x = it.x + (dx >= 0 ? hw : -hw);
    else c.z = it.z + (dz >= 0 ? hd : -hd);
  }
  const m = 0.35;
  const inBedCorr = bedDoor.open && Math.abs(c.x - bedDoor.along) < DOOR_PASS;
  const inKtCorr = ktDoor.open && Math.abs(c.x - ktDoor.along) < DOOR_PASS;
  const inBathCorr = bathDoor.open && Math.abs(c.z - bathDoor.along) < DOOR_PASS;
  const inBalCorr = balDoor.open && Math.abs(c.x - balDoor.along) < DOOR_PASS;
  const inSrCorr = !!srDoor?.open && Math.abs(c.z - srDoor.along) < DOOR_PASS;
  const inYdCorr = !!ydDoor?.open && Math.abs(c.x - ydDoor.along) < DOOR_PASS;
  if (c.z < BED_Z0) {
    if (c.x < -ROOM_X) {
      // —— v10 书房（客厅西侧 annex）：东墙只有门走廊可穿，西/北/南为外墙 ——
      c.x = clamp(c.x, STUDY_X0 + m, inSrCorr ? -ROOM_X + m : -ROOM_X - m);
      c.z = clamp(c.z, STUDY_Z0 + m, STUDY_Z1 - m);
    } else if (c.x >= BATH_X0) {
      // 卫生间：西墙只有门走廊可穿，东/北/南为外墙
      c.x = clamp(c.x, inBathCorr ? BATH_X0 - m : BATH_X0 + m, BATH_X1 - m);
      c.z = clamp(c.z, -ROOM_Z + m, ROOM_Z - m);
    } else {
      // 客厅：东/西墙只有门走廊可穿；南隔墙两门走廊
      c.x = clamp(c.x, inSrCorr ? -ROOM_X - m : -ROOM_X + m, inBathCorr ? BATH_X0 + m : BATH_X0 - m);
      const zMax = inBedCorr || inKtCorr ? BED_Z0 + m : BED_Z0 - m;
      c.z = clamp(c.z, -ROOM_Z + m, zMax);
    }
  } else if (c.x < BED_X1) {
    // —— 卧室/阳台侧 ——
    c.x = clamp(c.x, -ROOM_X + m, BED_X1 - m);
    if (c.z > BED_Z1) {
      // 阳台：南/东栏杆、西外墙；北墙只有门走廊可穿
      const zMin = inBalCorr ? BED_Z1 - m : BED_Z1 + m;
      c.z = clamp(c.z, zMin, BAL_Z1 - m);
    } else {
      const zMax = inBalCorr ? BAL_Z1 - m : BED_Z1 - m;
      c.z = inBedCorr ? clamp(c.z, BED_Z0 - m, zMax) : clamp(c.z, BED_Z0 + m, zMax);
    }
  } else if (c.z > BED_Z1) {
    // —— v10 花园（厨房南侧露天）：栅栏围合，北栅栏只有门走廊可穿 ——
    c.x = clamp(c.x, GARDEN_X0 + m, GARDEN_X1 - m);
    c.z = inYdCorr ? clamp(c.z, BED_Z1 - m, GARDEN_Z1 - m) : clamp(c.z, GARDEN_Z0 + m, GARDEN_Z1 - m);
  } else {
    // —— 厨房侧（北门通客厅；南墙 v10 有花园走廊门洞；东墙 v5.4 起封闭） ——
    c.x = clamp(c.x, BED_X1 + m, KTCH_X1 - m);
    const zMax = inYdCorr ? GARDEN_Z0 + m : BED_Z1 - m;
    c.z = inKtCorr ? clamp(c.z, BED_Z0 - m, zMax) : clamp(c.z, BED_Z0 + m, zMax);
  }
}

// ---------------- v7.1 跨房间漫游（房间图寻路已迁移 pathfind.ts，v8.0 与陪伴系统共用） ----------------

// DoorKey 自 pathfind 导入（v10 六扇：bed/kt/bath/bal + sr 书房门 / yd 花园栅栏门）

/** partner 漫游 AI（v7.1 升级：跨房间闲逛 —— 会开门穿过门走廊去卧室/厨房/卫生间/阳台/书房/花园） */
const CLOSED_DOOR: DoorLive = { open: false, along: 0 };

/** 漫游手感参数（男生 = 溜达慢逛；猫 = 走走停停嗅探） */
interface RoamOpts {
  speed: number;
  pauseMin: number;
  pauseMax: number;
}

const ROAM_HUMAN: RoamOpts = { speed: 1.05, pauseMin: 2.5, pauseMax: 7.5 };
const ROAM_CAT: RoamOpts = { speed: 0.85, pauseMin: 1.0, pauseMax: 3.4 };

/** 房间随机权重：客厅最爱待，书房/花园新鲜去处，阳台/厨房/卫生间偶尔逛 */
const ROOM_WEIGHTS: [RoomId, number][] = [
  ['lr', 4],
  ['br', 2],
  ['kt', 1.5],
  ['ba', 1],
  ['bal', 1.5],
  ['sr', 1.2],
  ['yd', 1.5],
];

function pickRoom(): RoomId {
  const total = ROOM_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of ROOM_WEIGHTS) {
    r -= w;
    if (r <= 0) return id;
  }
  return 'lr';
}

/** 房间内随机落点（ROOM_SPANS 已内缩防贴墙） */
function randPointInRoom(r: RoomId): Pt {
  const [x0, x1, z0, z1] = ROOM_SPANS[r];
  return { x: x0 + Math.random() * (x1 - x0), z: z0 + Math.random() * (z1 - z0) };
}

/** 卡死检测存档（WeakMap 不污染 CharRT；有目标但 0.9s 挪不动 → 放弃重选） */
const roamStuck = new WeakMap<CharRT, { x: number; z: number; t: number }>();

/** 向「下一个路点/目标」迈一步（roam 与夜晚回窝共用） */
function roamStep(c: CharRT, dt: number, items: FurnitureItem[], doors: Record<DoorKey, DoorLive>, speed: number): void {
  const wp = c.route && c.route.length > 0 ? c.route[0] : null;
  const tx = wp ? wp.x : c.target!.x;
  const tz = wp ? wp.z : c.target!.z;
  const dx = tx - c.x;
  const dz = tz - c.z;
  const d = Math.hypot(dx, dz);
  if (d < (wp ? 0.18 : 0.14)) {
    if (wp) {
      c.route = (c.route ?? []).slice(1);
      if (c.route && c.route.length === 0) c.route = undefined;
    } else {
      c.target = null;
      c.moving = false;
    }
    return;
  }
  const sp = speed * dt;
  c.x += (dx / d) * Math.min(sp, d);
  c.z += (dz / d) * Math.min(sp, d);
  c.moving = true;
  c.heading = lerpAngle(c.heading, Math.atan2(dx, dz), Math.min(1, dt * 8));
  collideAndClamp(c, items, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
}

/**
 * 跨房间漫游（男生 & 宠物共用）：
 * - 随机挑一个目标房间（带权重）→ planRoute 穿门走廊（门关着 = 稍后再试）→ 房间内随机落点；
 * - 有目标时先走路点后走终点；内置卡死检测（被家具/突发关门挡住 → 放弃重选）。
 */
function roam(c: CharRT, dt: number, items: FurnitureItem[], doors: Record<DoorKey, DoorLive>, opts: RoamOpts): void {
  const now = performance.now() / 1000;
  if (c.target) {
    roamStep(c, dt, items, doors, opts.speed);
    if (!c.target) {
      // 刚到终点
      c.nextWander = now + opts.pauseMin + Math.random() * (opts.pauseMax - opts.pauseMin);
      c.route = undefined;
      return;
    }
    // —— 卡死检测：0.9s 内位移 < 0.05（被家具/关门挡住）→ 放弃目标重选 ——
    const st = roamStuck.get(c);
    if (!st) roamStuck.set(c, { x: c.x, z: c.z, t: now });
    else if (Math.hypot(c.x - st.x, c.z - st.z) > 0.05) {
      st.x = c.x;
      st.z = c.z;
      st.t = now;
    } else if (now - st.t > 0.9) {
      c.target = null;
      c.route = undefined;
      c.nextWander = now + 0.6 + Math.random();
      roamStuck.delete(c);
    }
    return;
  }
  roamStuck.delete(c);
  c.moving = false;
  if (now > c.nextWander) {
    const to = pickRoom();
    const route = planRoute(roomAt(c.x, c.z), to, doors);
    if (route === null) {
      // 想去的房间门关着：歇一会儿再试（多数时候改天再逛，不傻撞门）
      c.nextWander = now + 1.4 + Math.random() * 2.2;
      return;
    }
    c.target = randPointInRoom(to);
    c.route = route.length ? route : undefined;
  }
}

// ---------------- 键盘（WASD/方向键，桌面端调试/操作） ----------------

function useKeys(keysRef: RefObject<Set<string>>) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        keysRef.current?.add(k);
      }
    };
    const up = (e: KeyboardEvent) => keysRef.current?.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [keysRef]);
}

// ---------------- 游戏主循环（移动 + 相机跟随） ----------------

function GameLoop({
  meRT,
  taRT,
  joyRef,
  keysRef,
  azRef,
  pitchRef,
  distRef,
  modeRef,
  itemsRef,
  doorRef,
  lookRef,
  focusRef,
  fpRef,
  poseRef,
  actRef,
  wallBoxes,
  instRef,
  introRef,
  compRT,
  companionCmdRef,
  onCompanionEvent,
  gridRef,
  partnerPoseRef,
}: {
  meRT: CharRT;
  taRT: CharRT;
  joyRef: RefObject<{ dx: number; dy: number }>;
  keysRef: RefObject<Set<string>>;
  azRef: RefObject<{ az: number }>;
  pitchRef: RefObject<{ p: number }>;
  distRef: RefObject<{ d: number }>;
  modeRef: RefObject<HomeMode>;
  itemsRef: RefObject<FurnitureItem[]>;
  /** 每扇门开态 + 沿墙坐标（ref 高频读取；bal = 阳台门 v5.7） */
  doorRef: RefObject<{ bed: DoorLive; kt: DoorLive; bath: DoorLive; bal?: DoorLive; sr?: DoorLive; yd?: DoorLive }>;
  /** 拖拽中 1:1 直接控制镜头（true 时不做惯性 lerp） */
  lookRef: RefObject<{ on: boolean }>;
  /** 相机对焦物（隔墙可见性用） */
  focusRef: RefObject<{ x: number; z: number }>;
  /** 第一人称视角开关 */
  fpRef: RefObject<{ on: boolean }>;
  /** 「我」的姿势（stand/sit/lie/bath + 支撑面高度） */
  poseRef: RefObject<{ pose: CharPose; y: number }>;
  /** 正在执行的家具动作（走向家具 → 摆姿势） */
  actRef: RefObject<CharAction | null>;
  /** 乐器弹奏特写（非 null = 镜头推近该乐器） */
  instRef?: RefObject<{ kind: 'piano' | 'guitar'; itemId: string } | null>;
  /** 墙段碰撞盒（随门位重建；生活模式相机防钻墙钳制用） */
  wallBoxes: THREE.Box3[];
  /** v6.8 进屋过场状态（相机推镜时间轴） */
  introRef?: RefObject<IntroState>;
  /** v8.0 陪伴状态机实例（HomeScene 持有） */
  compRT: CompanionRT;
  /** v8.0 陪伴指令通道（CoupleHome 发起） */
  companionCmdRef?: RefObject<CompanionCmd | null>;
  /** v8.0 陪伴事件回调 */
  onCompanionEvent?: (e: CompanionEvent) => void;
  /** v8.0 A* 阻挡网格容器（HomeScene useEffect 重建） */
  gridRef: RefObject<{ grid: BlockGrid | null }>;
  /** v8.0 陪伴小人姿势槽（companion-rt 写入） */
  partnerPoseRef: RefObject<PoseSlot>;
}) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null;
  const desired = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3());
  const prevMode = useRef<HomeMode>('live');
  const catchUp = useRef(0);
  const clock = useRef(0);
  const lastFp = useRef(false);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);

    // 对焦物：生活=小人 / 编辑=轨道中心（墙体遮挡淡出判定用；两种模式都要刷新）
    const modeNow = modeRef.current as HomeMode;
    focusRef.current.z = modeNow === 'edit' ? controls?.target?.z ?? 2.4 : meRT.z;
    focusRef.current.x = modeNow === 'edit' ? controls?.target?.x ?? 0 : meRT.x;

    if (modeNow !== 'live') {
      prevMode.current = modeNow;
      return;
    }

    // —— 模式切换无缝接管：装修 → 生活时从当前相机位置反推球坐标，
    //    视角从用户离开的地方继续；拖拽/松手都立即回到 1:1 手感 ——
    //    （第一人称打开时跳过球坐标接管，直接从眼位开始）
    if (prevMode.current !== 'live') {
      if (!fpRef.current?.on) {
        const off = camera.position.clone().sub(new THREE.Vector3(meRT.x, 0, meRT.z));
        const len = Math.max(off.length(), 0.001);
        if (azRef.current) azRef.current.az = Math.atan2(off.x, off.z);
        if (pitchRef.current)
          pitchRef.current.p = clamp(Math.asin(clamp(off.y / len, -1, 1)), PITCH_MIN, PITCH_MAX);
        if (distRef.current) distRef.current.d = clamp(len, 4.5, 11);
      }
      lookRef.current.on = false;
      catchUp.current = 0.55; // 短暂收紧到跟随轨道（比旧版更短，退出即能跟手拖动）
    }
    prevMode.current = 'live';

    // —— 家具动作优先：走向目标 → 摆姿势（坐下/睡觉/泡澡） ——
    const act = actRef.current;
    if (act && !act.arrived) {
      const dx = act.tx - meRT.x;
      const dz = act.tz - meRT.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.1) {
        const sp = 1.7 * dt;
        meRT.x += (dx / d) * Math.min(sp, d);
        meRT.z += (dz / d) * Math.min(sp, d);
        meRT.moving = true;
        meRT.heading = lerpAngle(meRT.heading, Math.atan2(dx, dz), Math.min(1, dt * 12));
      } else {
        meRT.moving = false;
        act.arrived = true;
        poseRef.current.pose = act.pose ?? POSE_OF_ACT[act.type] ?? 'sit';
        poseRef.current.y = act.y;
        act.onArrive?.();
      }
    } else if (act) {
      // 已摆好姿势：锁输入（摇杆/WASD 忽略）、不碰撞（人在家具上），朝向缓转向家具朝向
      meRT.moving = false;
      meRT.heading = lerpAngle(meRT.heading, act.ry, Math.min(1, dt * 6));
    } else {
      // —— 常规输入合成（摇杆 + 键盘） ——
      const j = joyRef.current ?? { dx: 0, dy: 0 };
      let mx = j.dx;
      let mz = j.dy;
      const keys = keysRef.current;
      if (keys && keys.size) {
        if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
        if (keys.has('d') || keys.has('arrowright')) mx += 1;
        if (keys.has('w') || keys.has('arrowup')) mz -= 1;
        if (keys.has('s') || keys.has('arrowdown')) mz += 1;
      }
      mx = clamp(mx, -1, 1);
      mz = clamp(mz, -1, 1);

      const az0 = azRef.current?.az ?? 0;
      const fx = -Math.sin(az0);
      const fz = -Math.cos(az0);
      const rx = Math.cos(az0);
      const rz = -Math.sin(az0);
      let vx = fx * -mz + rx * mx;
      let vz = fz * -mz + rz * mx;
      const len = Math.hypot(vx, vz);

      if (len > 0.04) {
        const sp = Math.min(1, len) * 2.7;
        meRT.x += (vx / len) * sp * dt;
        meRT.z += (vz / len) * sp * dt;
        meRT.moving = true;
        meRT.heading = lerpAngle(meRT.heading, Math.atan2(vx, vz), Math.min(1, dt * 14));
      } else {
        meRT.moving = false;
      }
      collideAndClamp(
        meRT,
        itemsRef.current ?? [],
        doorRef.current?.bed ?? CLOSED_DOOR,
        doorRef.current?.kt ?? CLOSED_DOOR,
        doorRef.current?.bath ?? CLOSED_DOOR,
        doorRef.current?.bal ?? CLOSED_DOOR,
        doorRef.current?.sr ?? CLOSED_DOOR,
        doorRef.current?.yd ?? CLOSED_DOOR,
      );
    }

    // —— v8.0 陪伴状态机优先：有指令（拥抱/牵手/坐下/过来…）时接管 partner，否则漫游 ——
    const dr2 = doorRef.current;
    const doorsLive = {
      bed: dr2?.bed ?? CLOSED_DOOR,
      kt: dr2?.kt ?? CLOSED_DOOR,
      bath: dr2?.bath ?? CLOSED_DOOR,
      bal: dr2?.bal ?? CLOSED_DOOR,
      sr: dr2?.sr ?? CLOSED_DOOR,
      yd: dr2?.yd ?? CLOSED_DOOR,
    };
    const cmd = companionCmdRef?.current ?? null;
    if (cmd && cmd.seq !== compRT.lastSeq) compRT.cmd = cmd;
    const grid = gridRef.current?.grid ?? null;
    const j = joyRef.current ?? { dx: 0, dy: 0 };
    const joyMag = Math.hypot(j.dx, j.dy);
    let handled = false;
    if (grid) {
      const evBox: { e: CompanionEvent | null } = { e: null };
      handled = companionStep(
        taRT,
        meRT,
        compRT,
        dt,
        itemsRef.current ?? [],
        grid,
        doorsLive,
        partnerPoseRef.current,
        poseRef.current,
        (c) => collideAndClamp(c, itemsRef.current ?? [], doorsLive.bed, doorsLive.kt, doorsLive.bath, doorsLive.bal, doorsLive.sr, doorsLive.yd),
        joyMag,
        (e) => {
          evBox.e = e;
        },
      );
      if (evBox.e) onCompanionEvent?.(evBox.e);
    }
    // partner 漫游（v7.1：跨房间闲逛 —— 开着门就去卧室/厨房/卫生间/阳台溜达；v8.0 陪伴接管时跳过）
    if (!handled) {
      roam(taRT, dt, itemsRef.current ?? [], doorsLive, ROAM_HUMAN);
    }

    clock.current += dt;
    const fpOn = fpRef.current?.on === true;
    // 切入第一人称时重置俯仰为平视（轨道视角的俯瞰角对眼睛没意义）
    if (fpOn && !lastFp.current && pitchRef.current) pitchRef.current.p = 0.12;
    lastFp.current = fpOn;

    // 第一人称眼高：坐/躺/泡时贴姿势支撑面
    const poseNow = poseRef.current?.pose ?? 'stand';
    const poseYNow = poseRef.current?.y ?? 0;
    const az = azRef.current?.az ?? 0;
    const eyeH =
      poseNow === 'stand'
        ? 0.84
        : poseNow === 'sit'
          ? Math.max(0.62, poseYNow + 0.42)
          : poseNow === 'bath'
            ? Math.max(0.66, poseYNow + 0.66)
            : Math.max(0.35, poseYNow + 0.24); // 躺在床上侧目

    // —— v6.8 进屋过场：白光渐隐同时从阳台外低机位推镜进门（阳台门/卧室门迎宾开合），
    //    结束机位 = 默认跟随轨道（az0/pitch0.92/dist8.8，每帧按 meRT 实时算），无缝交回常规相机 ——
    const intro = introRef?.current;
    if (intro?.on) {
      intro.t += dt;
      const k = THREE.MathUtils.clamp((intro.t - 0.35) / 2.15, 0, 1); // 前 0.35s 白幕遮住 Canvas 首帧
      const e = k * k * (3 - 2 * k); // smoothstep
      const pitch0 = 0.92;
      const dist0 = 8.8;
      const endPos = new THREE.Vector3(meRT.x, Math.sin(pitch0) * dist0 + 0.55, meRT.z + Math.cos(pitch0) * dist0);
      const balX = doorRef.current?.bal?.along ?? DOORS[3].def;
      const bedX = doorRef.current?.bed?.along ?? DOORS[0].def;
      if (!intro.path) {
        intro.path = {
          pos: new THREE.CatmullRomCurve3([
            new THREE.Vector3(balX, 1.66, BAL_Z1 + 2.3), // 阳台外低机位
            new THREE.Vector3(balX, 1.34, BED_Z1 + 0.5), // 穿阳台门
            new THREE.Vector3(bedX, 1.16, BED_Z0 - 0.35), // 穿卧室门进客厅
            endPos.clone(),
          ]),
          look: new THREE.CatmullRomCurve3([
            new THREE.Vector3(balX, 0.72, BED_Z1 - 0.4),
            new THREE.Vector3(bedX, 0.8, BED_Z0 - 0.8),
            new THREE.Vector3(meRT.x, 0.95, meRT.z),
            new THREE.Vector3(meRT.x, 1.0, meRT.z),
          ]),
        };
      }
      // 末段终点/视线实时跟手（过场中走动也不跳切）
      intro.path.pos.points[3].copy(endPos);
      intro.path.look.points[2].set(meRT.x, 0.95, meRT.z);
      intro.path.look.points[3].set(meRT.x, 1.0, meRT.z);
      camera.position.copy(intro.path.pos.getPoint(e));
      camera.lookAt(intro.path.look.getPoint(e));
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera && cam.fov !== 48) {
        cam.fov = 48;
        cam.updateProjectionMatrix();
      }
      if (k >= 1) {
        intro.on = false;
        if (azRef.current) azRef.current.az = 0;
        if (pitchRef.current) pitchRef.current.p = pitch0;
        if (distRef.current) distRef.current.d = dist0;
        lookRef.current.on = false;
      }
      return;
    }

    // —— 乐器弹奏特写：镜头推到乐器斜前方（越过小人肩膀看琴键/琴弦），覆盖层 UI 发声 ——
    const inst = instRef?.current;
    if (inst) {
      const it = (itemsRef.current ?? []).find((f) => f.id === inst.itemId);
      if (it) {
        const ry = it.ry ?? 0;
        const fx = Math.sin(ry);
        const fz = Math.cos(ry);
        const rx = Math.cos(ry);
        const rz = -Math.sin(ry);
        const isPiano = inst.kind === 'piano';
        // 竖屏水平 FOV 很窄，特写机位要留足距离才能框住整件乐器
        const near = isPiano ? 1.95 : 1.8; // 相机离乐器中心（琴凳/站位一侧）
        const side = isPiano ? 0.95 : 1.32; // 肩侧偏移加大：越过肩膀看琴，避免后脑勺挡镜头
        const camY = isPiano ? 1.66 : 1.6;
        const lookNear = isPiano ? 0.3 : 0.15;
        const lookY = isPiano ? 0.78 : 0.66;
        desired.current.set(
          it.x + fx * near + rx * side,
          camY,
          it.z + fz * near + rz * side,
        );
        // 方案 B 兜底：特写镜头也不许钻墙
        pushCameraOutWalls(desired.current, wallBoxes);
        camera.position.lerp(desired.current, 1 - Math.exp(-dt * 3.2));
        lookAt.current.set(it.x + fx * lookNear - rx * 0.3, lookY, it.z + fz * lookNear - rz * 0.3);
        camera.lookAt(lookAt.current);
        const cam = camera as THREE.PerspectiveCamera;
        if (cam.isPerspectiveCamera && cam.fov !== 52) {
          cam.fov = 52;
          cam.updateProjectionMatrix();
        }
        // 对焦物 = 乐器（隔墙淡出判定用，不然琴身随镜头位置闪隐）
        focusRef.current.x = it.x;
        focusRef.current.z = it.z;
        return;
      }
    }

    if (fpOn) {
      // —— 第一人称：相机就是小人的眼睛（走路轻微颠簸，视角 = az/pitch）；
      //    v10.3 相机位置永跟随小人（小人本身被碰撞钳在屋内，相机不可能穿出墙体/天花板），
      //    仰视上限收到 1.15rad（≈66°）：贴近墙根也不再看穿天花板外 —— 屋内抬头是天花板，屋外抬头是天空
      const az = azRef.current?.az ?? 0;
      const pitch = clamp(pitchRef.current?.p ?? 0, -0.5, 1.15);
      const bob = meRT.moving ? Math.abs(Math.sin(clock.current * 9)) * 0.032 : 0;
      camera.position.set(meRT.x, eyeH + bob, meRT.z);
      const cp = Math.cos(pitch);
      lookAt.current.set(
        meRT.x - Math.sin(az) * cp * 8,
        eyeH + bob - Math.sin(pitch) * 8,
        meRT.z - Math.cos(az) * cp * 8,
      );
      camera.lookAt(lookAt.current);
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera && cam.fov !== 66) {
        cam.fov = 66;
        cam.updateProjectionMatrix();
      }
    } else {
      // —— 第三人称跟随（球坐标：方位角 az / 俯仰 pitch / 距离 dist） ——
      // v8.2 优化B 牵手专属镜头：牵手时镜头拉远 + 中心取两人中点 + 视角压平（双人同行构图）；
      // 不写回 dist/pitch ref，松手后自动恢复用户自己的视角
      const holding = compRT.phase === 'hold';
      const pitch = holding ? Math.min(pitchRef.current?.p ?? 0.92, 0.74) : (pitchRef.current?.p ?? 0.92);
      const dist = holding ? Math.max(distRef.current?.d ?? 8.8, 10.9) : (distRef.current?.d ?? 8.8);
      const cx = holding ? (meRT.x + taRT.x) / 2 : meRT.x;
      const cz = holding ? (meRT.z + taRT.z) / 2 : meRT.z;
      const cy = Math.sin(pitch) * dist;
      const ch = Math.cos(pitch) * dist;
      desired.current.set(cx + Math.sin(az) * ch, cy + 0.55, cz + Math.cos(az) * ch);
      // 方案 B 兕底：轨道目标点先推出墙体盒，低俯仰/近距离不再字面穿墙
      pushCameraOutWalls(desired.current, wallBoxes);

      if (lookRef.current?.on) {
        // 拖拽中：1:1 直接控制（与装修模式轨道同样的跟手感，无惯性延迟）
        camera.position.copy(desired.current);
      } else {
        const rate = catchUp.current > 0 ? 9 : 5;
        if (catchUp.current > 0) catchUp.current -= dt;
        camera.position.lerp(desired.current, 1 - Math.exp(-dt * (holding ? 2.6 : rate)));
      }
      lookAt.current.set(cx, holding ? 0.9 : 1.0, cz);
      camera.lookAt(lookAt.current);
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera && cam.fov !== 48) {
        cam.fov = 48;
        cam.updateProjectionMatrix();
      }
    }
  });
  return null;
}

// ---------------- 指针系统（生活视角旋转 / 编辑拖拽 / 移动模式搬运） ----------------

interface DragInfo {
  id: string;
  active: boolean;
  startX: number;
  startY: number;
}

function PointerRig({
  mode,
  modeRef,
  azRef,
  pitchRef,
  distRef,
  dragRef,
  moveSelRef,
  itemsRef,
  lookRef,
  fpRef,
  onDragMove,
  onDragEnd,
  onDragSelect,
}: {
  /** 当前模式（真值）：模式切换时全量复位手势状态（退出装修立刻解绑拖拽语境） */
  mode: HomeMode;
  modeRef: RefObject<HomeMode>;
  azRef: RefObject<{ az: number }>;
  pitchRef: RefObject<{ p: number }>;
  distRef: RefObject<{ d: number }>;
  dragRef: RefObject<DragInfo | null>;
  moveSelRef: RefObject<{ id: string | null; on: boolean }>;
  itemsRef: RefObject<FurnitureItem[]>;
  lookRef: RefObject<{ on: boolean }>;
  fpRef: RefObject<{ on: boolean }>;
  onDragMove: HomeSceneProps['onDragMove'];
  onDragEnd: HomeSceneProps['onDragEnd'];
  onDragSelect: HomeSceneProps['onDragSelect'];
}) {
  const { camera, gl, raycaster } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;

  // 回调存 ref：父组件重渲染（回调身份变化）不会拆装监听
  const cbRef = useRef({ onDragMove, onDragEnd, onDragSelect });
  useEffect(() => {
    cbRef.current = { onDragMove, onDragEnd, onDragSelect };
  });
  // 手势状态存 ref：即便 effect 重建也不丢「按住中」状态
  // pid：只跟踪第一根落屏的手指，第二根手指（捏合/误触）完全忽略 —— 生活模式不再被捏合搞乱视角
  const gesture = useRef({ down: false, pid: -1, lastX: 0, lastY: 0, moved: 0 });

  /** 手势全量复位：视角滑动/拖拽/移动搬运统一解绑（模式切换 / 页面失焦 / 后台化兜底） */
  const resetGesture = useCallback(
    (fireDragEnd: boolean) => {
      const d = dragRef.current;
      if (fireDragEnd && d?.active) cbRef.current.onDragEnd(d.id);
      dragRef.current = null;
      gesture.current = { down: false, pid: -1, lastX: 0, lastY: 0, moved: 0 };
      lookRef.current.on = false;
    },
    [dragRef, lookRef],
  );

  // ⚑ 模式切换（尤其装修→生活）瞬间：立刻解绑一切拖拽/手势状态。
  // 旧版生活模式旋转分支被 !dragRef 拦住，装修残留的拖拽语境会「吃掉」滑动视角 ——
  // 现在退出装修的同时清空全部手势状态，双保险。
  useEffect(() => {
    resetGesture(false);
    if (controls) controls.enabled = mode === 'edit' && !moveSelRef.current?.on;
  }, [mode]);

  useEffect(() => {
    const el = gl.domElement;
    // 阻止浏览器把画布拖拽当成原生 drag/选区拖动（否则 dragstart+pointercancel 会吞掉后续 pointermove）
    el.draggable = false;
    el.style.userSelect = 'none';
    el.style.setProperty('-webkit-user-drag', 'none');
    // ⚑ 触摸加固：把 touch-action 直接钉在真正的命中目标（canvas 元素本体）上，
    //   并在 touchmove 里 preventDefault（passive:false）—— 从根源杜绝浏览器把「滑动视角」
    //   认领成原生滚动/捏合后回 pointercancel 掐断手势（真机连续滑动被截断的元凶）。
    //   只拦 touchmove，不拦 touchstart/touchend —— 点家具/门窗的 click 合成不受影响。
    el.style.touchAction = 'none';
    const preventNative = (e: Event) => e.preventDefault();
    el.addEventListener('touchmove', preventNative, { passive: false });
    el.addEventListener('gesturestart', preventNative); // iOS Safari 双指捏合
    el.addEventListener('gesturechange', preventNative);
    const blockDrag = (e: Event) => e.preventDefault();
    el.addEventListener('dragstart', blockDrag);
    /** 页面失焦/后台化：手指可能永远等不到 pointerup，强制解绑防止手势卡死 */
    const onGone = () => resetGesture(true);
    const onVis = () => {
      if (document.hidden) resetGesture(true);
    };
    window.addEventListener('blur', onGone);
    document.addEventListener('visibilitychange', onVis);
    /** 拖拽平面：随目标家具高度调整（墙挂电视在其高度平面上拖动） */
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();

    const setNDC = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };

    /** 把拖拽平面移到目标所在高度（贴地家具 y=0；抬升家具在其水平面；窗 1.5 / 门 1.0） */
    const alignPlane = (id: string) => {
      if (id.startsWith('win-')) {
        plane.constant = -1.5;
        return;
      }
      if (id.startsWith('door-')) {
        plane.constant = -1.0;
        return;
      }
      const it = itemsRef.current?.find((f) => f.id === id);
      plane.constant = -(it?.y ?? 0);
    };

    const onDown = (e: PointerEvent) => {
      // 已有手指在屏（旋转/拖拽中）→ 后续手指全部忽略（捏合不搞乱视角/不再误缩放）
      if (gesture.current.down && gesture.current.pid !== e.pointerId) return;
      gesture.current.down = true;
      gesture.current.pid = e.pointerId;
      gesture.current.lastX = e.clientX;
      gesture.current.lastY = e.clientY;
      gesture.current.moved = 0;
      lookRef.current.on = false;

      // —— 移动模式：按下画布任意处即搬运选中家具 ——
      const ms = moveSelRef.current;
      if (modeRef.current === 'edit' && ms?.on && ms.id) {
        dragRef.current = { id: ms.id, active: true, startX: e.clientX, startY: e.clientY };
        alignPlane(ms.id);
        if (controls) controls.enabled = false;
        cbRef.current.onDragSelect(ms.id);
      }
    };

    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g.down || e.pointerId !== g.pid) return;
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      g.moved += Math.abs(dx) + Math.abs(dy);

      // —— 编辑模式：家具拖拽 / 移动模式搬运（仅编辑模式认领；残留状态绝不影响生活模式） ——
      const d = dragRef.current;
      if (modeRef.current === 'edit' && d) {
        if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 8) {
          d.active = true;
          alignPlane(d.id);
          if (controls) controls.enabled = false;
          cbRef.current.onDragSelect(d.id);
        }
        if (d.active) {
          setNDC(e);
          raycaster.setFromCamera(ndc, camera);
          if (raycaster.ray.intersectPlane(plane, hit)) {
            cbRef.current.onDragMove(d.id, hit.x, hit.z);
          }
          return;
        }
      }

      // —— 生活模式：滑动全方位旋转视角（左右任意转 / 上下低角↔近俯瞰；第一人称上下可仰视） ——
      //    与 dragRef 完全解耦：无任何残留状态能拦截旋转；无节流/防抖，连续跟手 ——
      if (modeRef.current === 'live') {
        if (g.moved > 4) lookRef.current.on = true; // 超过轻点阈值 → 1:1 直接控制
        const fpOn = fpRef.current?.on === true;
        const az = azRef.current;
        if (az) az.az -= dx * 0.0075;
        const p = pitchRef.current;
        if (p) p.p = clamp(p.p + dy * 0.005, fpOn ? -0.5 : PITCH_MIN, fpOn ? 1.3 : PITCH_MAX);
      }
    };

    const onUp = (e: PointerEvent) => {
      // 不是跟踪中的那根手指抬起 → 不结束手势
      if (gesture.current.down && e.pointerId !== gesture.current.pid) return;
      resetGesture(true);
      // 移动模式保持占用相机；普通拖拽结束后归还 OrbitControls
      if (controls) controls.enabled = modeRef.current === 'edit' && !moveSelRef.current?.on;
    };

    const onWheel = (e: WheelEvent) => {
      if (modeRef.current !== 'live') return;
      const dd = distRef.current;
      if (dd) dd.d = clamp(dd.d + e.deltaY * 0.004, 4.5, 11);
    };

    el.addEventListener('pointerdown', onDown);
    // ⚑ 捕获阶段挂 window：任何子元素的 stopPropagation 都吃不掉 move/up，滑动事件永不截断
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', preventNative);
      el.removeEventListener('gesturestart', preventNative);
      el.removeEventListener('gesturechange', preventNative);
      el.removeEventListener('dragstart', blockDrag);
      window.removeEventListener('blur', onGone);
      document.removeEventListener('visibilitychange', onVis);
    };
    // 仅依赖 three 稳定对象与 ref —— 回调已走 cbRef，重渲染不拆装
  }, [camera, gl, raycaster, controls, modeRef, azRef, pitchRef, distRef, dragRef, moveSelRef, lookRef, itemsRef, resetGesture]);

  return null;
}

// ---------------- 编辑模式缩放（HUD 按钮 → 相机推拉） ----------------

function ZoomPoker({ zoomCmd }: { zoomCmd: RefObject<{ v: number; dir: number }> }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const last = useRef(0);
  useFrame(() => {
    const cmd = zoomCmd.current;
    if (!cmd || cmd.v === last.current) return;
    last.current = cmd.v;
    if (!controls) return;
    const off = camera.position.clone().sub(controls.target);
    const len = THREE.MathUtils.clamp(off.length() * (cmd.dir > 0 ? 0.8 : 1.25), 3.2, 23);
    camera.position.copy(controls.target).add(off.setLength(len));
    controls.update();
  });
  return null;
}

// ---------------- 编辑网格（四房间四块） ----------------

function EditGrid() {
  const geo = useMemo(() => {
    const pts: number[] = [];
    const span = (x0: number, x1: number, z0: number, z1: number) => {
      for (let x = x0; x <= x1 + 0.001; x += SNAP) pts.push(x, 0.015, z0, x, 0.015, z1);
      for (let z = z0; z <= z1 + 0.001; z += SNAP) pts.push(x0, 0.015, z, x1, 0.015, z);
    };
    span(-ROOM_X, ROOM_X, -ROOM_Z, BED_Z0); // 客厅（西段；卫生间在东段单独一块）
    span(BATH_X0, BATH_X1, BATH_Z0, BATH_Z1); // 卫生间（客厅东侧）
    span(-ROOM_X, BED_X1, BED_Z0, BED_Z1); // 卧室
    span(BED_X1, KTCH_X1, BED_Z0, BED_Z1); // 厨房
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geo} renderOrder={1}>
      <lineBasicMaterial color="#a89a78" transparent opacity={0.55} depthWrite={false} />
    </lineSegments>
  );
}

// ---------------- E2 拖拽对齐辅助（网格增亮 + 吸附底座 + 重叠红警告） ----------------

/** 吸附底座配色：普通淡粉 / 重叠红色 */
const AID_PINK = '#f2b3c2';
const AID_RED = '#e05a4e';

/**
 * DragAid —— 装修模式拖拽辅助（全部 useFrame 原地改对象，零 setState，非拖拽零开销）：
 * ① 一块覆盖全屋的大 gridHelper（0.25m 一格 = SNAP），edit 极淡常显、拖拽中增亮、live 隐藏；
 * ② 拖拽中家具脚下的吸附底座（淡粉半透明面 + 描边框），跟随家具 x/z/ry，尺寸 = footprint；
 * ③ 底座 AABB 与其他家具相交 → 底座变红（跳过 flat 地毯 / y>0.45 桌上物 / 自己）。
 */
function DragAid({
  modeRef,
  dragRef,
  itemsRef,
}: {
  modeRef: RefObject<HomeMode>;
  dragRef: RefObject<DragInfo | null>;
  itemsRef: RefObject<FurnitureItem[]>;
}) {
  const grid = useRef<THREE.GridHelper>(null);
  const base = useRef<THREE.Group>(null);
  const fill = useRef<THREE.Mesh>(null);
  const rim = useRef<THREE.LineSegments>(null);
  /** 单位平面描边框：每帧按 footprint scale，几何不重建 */
  const rimGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), []);
  useEffect(() => () => rimGeo.dispose(), [rimGeo]);

  useFrame((_, dtRaw) => {
    const d = Math.min(dtRaw, 0.05);
    const edit = modeRef.current === 'edit';
    const drag = dragRef.current;

    // ① 编辑网格：live 模式 visible=false；拖拽中透明度 0.08 → 0.22（damp 平滑）
    const gh = grid.current;
    if (gh) {
      gh.visible = edit;
      const mats = Array.isArray(gh.material) ? gh.material : [gh.material];
      const target = edit && drag?.active ? 0.22 : 0.08;
      for (const m of mats) {
        m.transparent = true;
        m.depthWrite = false;
        m.opacity = THREE.MathUtils.damp(m.opacity, edit ? target : 0, 9, d);
      }
    }

    // ②③ 吸附底座 + 重叠红警告（仅拖拽家具时每帧 O(n) 扫 items；win-/door- 拖拽找不到 → 隐藏）
    const g = base.current;
    const f = fill.current;
    const r = rim.current;
    if (!g || !f || !r) return;
    const it = edit && drag?.active ? itemsRef.current.find((q) => q.id === drag.id) : undefined;
    const entry = it ? CATALOG[it.kind] : undefined;
    if (!it || !entry) {
      g.visible = false;
      return;
    }
    const [fw1, fd1] = footprintOf(entry, it.ry ?? 0);
    let overlap = false;
    if (!entry.flat && (it.y ?? 0) <= 0.45) {
      const list = itemsRef.current;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o.id === it.id) continue;
        const e2 = CATALOG[o.kind];
        if (!e2 || e2.flat || (o.y ?? 0) > 0.45) continue;
        const [w2, d2] = footprintOf(e2, o.ry ?? 0);
        if (Math.abs(o.x - it.x) < (fw1 + w2) / 2 && Math.abs(o.z - it.z) < (fd1 + d2) / 2) {
          overlap = true;
          break;
        }
      }
    }
    g.visible = true;
    g.position.set(it.x, 0.02, it.z);
    g.rotation.y = it.ry ?? 0;
    const [w0, d0] = entry.fp;
    f.scale.set(w0, d0, 1);
    r.scale.set(w0, d0, 1);
    const fm = f.material as THREE.MeshBasicMaterial;
    fm.color.set(overlap ? AID_RED : AID_PINK);
    fm.opacity = overlap ? 0.3 : 0.18;
    const rm = r.material as THREE.LineBasicMaterial;
    rm.color.set(overlap ? AID_RED : AID_PINK);
    rm.opacity = overlap ? 0.6 : 0.35;
  });

  return (
    <group>
      {/* 大网格：x∈[-4.5,8.5]（宽13）、z 中心 3.75，0.25m 一格 = 52 分割，盖住五房间地面 */}
      <gridHelper
        ref={grid}
        args={[13, 52, '#d8b0a8', '#a89a78']}
        position={[2, 0.012, 3.75]}
        material-transparent
        material-opacity={0.08}
        material-depthWrite={false}
        renderOrder={1}
        visible={false}
      />
      <group ref={base} visible={false}>
        <mesh ref={fill} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color={AID_PINK} transparent opacity={0.18} depthWrite={false} />
        </mesh>
        <lineSegments ref={rim} geometry={rimGeo} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <lineBasicMaterial color={AID_PINK} transparent opacity={0.35} depthWrite={false} />
        </lineSegments>
      </group>
    </group>
  );
}

// ---------------- 移动模式接管相机（激活时禁用轨道旋转） ----------------

function MoveModeGate({ moveOn, mode }: { moveOn: boolean; mode: HomeMode }) {
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  useEffect(() => {
    if (controls) controls.enabled = mode === 'edit' && !moveOn;
  }, [controls, moveOn, mode]);
  return null;
}

// ---------------- 四向微调（HUD 方向按钮 → 按当前视角方位换算世界轴） ----------------

function NudgePoker({
  moveCmd,
  onNudge,
}: {
  moveCmd: RefObject<{ v: number; dir: 'up' | 'down' | 'left' | 'right' }>;
  onNudge: (dx: number, dz: number) => void;
}) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const last = useRef(0);
  useFrame(() => {
    const cmd = moveCmd.current;
    if (!cmd || cmd.v === last.current) return;
    last.current = cmd.v;
    // 相机方位角 → 吸附到最近的 90° 象限，方向按钮永远沿屏幕视觉方向移动
    const t = controls?.target;
    const az = Math.atan2(
      camera.position.x - (t?.x ?? 0),
      camera.position.z - (t?.z ?? 0),
    );
    const q = Math.round(az / (Math.PI / 2)) * (Math.PI / 2);
    const fx = -Math.sin(q);
    const fz = -Math.cos(q);
    let dx = 0;
    let dz = 0;
    if (cmd.dir === 'up') {
      dx = fx;
      dz = fz;
    } else if (cmd.dir === 'down') {
      dx = -fx;
      dz = -fz;
    } else if (cmd.dir === 'left') {
      dx = fz;
      dz = -fx;
    } else {
      dx = -fz;
      dz = fx;
    }
    onNudge(dx, dz);
  });
  return null;
}

// ---------------- 编辑相机（进入装修模式时拉到俯瞰位，罩住四室一厅） ----------------

function EditCameraKick({ mode }: { mode: HomeMode }) {
  const { camera } = useThree();
  const prev = useRef<HomeMode>(mode);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (mode === 'edit' && prev.current !== 'edit') {
      // 东南斜上空俯瞰位（四室全罩住），竖屏窄视野也够广
      cam.position.set(12.6, 16.8, 17.4);
      if (cam.isPerspectiveCamera) {
        cam.fov = 55;
        cam.updateProjectionMatrix();
      }
      cam.lookAt(2.9, 0.3, 2.5);
    }
    prev.current = mode;
  }, [mode, camera]);
  return null;
}

// ---------------- 灯光（昼夜 mix 平滑过渡） ----------------

/** v9 各天气天空底色（白天） */
const SKY_DAY: Record<HomeWeather, string> = {
  sunny: '#a8d8ef',
  cloudy: '#ccd6dd',
  overcast: '#b3bac2',
  rain: '#8f98a1',
  snow: '#e3eaf1',
};
/** v9 各天气天空底色（夜晚） */
const SKY_NIGHT: Record<HomeWeather, string> = {
  sunny: '#232733',
  cloudy: '#20242c',
  overcast: '#1b1e24',
  rain: '#171a20',
  snow: '#262b33',
};
const _TMP_C = /* @__PURE__ */ new THREE.Color();
const _TMP_D = /* @__PURE__ */ new THREE.Color();
const _WARM = /* @__PURE__ */ new THREE.Color(); // E7 夜晚开灯 → 环境光向暖色偏移的目标色
const _COOL_C = /* @__PURE__ */ new THREE.Color(); // G5 雨天阴沉 → 环境/半球光向冷灰偏移的目标色

/**
 * E2 昼夜平滑：mix 每帧向目标阻尼（0=白天 / 1=夜晚），驱动天空底色；
 * v9 天空颜色随天气联动（晴=天蓝、阴=灰、雨=深灰、雪=米白），天气切换也阻尼过渡不跳变。
 */
function NightBlend({ night, mixRef, weather = 'sunny' }: { night: boolean; mixRef: RefObject<{ v: number }>; weather?: HomeWeather }) {
  const scene = useThree((s) => s.scene);
  const cur = useRef(new THREE.Color(SKY_DAY.sunny));
  useFrame((_, dt) => {
    mixRef.current.v = THREE.MathUtils.damp(mixRef.current.v, night ? 1 : 0, 2.2, Math.min(dt, 0.05));
    _TMP_D.set(SKY_DAY[weather]).lerp(_TMP_C.set(SKY_NIGHT[weather]), mixRef.current.v);
    cur.current.lerp(_TMP_D, Math.min(1, dt * 1.6));
    scene.background = cur.current;
  });
  return null;
}

/** D4 画质档位：FPS 自适应降级（dpr 钳制 + 阴影分辨率/开关） */
export type SceneQuality = 'high' | 'mid' | 'low';
/** 档位 → Canvas dpr 区间；v10.3 提高上限到 min(devicePixelRatio, 2)：高分屏文字/气泡不再发虚 */
const Q_DPR: Record<SceneQuality, [number, number]> = {
  high: [1.35, 2],
  mid: [1, 1.5],
  low: [0.85, 1],
};
/** 档位 → 主光阴影贴图边长（low = 整关阴影） */
const Q_SHADOW: Record<SceneQuality, number> = { high: 1024, mid: 512, low: 0 };

function Lights({
  night,
  mixRef,
  quality,
  litLamps = 0,
  gloomy = false,
}: {
  night: boolean;
  mixRef: RefObject<{ v: number }>;
  quality: SceneQuality;
  /** E7：亮着的灯具数量（越多环境光越亮越暖；夜晚全额生效，白天 ×0.3） */
  litLamps?: number;
  /** G5 雨天阴沉：环境/半球光变暗变冷（damp 平滑过渡，不瞬切；雪不动灯光） */
  gloomy?: boolean;
}) {
  const dir = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const tmp = useMemo(() => new THREE.Color(), []);
  /** G5 阴沉系数（0=晴 / 1=雨天全值），每帧 damp */
  const gloomRef = useRef(0);
  useEffect(() => {
    // 切换昼夜时重投阴影
    dir.current?.shadow?.camera?.updateProjectionMatrix();
  }, [night]);
  // D4：画质档位变化 → 重分配阴影贴图尺寸（dispose 旧贴图才会按新 mapSize 重建）
  useEffect(() => {
    const l = dir.current;
    if (!l) return;
    l.castShadow = quality !== 'low';
    const size = Q_SHADOW[quality];
    if (size > 0 && l.shadow.mapSize.width !== size) {
      l.shadow.mapSize.set(size, size);
      if (l.shadow.map) {
        l.shadow.map.dispose();
        l.shadow.map = null;
      }
      l.shadow.camera.updateProjectionMatrix();
    }
  }, [quality]);
  useFrame((_, dt) => {
    const k = mixRef.current.v;
    const d = Math.min(dt, 0.05);
    // E7 灯光氛围：亮着的灯具越多环境光越亮越暖（直接加进 damp 目标值，昼夜 damp 不受影响）
    const lit = Math.min(litLamps, 5);
    const dayK = night ? 1 : 0.3; // 夜晚全额生效，白天轻微
    // G5 雨天氛围：在昼夜 damp 目标上再让环境/半球光亮度 ×0.85 + 色调向冷灰偏移（平滑过渡）
    gloomRef.current = THREE.MathUtils.damp(gloomRef.current, gloomy ? 1 : 0, 2.2, d);
    const gloom = 1 - 0.15 * gloomRef.current;
    if (amb.current) {
      amb.current.intensity = THREE.MathUtils.damp(
        amb.current.intensity,
        ((night ? 0.55 : 0.95) + lit * 0.07 * dayK) * gloom,
        2.2,
        d,
      );
      // 昼夜 lerp 完成后再向暖色微调（tmp 是复用临时色，必须等 lerp 用完再叠加，且只在夜晚生效）
      amb.current.color
        .copy(tmp.set('#fff3e0').lerp(_TMP_C.set('#a8b4cd'), k))
        .lerp(_WARM.set('#ffdcb0'), lit * 0.06 * (night ? 1 : 0))
        .lerp(_COOL_C.set('#8d99ad'), gloomRef.current * 0.35);
    }
    if (hemi.current) {
      hemi.current.intensity = THREE.MathUtils.damp(
        hemi.current.intensity,
        ((night ? 0.5 : 0.55) + lit * 0.05 * dayK) * gloom,
        2.2,
        d,
      );
      hemi.current.color
        .copy(tmp.set('#fdf6e8').lerp(_TMP_C.set('#39415c'), k))
        .lerp(_COOL_C.set('#8d99ad'), gloomRef.current * 0.3);
      hemi.current.groundColor.copy(tmp.set('#e5d6b8').lerp(_TMP_C.set('#23252c'), k));
    }
    if (dir.current) {
      dir.current.intensity = THREE.MathUtils.damp(dir.current.intensity, night ? 0.35 : 1.55, 2.2, d);
      dir.current.color.copy(tmp.set('#ffe9c8').lerp(_TMP_C.set('#b9c8e2'), k));
      // 太阳/月亮方位也缓推
      dir.current.position.x = THREE.MathUtils.damp(dir.current.position.x, night ? -4 : 5, 2, d);
      dir.current.position.z = THREE.MathUtils.damp(dir.current.position.z, night ? -3 : 4, 2, d);
    }
  });
  return (
    <>
      <ambientLight ref={amb} intensity={0.95} color="#fff3e0" />
      <hemisphereLight ref={hemi} args={['#fdf6e8', '#e5d6b8', 0.55]} />
      <directionalLight
        ref={dir}
        castShadow
        position={[5, 7.5, 4]}
        intensity={1.55}
        color="#ffe9c8"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-camera-near={0.5}
        shadow-camera-far={30}
        shadow-bias={-0.0006}
      />
    </>
  );
}

/**
 * C6 睡觉小夜灯：躺床时小人身边亮起一盏暖色小夜灯（全屋主灯已自动关闭），
 * 起床后缓缓熄灭。
 */
function BedNightLight({ poseRef, meRT }: { poseRef: RefObject<{ pose: CharPose; y: number }>; meRT: CharRT }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame((_, dt) => {
    const l = light.current;
    if (!l) return;
    const on = poseRef.current?.pose === 'lie';
    l.intensity = THREE.MathUtils.damp(l.intensity, on ? 0.55 : 0, 3, Math.min(dt, 0.05));
    l.position.set(meRT.x, 0.85, meRT.z);
  });
  return <pointLight ref={light} color="#ffd9a0" intensity={0} distance={2.6} decay={2} />;
}

/**
 * v11 G1 雷电室内瞬亮：闪电窗口期环境光短暂脉冲（独立加法灯，不干扰 Lights 的昼夜 damp 目标）。
 * lit 由 HomeScene 的雷电调度器（state）驱动 —— 主闪 0.12s → 熄 0.18s → 二闪 0.1s。
 */
function LightningPulse({ lit }: { lit: boolean }) {
  const pulse = useRef<THREE.AmbientLight>(null);
  useFrame((_, rawDt) => {
    const l = pulse.current;
    if (!l) return;
    const d = Math.min(rawDt, 0.05);
    // 亮起极快（~50ms 全亮）、熄灭稍缓（真实的视觉暂留）
    l.intensity = THREE.MathUtils.damp(l.intensity, lit ? 1.55 : 0, lit ? 34 : 13, d);
  });
  return <ambientLight ref={pulse} color="#dfe9ff" intensity={0} />;
}

// ---------------- v11 G4 抱抱暖光脉冲（companion hugStart 事件触发） ----------------

/** 拥抱脉冲请求（HomeScene 在 hugStart 事件时写入；HugWarmPulse 每帧消费一次） */
interface HugPulseReq {
  x: number;
  z: number;
}

/**
 * 抱抱暖光脉冲：两人中点地面一圈暖色光环（RingGeometry 水平扩散上升淡出 ~1.4s，
 * AdditiveBlending）+ 一颗临时暖色 PointLight 0→1.2→0 脉冲，结束自动清理（visible=false / intensity=0）。
 */
function HugWarmPulse({ reqRef }: { reqRef: RefObject<HugPulseReq | null> }) {
  const ring = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const act = useRef({ x: 0, z: 0, t: -10 });
  const DUR = 1.4;
  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const req = reqRef.current;
    if (req) {
      act.current = { x: req.x, z: req.z, t: now };
      reqRef.current = null;
    }
    const a = act.current;
    const age = now - a.t;
    const mesh = ring.current;
    const li = light.current;
    if (!mesh || age < 0 || age > DUR) {
      if (mesh) mesh.visible = false;
      if (li) li.intensity = 0;
      return;
    }
    const k = age / DUR;
    mesh.visible = true;
    mesh.position.set(a.x, 0.035 + k * 0.52, a.z);
    const s = 0.25 + k * 1.35;
    mesh.scale.set(s, s, s);
    (mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(k * Math.PI) * 0.75;
    if (li) {
      li.position.set(a.x, 0.5, a.z);
      li.intensity = Math.sin(k * Math.PI) * 1.2;
    }
  });
  return (
    <group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false} frustumCulled={false}>
        <ringGeometry args={[0.55, 0.8, 40]} />
        <meshBasicMaterial
          color="#ffb98a"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <pointLight ref={light} color="#ffc08a" intensity={0} distance={3.4} decay={2} />
    </group>
  );
}

// ---------------- G6 小屋宠物：会溜达的小猫（点它 = 摸头：爱心 + 喵~ + 压扁回弹） ----------------

/** 爱心贴图（粉渐变，柔边） */
function makeHeartTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(48, 44, 4, 48, 48, 44);
  g.addColorStop(0, '#ff9db4');
  g.addColorStop(0.6, '#f76e92');
  g.addColorStop(1, 'rgba(247,110,146,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(48, 78);
  ctx.bezierCurveTo(18, 56, 14, 30, 30, 22);
  ctx.bezierCurveTo(41, 17, 48, 26, 48, 34);
  ctx.bezierCurveTo(48, 26, 55, 17, 66, 22);
  ctx.bezierCurveTo(82, 30, 78, 56, 48, 78);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 「喵~」气泡贴图（白底圆角气泡 + 文字） */
function makeMeowTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.strokeStyle = 'rgba(240,180,196,0.9)';
  ctx.lineWidth = 4;
  const r = 22;
  ctx.beginPath();
  ctx.moveTo(14 + r, 10);
  ctx.arcTo(114, 10, 114, 62, r);
  ctx.arcTo(114, 62, 14, 62, r);
  ctx.arcTo(14, 62, 14, 10, r);
  ctx.arcTo(14, 10, 114, 10, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 小尾巴指向小猫
  ctx.beginPath();
  ctx.moveTo(34, 62);
  ctx.quadraticCurveTo(26, 80, 14, 86);
  ctx.quadraticCurveTo(30, 78, 42, 62);
  ctx.fill();
  ctx.font = '900 40px "PingFang SC", "Nunito", ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e46a86';
  ctx.fillText('喵~', 64, 37);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PET_HEART_N = 4;

/** 宠物照顾动作时长（到位后）：抚摸 / 吃饭 / 喝水 / 洗澡 / 抱抱 / 召唤 */
const PET_CARE_DUR: Record<PetCareKind, number> = {
  pat: 2.0, feed: 4.2, water: 4.2, bath: 4.6, hug: 3.4, summon: 1.6,
  // v8.3 成长解锁的小把戏（握手/转圈/打滚）；ball 走独立通道（时长 0 不入 care 管线）
  shake: 3.0, spin: 3.4, roll: 3.6, ball: 0,
  // v10 C2 训练系统新把戏：装死（侧倒四脚朝天）
  dead: 3.8,
  // v11 主控加的挠痒痒（PetCareKind += 'tickle'）
  tickle: 2.8,
};

/** 走向小人速度（召唤 = 一叫就到，疾跑） */
const petWalkSpeed = (kind: PetCareKind) => (kind === 'summon' ? 1.75 : kind === 'ball' ? 0 : 0.95);

/** v8.3 宠物毛色（G 选项）：身体/头部主色；cow = 奶牛斑 */
const PET_COATS: Record<PetCoat, { body: string; head: string; tail: string }> = {
  cream: { body: '#fbf3e6', head: '#fdf8ee', tail: '#f7ede0' },
  orange: { body: '#f0b878', head: '#f6cd94', tail: '#e8a95f' },
  gray: { body: '#b3b7c1', head: '#c4c8d1', tail: '#a5a9b4' },
  cow: { body: '#f6f5f2', head: '#faf9f7', tail: '#efeeea' },
};

// ---------------- v10 C3 多宠社交：全屋宠物 rt 注册表（互相追逐/打招呼用） ----------------
const PET_RT_REG = new Map<string, CharRT>();

// ---------------- v11 H1 逗宠手指：生活模式按住屏幕划动 → 宠物追指尖 ----------------
/** 指尖地板落点（模块级共享：PetFingerTracker 写入 / PetBuddy·PetBuddy2 读取；
 *  t = Date.now() 时间戳，2s 不更新视为失效恢复漫游；null = 无手指） */
const petFingerRef: { current: { x: number; z: number; t: number } | null } = { current: null };

/** 指尖追踪器：把按住中的指针落点射线投到地板平面（y=0），写入 petFingerRef */
function PetFingerTracker({ modeRef }: { modeRef: RefObject<HomeMode> }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    let pid = -1;
    const toFloor = (e: PointerEvent) => {
      if (modeRef.current !== 'live') return; // 装修/其它模式不响应
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, hit)) {
        petFingerRef.current = { x: hit.x, z: hit.z, t: Date.now() };
      }
    };
    const down = (e: PointerEvent) => {
      pid = e.pointerId;
      toFloor(e);
    };
    const move = (e: PointerEvent) => {
      if (pid < 0 || e.pointerId !== pid) return;
      toFloor(e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === pid) pid = -1; // 抬起后落点留在原地，2s 新鲜窗口过后自动恢复漫游
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      pid = -1;
    };
  }, [camera, gl, modeRef]);
  return null;
}

/** v8.3 小剧场贴图：蝴蝶（双粉翅）/ 萤火虫（暖光晕） */
function makeTheaterTexture(kind: 'butterfly' | 'firefly'): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  if (kind === 'butterfly') {
    ctx.translate(48, 48);
    // 双翅（上下两瓣）
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.scale(s, 1);
      ctx.fillStyle = '#f7a8c4';
      ctx.beginPath();
      ctx.ellipse(20, -12, 19, 15, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fbd0e0';
      ctx.beginPath();
      ctx.ellipse(16, 12, 14, 11, 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.ellipse(22, -14, 6, 4, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 身体 + 触角
    ctx.strokeStyle = '#7a5a4a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(0, 18);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.quadraticCurveTo(-8, -30, -12, -28);
    ctx.moveTo(0, -20);
    ctx.quadraticCurveTo(8, -30, 12, -28);
    ctx.stroke();
  } else {
    // 萤火虫：中心亮点 + 柔和光晕
    const g = ctx.createRadialGradient(48, 48, 2, 48, 48, 44);
    g.addColorStop(0, 'rgba(255,244,190,1)');
    g.addColorStop(0.28, 'rgba(255,232,140,0.85)');
    g.addColorStop(1, 'rgba(255,220,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
    ctx.fillStyle = '#6b5a3a';
    ctx.beginPath();
    ctx.ellipse(48, 52, 5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** v7.1 需求气泡种类：饿了 / 想喝水 / 要洗澡（D：状态低时宠物头顶冒泡更直观） */
type PetNeed = 'hungry' | 'thirsty' | 'bath';

/** 需求气泡贴图：白底圆角气泡 + 手绘小图标（碗/水滴/泡泡，不依赖 emoji 字体） */
function makeNeedTexture(kind: PetNeed): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 100;
  const ctx = cv.getContext('2d')!;
  // 气泡底
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = 'rgba(225,185,150,0.9)';
  ctx.lineWidth = 4;
  const r = 20;
  ctx.beginPath();
  ctx.moveTo(14 + r, 8);
  ctx.arcTo(114, 8, 114, 60, r);
  ctx.arcTo(114, 60, 14, 60, r);
  ctx.arcTo(14, 60, 14, 8, r);
  ctx.arcTo(14, 8, 114, 8, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 小尾巴指向小猫
  ctx.beginPath();
  ctx.moveTo(38, 60);
  ctx.quadraticCurveTo(30, 80, 18, 88);
  ctx.quadraticCurveTo(34, 78, 46, 60);
  ctx.fill();
  if (kind === 'hungry') {
    // 饭碗：橙色半圆碗 + 碗沿 + 两条热气
    ctx.strokeStyle = '#e0863c';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(64, 34, 15, 0, Math.PI, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(44, 34);
    ctx.lineTo(84, 34);
    ctx.stroke();
    ctx.fillStyle = '#e0863c';
    ctx.fillRect(48, 38, 32, 4);
    // 热气两缕
    ctx.strokeStyle = '#e8a86a';
    ctx.lineWidth = 3;
    for (const hx of [56, 70]) {
      ctx.beginPath();
      ctx.moveTo(hx, 26);
      ctx.quadraticCurveTo(hx - 4, 20, hx, 15);
      ctx.stroke();
    }
  } else if (kind === 'thirsty') {
    // 水滴：天蓝贝塞尔水滴 + 高光
    ctx.fillStyle = '#4aa3d8';
    ctx.beginPath();
    ctx.moveTo(64, 14);
    ctx.bezierCurveTo(80, 34, 84, 44, 64, 52);
    ctx.bezierCurveTo(44, 44, 48, 34, 64, 14);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(58, 40, 4.5, 6, -0.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 泡泡：三颗青色圆圈（大小错落 + 高光点）
    const bubbles: [number, number, number][] = [
      [52, 34, 11],
      [74, 26, 8],
      [70, 44, 6],
    ];
    for (const [bx, by, br] of bubbles) {
      ctx.strokeStyle = '#52b8c9';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(82,184,201,0.35)';
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(bx - br * 0.35, by - br * 0.35, br * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 小星星贴图（金黄五角星，柔边光晕；E：照顾时小人头顶冒星星） */
function makeStarTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  const cx = 48;
  const cy = 50;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? 30 : 13;
    const px = cx + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#f7c44e';
  ctx.shadowColor = 'rgba(247,196,78,0.75)';
  ctx.shadowBlur = 12;
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 笑脸贴图（^ ^ 弯眼 + 微笑弧嘴，无外框；E：抱抱时双方头顶冒笑脸） */
function makeSmileTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 72;
  const ctx = cv.getContext('2d')!;
  ctx.strokeStyle = '#e46a86';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  // 两只弯眼（^）
  for (const ex of [30, 66]) {
    ctx.beginPath();
    ctx.moveTo(ex - 9, 26);
    ctx.quadraticCurveTo(ex, 12, ex + 9, 26);
    ctx.stroke();
  }
  // 微笑嘴（U 弧）
  ctx.beginPath();
  ctx.moveTo(32, 42);
  ctx.quadraticCurveTo(48, 60, 64, 42);
  ctx.stroke();
  // 腮红
  ctx.fillStyle = 'rgba(246,170,180,0.8)';
  for (const bx of [20, 76]) {
    ctx.beginPath();
    ctx.ellipse(bx, 40, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Zzz 贴图（手绘三连 Z，睡觉特效；不依赖 emoji/字体） */
function makeZzzTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 72;
  const ctx = cv.getContext('2d')!;
  ctx.strokeStyle = '#8a7ab0';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const zz: [number, number, number, number][] = [
    [12, 12, 34, 5.5], // 大 Z：x / y / 宽 / 线宽
    [46, 34, 22, 4.2], // 中 z
    [66, 50, 14, 3.2], // 小 z
  ];
  for (const [x, y, w, lw] of zz) {
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x, y + w * 0.85);
    ctx.lineTo(x + w, y + w * 0.85);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 洗澡泡泡（附着在宠物身上；x,y,z,半径） */
const PET_FOAM: [number, number, number, number][] = [
  [0, 0.315, 0.05, 0.042],
  [-0.075, 0.21, 0.015, 0.036],
  [0.085, 0.2, -0.045, 0.033],
  [0.01, 0.26, -0.1, 0.038],
  [-0.045, 0.275, 0.075, 0.028],
  [0.06, 0.29, 0.06, 0.024],
];

/**
 * 小屋宠物「团子」：奶油色小猫，生活模式全屋溜达（v7.1 跨房间漫游：开门去卧室/厨房/卫生间/阳台闲逛），
 * 走路颠步 + 尾巴摆动；点它 = 打开互动按钮 + 开心小反应。
 * v6.9 照顾指令（petCmdRef）：抚摸 → 宠物走到小人身边，小人伸手摸头；
 * 喂食/喂水 → 宠物走到小人面前，小人蹲下递碗，宠物低头吃/喝，碗随后消失。
 * v7.1 新增：夜晚自己回猫窝蜷成团睡觉（Zzz）+ 状态低头顶需求气泡（饿了/想喝水/要洗澡）
 *   + 照顾时小人头顶冒爱心/星星（抱抱双方冒笑脸）+ 萌系音效（呼噜/咔嚓/咕喸/水声/咂嘴/哨声/喵叫）。
 */
function PetBuddy({
  mode,
  items,
  meRT,
  petCmdRef,
  petCarryCmdRef,
  onPetTap,
  onPetEvent,
  night,
  petState,
  doorRef,
  weatherFx,
  petCoat = 'cream',
  petWear,
  petBallCmdRef,
  petRTRef,
  petGrowLv = 1,
}: {
  mode: HomeMode;
  items: FurnitureItem[];
  meRT: CharRT;
  petCmdRef?: RefObject<{ kind: PetCareKind; seq: number; carry?: boolean; target?: string } | null>;
  /** v7.2 抱抱指令（on=true 抱起 / on=false 放下；seq 变化触发；v9 target 路由） */
  petCarryCmdRef?: RefObject<{ on: boolean; seq: number; target?: string }>;
  onPetTap?: (petId?: string) => void;
  onPetEvent?: (ev: 'arrive' | 'done' | 'cancel' | 'dropped', kind: PetCareKind, petId?: string) => void;
  /** 夜晚（回猫窝睡觉） */
  night?: boolean;
  /** 宠物状态（需求气泡：体力低=饿了 / 心情低=想喝水 / 清洁低=要洗澡） */
  petState?: PetState;
  /** 四扇门开态（跨房间漫游穿门用） */
  doorRef?: RefObject<{ bed: DoorLive; kt: DoorLive; bath: DoorLive; bal?: DoorLive; sr?: DoorLive; yd?: DoorLive }>;
  /** v9 天气（小剧场剧本：雨天躲屋檐；晴/多云时追蝴蝶） */
  weatherFx?: HomeWeather;
  /** v8.3 毛色 / 装扮 / 玩具球指令 */
  petCoat?: PetCoat;
  petWear?: PetWear;
  petBallCmdRef?: RefObject<{ seq: number; target?: string }>;
  /** v8.3 把自己的运行时暴露给第二只宠物（追着玩用） */
  petRTRef?: RefObject<CharRT | null>;
  /** v11 成长等级 1~9（体型缩放 0.62→1.0，共享全屋同一等级） */
  petGrowLv?: number;
}) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /** 漫游状态（同 CharRT：全屋随机遛弯，roam() 复用） */
  const rt = useRef<CharRT>({ x: -1.4, z: 1.5, heading: 2.2, moving: false, target: null, nextWander: 0 });
  // v10 C3 多宠社交：注册自己 / 追逐兄弟宠物
  const sibChase = useRef<{ id: string; until: number } | null>(null);
  const root = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const earL = useRef<THREE.Group>(null);
  const earR = useRef<THREE.Group>(null);
  const meowSp = useRef<THREE.Sprite>(null);
  /** 吃/喝时低头点头的头部（进食节拍） */
  const headGrp = useRef<THREE.Group>(null);
  /** 喂食/喂水的碗（独立世界坐标组，摆在小人与宠物之间） */
  const bowl = useRef<THREE.Group>(null);
  /** 摸头余韵（1→0） */
  const pat = useRef(0);
  /** 喵气泡剩余时间 */
  const meow = useRef(0);
  /** 爱心起飞时刻（每次摸头重排） */
  const heartT = useRef<number[]>([0, 0, 0, 0].map(() => -10));
  /** 照顾中的动作（从 petCmdRef 捕获；phase: walk 走向小人 / do 就位互动；carry=true 抱起模式不自动结束） */
  const care = useRef<{ kind: PetCareKind; phase: 'walk' | 'do'; t: number; carry?: boolean } | null>(null);
  /** 已消费的指令序号 */
  const lastSeq = useRef(-1);
  /** v7.2 抱抱抱起态：true = 被抱在怀里（跟随小人移动，不回窝不乱跑） */
  const carrying = useRef(false);
  /** 已消费的抱抱指令序号 */
  const lastCarrySeq = useRef(0);
  /** 抱抱：被抱起的抬升（0→1 缓动，抱住时 ≈1，结束回落） */
  const hugLift = useRef(0);
  /** 洗澡泡泡组（bath do 阶段显示） */
  const foamGrp = useRef<THREE.Group>(null);
  // —— v7.1 夜晚回窝睡觉 ——
  /** 正在蜷窝睡觉（到位后 true；天亮/照顾指令唤醒） */
  const sleeping = useRef(false);
  /** 正在走向猫窝 */
  const goBed = useRef(false);
  /** 开始回窝的时刻（clock 秒；8s 走不到 → 传送进窝兜底） */
  const goBedT = useRef(0);
  /** 找到的猫窝位置（每帧从 items 解析，避免陈旧） */
  const bedPos = useRef<Pt | null>(null);
  /** Zzz 气泡（睡觉时循环上浮） */
  const zzzSp = useRef<THREE.Sprite>(null);
  /** Zzz 循环节拍 */
  const zzzBeat = useRef(0);
  /** 入睡前缓动（0→1：趴下缩成团的过渡） */
  const sleepEase = useRef(0);
  // —— v7.1 需求气泡（饿了/想喝水/要洗澡，状态 <30 显示） ——
  const needSp = useRef<(THREE.Sprite | null)[]>([null, null, null]);
  // —— v7.1 小人表情联动（照顾时冒爱心/星星，抱抱冒笑脸） ——
  const emoteSp = useRef<(THREE.Sprite | null)[]>([null, null, null, null]);
  const emoteT = useRef<number[]>([-10, -10, -10, -10]);
  const emoteBeat = useRef(0);
  const smileSp = useRef<THREE.Sprite>(null);
  const smileT = useRef(0);

  // —— v8.3 玩具球（A：扔出去 → 猫追着跑叼回来） ——
  const ballGrp = useRef<THREE.Group>(null);
  /** 球状态机：hidden 藏着 / fly 抛物线飞行 / rest 落地等猫 / carried 猫叼着 */
  const ball = useRef<{ phase: 'hidden' | 'fly' | 'rest' | 'carried'; t: number; from: Pt; to: Pt; bounce: number }>({
    phase: 'hidden',
    t: 0,
    from: { x: 0, z: 0 },
    to: { x: 0, z: 0 },
    bounce: 0,
  });
  const lastBallSeq = useRef(0);
  /** 猫的捡球任务：chase 追球 / return 叼回主人身边 */
  const fetching = useRef<'chase' | 'return' | null>(null);

  // —— v8.3 小剧场（D：白天追蝴蝶 / 夜里扑萤火虫 / 雨天躲屋檐） ——
  const theater = useRef<{
    kind: 'butterfly' | 'firefly' | 'rain' | 'laser' | 'box' | 'mirror' | null;
    t: number;
    ax: number;
    az: number;
    pounced: number;
    /** v10 C1 镜子惊吓：已跳过没有 */
    scared?: boolean;
  }>({ kind: null, t: 0, ax: 0, az: 0, pounced: 0 });
  /** v10 C1 纸箱：钻箱小剧场用（出现/隐藏） */
  const boxRef = useRef<THREE.Group>(null);
  const boxFade = useRef(0);
  const nextTheaterAt = useRef(14 + Math.random() * 10);
  // v10 C3：把自己（猫）注册进宠物 rt 注册表（互相追逐用）
  useEffect(() => {
    PET_RT_REG.set('cat', rt.current);
    return () => {
      PET_RT_REG.delete('cat');
    };
  }, []);
  const bflySp = useRef<THREE.Sprite>(null);
  const flySp = useRef<(THREE.Sprite | null)[]>([null, null, null]);
  const flyBeat = useRef<number[]>([0, 1.3, 2.6]);

  // —— v8.3 成长把戏（F：握手/转圈/打滚动画用） ——
  const pawFR = useRef<THREE.Mesh>(null);
  /** 转圈/打滚的累计角度（do 阶段推进，结束归零） */
  const trickSpin = useRef(0);
  /** 小剧场扑跳高度（萤火虫 pounce）/ 雨天躲雨趴下的软弱感 */
  const hopY = useRef(0);
  const rainRest = useRef(0);
  // —— v11 H1 逗宠手指：到位后的小幅扑跳节拍 ——
  const fingerHopT = useRef(0);
  // —— v11 H2 成长体型：目标缩放随 petGrowLv，每帧 0.03 lerp 平滑过渡（不瞬跳） ——
  const grow = useRef(0.62 + ((Math.min(9, Math.max(1, petGrowLv)) - 1) / 8) * 0.38);

  const heartTex = useMemo(() => makeHeartTexture(), []);
  const meowTex = useMemo(() => makeMeowTexture(), []);
  const starTex = useMemo(() => makeStarTexture(), []);
  const smileTex = useMemo(() => makeSmileTexture(), []);
  const zzzTex = useMemo(() => makeZzzTexture(), []);
  const needTex = useMemo(() => ({ hungry: makeNeedTexture('hungry'), thirsty: makeNeedTexture('thirsty'), bath: makeNeedTexture('bath') }), []);
  const heartMats = useMemo(
    () =>
      Array.from({ length: PET_HEART_N }, () => {
        const m = new THREE.SpriteMaterial({ map: heartTex, transparent: true, opacity: 0, depthWrite: false });
        return m;
      }),
    [heartTex],
  );
  /** 小人头顶 emote 材质（爱心/星星交替） */
  const emoteMats = useMemo(
    () =>
      Array.from({ length: 4 }, (_, i) => {
        const m = new THREE.SpriteMaterial({ map: i % 2 === 0 ? heartTex : starTex, transparent: true, opacity: 0, depthWrite: false });
        return m;
      }),
    [heartTex, starTex],
  );
  /** 笑脸材质（抱抱时小人头顶冒笑脸） */
  const smileMat = useMemo(
    () => new THREE.SpriteMaterial({ map: smileTex, transparent: true, opacity: 0, depthWrite: false }),
    [smileTex],
  );
  const bflyTex = useMemo(() => makeTheaterTexture('butterfly'), []);
  const flyTex = useMemo(() => makeTheaterTexture('firefly'), []);
  const bflyMat = useMemo(
    () => new THREE.SpriteMaterial({ map: bflyTex, transparent: true, opacity: 0, depthWrite: false }),
    [bflyTex],
  );
  const flyMats = useMemo(
    () => Array.from({ length: 3 }, () => new THREE.SpriteMaterial({ map: flyTex, transparent: true, opacity: 0, depthWrite: false })),
    [flyTex],
  );

  /** v8.3 扔球（A）：从主人手上抛物线飞到同房间随机点（推出家具/钳回房间），随后猫自动去捡 */
  const throwBall = useCallback(() => {
    const dr = doorRef?.current;
    const doors = {
      bed: dr?.bed ?? CLOSED_DOOR,
      kt: dr?.kt ?? CLOSED_DOOR,
      bath: dr?.bath ?? CLOSED_DOOR,
      bal: dr?.bal ?? CLOSED_DOOR,
      sr: dr?.sr ?? CLOSED_DOOR,
      yd: dr?.yd ?? CLOSED_DOOR,
    };
    const ang = Math.random() * Math.PI * 2;
    const dist = 1.1 + Math.random() * 1.3;
    const probe: CharRT = {
      x: meRT.x + Math.sin(ang) * dist,
      z: meRT.z + Math.cos(ang) * dist,
      heading: 0,
      moving: false,
      target: null,
      nextWander: 0,
    };
    collideAndClamp(probe, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
    ball.current = { phase: 'fly', t: 0, from: { x: meRT.x, z: meRT.z }, to: { x: probe.x, z: probe.z }, bounce: 0 };
    fetching.current = null;
    // 睡觉/回窝被球叫醒
    if (sleeping.current || goBed.current) {
      sleeping.current = false;
      goBed.current = false;
      rt.current.target = null;
      rt.current.route = undefined;
      rt.current.nextWander = performance.now() / 1000 + 4;
    }
    sfx.whoosh();
  }, [meRT, doorRef]);

  /** 摸头！ */
  const patIt = useCallback(() => {
    if (modeRef.current !== 'live') return;
    pat.current = 1;
    meow.current = 1.35;
    sfx.purr(); // I：摸头呼噜声
    const t = performance.now() / 1000;
    heartT.current = Array.from({ length: PET_HEART_N }, (_, i) => t + 0.04 + i * 0.15);
  }, []);

  const onDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      patIt();
      onPetTap?.();
    },
    [patIt, onPetTap],
  );

  /** 结束照顾（done=正常完成，cancel=中断）：回调后清碗清状态 */
  const endCare = useCallback(
    (done: boolean) => {
      const k = care.current?.kind;
      care.current = null;
      trickSpin.current = 0; // v8.3 把戏复位
      if (pawFR.current) pawFR.current.rotation.x = 0;
      if (bowl.current) bowl.current.visible = false;
      if (k && onPetEvent) onPetEvent(done ? 'done' : 'cancel', k);
    },
    [onPetEvent],
  );

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    const g = root.current;
    if (!g) return;
    if (modeRef.current !== 'live') {
      g.visible = false;
      // 切装修/退出时照顾中断；被抱着的小猫先轻轻放到小人面前
      if (care.current) {
        if (carrying.current) {
          carrying.current = false;
          const hd = meRT.heading;
          rt.current.x = meRT.x + Math.sin(hd) * 0.42;
          rt.current.z = meRT.z + Math.cos(hd) * 0.42;
          onPetEvent?.('dropped', 'hug');
        }
        endCare(false);
      }
      hugLift.current = 0;
      if (foamGrp.current) foamGrp.current.visible = false;
      return;
    }
    g.visible = true;
    if (petRTRef) petRTRef.current = rt.current;

    // —— 捕获新照顾指令（seq 变化即触发；v9 target 路由：只有 target 为空（旧入口）或 'cat' 才接；睡觉中被叫醒） ——
    const cmd = petCmdRef?.current;
    if (cmd && cmd.seq !== lastSeq.current && (!cmd.target || cmd.target === 'cat')) {
      lastSeq.current = cmd.seq;
      if (!care.current) {
        care.current = { kind: cmd.kind, phase: 'walk', t: 0, carry: cmd.carry }; // v7.2 carry=true：抱起模式
        if (cmd.kind === 'summon') sfx.whistle(); // I：召唤哨声（一叫就到）
        // 夜晚被照顾：从窝里爬起来（照顾完歇一会儿再回去睡）
        if (sleeping.current || goBed.current) {
          sleeping.current = false;
          goBed.current = false;
          rt.current.target = null;
          rt.current.route = undefined;
          rt.current.nextWander = performance.now() / 1000 + 4;
        }
      }
    }

    // —— 四扇门开态（跨房间移动穿门走廊用） ——
    const dr = doorRef?.current;
    const doors = {
      bed: dr?.bed ?? CLOSED_DOOR,
      kt: dr?.kt ?? CLOSED_DOOR,
      bath: dr?.bath ?? CLOSED_DOOR,
      bal: dr?.bal ?? CLOSED_DOOR,
      sr: dr?.sr ?? CLOSED_DOOR,
      yd: dr?.yd ?? CLOSED_DOOR,
    };

    // —— v7.2 放下指令（seq 变化触发）：抱起时收到 on=false → 轻轻放到小人面前 ——
    //   （抱起走 petCmdRef 的 carry 标志，无需独立 on=true 通道）
    const cc = petCarryCmdRef?.current;
    if (cc && !cc.on && cc.seq !== lastCarrySeq.current && (!cc.target || cc.target === 'cat')) {
      lastCarrySeq.current = cc.seq;
      if (care.current?.carry) {
        if (carrying.current) {
          // 放下：轻轻放到小人面前地上（碰撞检测防卡进家具）
          carrying.current = false;
          const hd = meRT.heading;
          rt.current.x = meRT.x + Math.sin(hd) * 0.42;
          rt.current.z = meRT.z + Math.cos(hd) * 0.42;
          rt.current.moving = false;
          rt.current.target = null;
          rt.current.route = undefined;
          collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
          pat.current = 0.85;
          meow.current = 1.1;
          sfx.kiss();
          const tn = performance.now() / 1000;
          heartT.current = Array.from({ length: PET_HEART_N }, (_, i) => tn + 0.04 + i * 0.15);
          rt.current.nextWander = performance.now() / 1000 + 1.6;
        }
        care.current = null;
        onPetEvent?.('dropped', 'hug');
      }
    }

    // —— v8.3 扔球指令（seq 变化 = 扔一次；照顾中/被抱着时不接） ——
    const bc = petBallCmdRef?.current;
    if (bc && bc.seq !== lastBallSeq.current && (!bc.target || bc.target === 'cat')) {
      lastBallSeq.current = bc.seq;
      if (!care.current && !carrying.current) throwBall();
    }

    // —— v8.3 球物理（抛物线 → 落地轻弹 → 等猫来叼；被叼着时贴在猫嘴前） ——
    if (ballGrp.current) {
      const b = ball.current;
      if (b.phase === 'fly') {
        b.t += dt / 0.85;
        if (b.t >= 1) {
          b.t = 0;
          b.phase = 'rest';
          b.bounce = 2;
          if (!fetching.current && !care.current && !carrying.current && modeRef.current === 'live') {
            fetching.current = 'chase';
          }
        }
      } else if (b.phase === 'rest' && b.bounce > 0) {
        // 落地小弹跳（两次，一次比一次低）
        b.t += dt;
        if (b.t > 0.34) {
          b.t = 0;
          b.bounce -= 1;
        }
      }
      const bg = ballGrp.current;
      if (b.phase === 'hidden') {
        bg.visible = false;
      } else if (b.phase === 'fly') {
        bg.visible = true;
        const k = Math.min(1, b.t);
        bg.position.set(
          THREE.MathUtils.lerp(b.from.x, b.to.x, k),
          0.055 + Math.sin(Math.PI * k) * 0.72,
          THREE.MathUtils.lerp(b.from.z, b.to.z, k),
        );
        bg.rotation.z -= dt * 13;
        bg.rotation.x += dt * 5;
      } else if (b.phase === 'carried') {
        bg.visible = true;
        bg.position.set(rt.current.x + Math.sin(rt.current.heading) * 0.17, 0.13, rt.current.z + Math.cos(rt.current.heading) * 0.17);
        bg.rotation.z += dt * 2;
      } else {
        bg.visible = true;
        const hop = b.bounce > 0 ? Math.sin(Math.PI * Math.min(1, b.t / 0.34)) * 0.09 * b.bounce : 0;
        bg.position.set(b.to.x, 0.055 + hop, b.to.z);
      }
    }

    // —— 漫游 / 照顾移动 ——
    const c = care.current;
    if (c) {
      // 目标：小人当前位置（v7.1 宠物全屋活动，不再钳制在客厅 —— 开着门就能跟去卧室/厨房）
      const cx = meRT.x;
      const cz = meRT.z;
      const dx = cx - rt.current.x;
      const dz = cz - rt.current.z;
      const d = Math.hypot(dx, dz);
      if (c.phase === 'walk') {
        c.t += dt; // 走路计时（到位后清零复用为互动计时）
        if (d > 0.34 && c.t < 9) {
          const sp = petWalkSpeed(c.kind) * dt;
          rt.current.x += (dx / d) * Math.min(sp, d);
          rt.current.z += (dz / d) * Math.min(sp, d);
          rt.current.moving = true;
          rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(dx, dz), Math.min(1, dt * 8));
          rt.current.target = null;
          rt.current.route = undefined;
          collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
        } else {
          // 到位：面对面停住，通知小人摆 petcare 姿势
          // （9s 超时兜底：被家具/关门卡住时，直接把宠物放到小人身边，保证照顾一定能完成）
          if (d > 0.5) {
            const inv = 1 / Math.max(0.001, d);
            rt.current.x = cx - dx * inv * 0.45;
            rt.current.z = cz - dz * inv * 0.45;
          }
          rt.current.moving = false;
          rt.current.target = null;
          c.phase = 'do';
          c.t = 0;
          // 摸头/抱抱/召唤到位：开心压扁 + 爱心 + 呼噜（抱抱加咂嘴）；喂食/喂水/洗澡到位：喵一声乖乖坐好
          if (c.kind === 'pat' || c.kind === 'summon') patIt();
          else if (c.kind === 'hug') {
            patIt();
            sfx.kiss();
          } else {
            meow.current = 1.2;
            sfx.meow();
          }
          onPetEvent?.('arrive', c.kind);
        }
      } else {
        // —— do 阶段：面对面互动 ——
        rt.current.moving = false;
        if (c.kind === 'hug') {
          // 抱抱：宠物被搂进怀里 —— 贴到小人身前、抬升到胸口、朝向随小人（面朝外被抱着）
          // v7.2 carry=true：正式抱起 —— 贴更近些（0.27 防穿模）、跟随更紧（dt*10），走到哪抱到哪，永不自动结束
          const hd = meRT.heading;
          const off = c.carry ? 0.27 : 0.15;
          const k = Math.min(1, dt * (c.carry ? 10 : 8));
          rt.current.x = THREE.MathUtils.lerp(rt.current.x, meRT.x + Math.sin(hd) * off, k);
          rt.current.z = THREE.MathUtils.lerp(rt.current.z, meRT.z + Math.cos(hd) * off, k);
          rt.current.heading = lerpAngle(rt.current.heading, hd, k);
          hugLift.current = Math.min(1, hugLift.current + dt * 2.6);
          if (c.carry) carrying.current = true; // 抱起完成，进入怀抱跟随
          // 怀里蹭蹭：每隔 1.1s 再冒一串爱心（抱着模式前 3.2s 冒完就安静窝着）
          if (c.t % 1.1 < dt && (!c.carry || c.t < 3.2)) {
            const tn = performance.now() / 1000;
            heartT.current = Array.from({ length: PET_HEART_N }, (_, i) => tn + 0.04 + i * 0.15);
          }
        } else {
          hugLift.current = Math.max(0, hugLift.current - dt * 4);
          rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(-dx, -dz), Math.min(1, dt * 6));
          // 小人转身面对宠物（蹲下伸手/递碗/搓泡泡的朝向）
          meRT.heading = lerpAngle(meRT.heading, Math.atan2(rt.current.x - meRT.x, rt.current.z - meRT.z), Math.min(1, dt * 6));
        }
        // I：互动节拍音效 —— 吃饭咔嚓 / 喝水咕喸 / 洗澡流水
        if (c.kind === 'feed' && c.t % 0.55 < dt) sfx.crunch();
        else if (c.kind === 'water' && c.t % 0.7 < dt) sfx.sip();
        else if (c.kind === 'bath' && c.t % 2.4 < dt) sfx.bathWater();
        c.t += dt;
        // —— v8.3 成长把戏：握手（抬右前爪挥）/ 转圈（原地转两圈）/ 打滚（侧滚一周） ——
        if (c.kind === 'shake' && pawFR.current) {
          pawFR.current.rotation.x = -1.1 + Math.sin(c.t * 9) * 0.32;
        } else if (c.kind === 'spin') {
          trickSpin.current += dt * ((Math.PI * 4) / PET_CARE_DUR.spin);
        } else if (c.kind === 'roll') {
          trickSpin.current += dt * ((Math.PI * 2) / PET_CARE_DUR.roll);
        } else if (c.kind === 'dead') {
          // v10 C2 装死：侧倒 0.75π（最后定格四脚朝天），配一声小哼哼
          trickSpin.current += dt * ((Math.PI * 0.75) / PET_CARE_DUR.dead);
          if (c.t < dt * 1.5) sfx.meow();
        }
        // 小人走远了 → 中断（抱抱/抱着贴在怀里不会超）
        if (c.kind !== 'hug' && Math.hypot(meRT.x - rt.current.x, meRT.z - rt.current.z) > 0.75) {
          endCare(false);
        } else if (!c.carry && c.t >= PET_CARE_DUR[c.kind]) {
          endCare(true); // v7.2 抱着模式不自动结束 —— 等「放下」指令
        }
      }
    } else {
      // 非照顾态：抱抱抬升归位（照顾刚结束/被打断时把怀里的小猫轻轻放回地面）
      hugLift.current = Math.max(0, hugLift.current - dt * 4);
      // —— v7.1 夜晚回窝：找猫窝 → 走过去 → 蜷成团睡觉（Zzz）；天亮自己醒来继续溜达 ——
      const bedItem = itemsRef.current.find((f) => f.kind === 'petBed' && (f.y ?? 0) < 0.45);
      bedPos.current = bedItem ? { x: bedItem.x, z: bedItem.z } : null;
      const nightNow = !!night && !!bedPos.current;
      if (fetching.current) {
        // —— v8.3 捡球任务（A）：追球 → 叼住 → 送回主人脚边（优先级最高，睡觉也唤醒） ——
        sleeping.current = false;
        goBed.current = false;
        theater.current.kind = null;
        if (bflySp.current) bflySp.current.visible = false;
        flySp.current.forEach((sp) => {
          if (sp) sp.visible = false;
        });
        const b = ball.current;
        const tx = b.phase === 'carried' ? meRT.x : b.to.x;
        const tz = b.phase === 'carried' ? meRT.z : b.to.z;
        const dx = tx - rt.current.x;
        const dz = tz - rt.current.z;
        const d = Math.hypot(dx, dz);
        if (fetching.current === 'chase' && b.phase === 'rest' && d < 0.26) {
          b.phase = 'carried';
          fetching.current = 'return';
          sfx.pop();
        } else if (fetching.current === 'return' && d < 0.6) {
          // 叼回来：轻轻放到主人脚边 + 撒娇求夸
          const hd = meRT.heading;
          b.phase = 'rest';
          b.to = { x: meRT.x + Math.sin(hd) * 0.42, z: meRT.z + Math.cos(hd) * 0.42 };
          b.t = 0;
          b.bounce = 0;
          fetching.current = null;
          rt.current.target = null;
          rt.current.moving = false;
          pat.current = 0.85;
          meow.current = 1.1;
          sfx.kiss();
          const tn = performance.now() / 1000;
          heartT.current = Array.from({ length: PET_HEART_N }, (_, i) => tn + 0.04 + i * 0.15);
          rt.current.nextWander = performance.now() / 1000 + 2;
          onPetEvent?.('done', 'ball');
        } else if (d > 0.02) {
          const sp = (fetching.current === 'chase' ? 2.0 : 1.8) * dt;
          rt.current.x += (dx / d) * Math.min(sp, d);
          rt.current.z += (dz / d) * Math.min(sp, d);
          rt.current.moving = true;
          rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(dx, dz), Math.min(1, dt * 9));
          rt.current.target = null;
          rt.current.route = undefined;
          collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
        } else {
          rt.current.moving = false;
        }
      } else if (nightNow && !sleeping.current) {
        if (!goBed.current) {
          goBed.current = true;
          goBedT.current = t;
          rt.current.target = { x: bedPos.current!.x, z: bedPos.current!.z };
          const route = planRoute(roomAt(rt.current.x, rt.current.z), roomAt(bedPos.current!.x, bedPos.current!.z), doors);
          rt.current.route = route && route.length ? route : undefined;
          rt.current.nextWander = Number.POSITIVE_INFINITY;
        }
        roamStep(rt.current, dt, itemsRef.current, doors, ROAM_CAT.speed);
        if (!rt.current.target) {
          // 到窝了：蜷下睡着（睡前咕噜一声）
          goBed.current = false;
          sleeping.current = true;
          rt.current.x = bedPos.current!.x;
          rt.current.z = bedPos.current!.z;
          rt.current.route = undefined;
          sfx.purr();
        } else if (t - goBedT.current > 8) {
          // 兜底（同照顾 9s 传送）：被家具/墙夹住走不到窝 → 直接把猫放进窝，保证夜晚一定能睡下
          goBed.current = false;
          sleeping.current = true;
          rt.current.x = bedPos.current!.x;
          rt.current.z = bedPos.current!.z;
          rt.current.target = null;
          rt.current.route = undefined;
          rt.current.moving = false;
          sfx.purr();
        }
      } else if (!nightNow) {
        sleeping.current = false;
        goBed.current = false;
        if (rt.current.nextWander === Number.POSITIVE_INFINITY) rt.current.nextWander = performance.now() / 1000 + 1.2;
        // —— v8.3 小剧场（D）：空闲时白天追蝴蝶 / 夜里扑萤火虫 / 雨天躲屋檐 ——
        const th = theater.current;
        if (th.kind) {
          th.t += dt;
          if (th.kind === 'butterfly' || th.kind === 'laser') {
            // 蝴蝶绕锚点翩翩飞，猫踮着步子追；v10 C1 激光笔 = 红点高速乱窜（猫疯追）
            const L = th.kind === 'laser';
            const bx = th.ax + Math.sin(t * (L ? 3.6 : 1.7)) * (L ? 0.72 : 0.5);
            const bz = th.az + Math.cos(t * (L ? 2.9 : 1.3)) * (L ? 0.72 : 0.5);
            if (bflySp.current) {
              bflySp.current.visible = true;
              bflySp.current.position.set(bx, 0.4 + Math.sin(t * 3.1) * 0.08, bz);
              bflySp.current.material.rotation = Math.sin(t * 9) * 0.5;
              const m = bflySp.current.material as THREE.SpriteMaterial;
              m.opacity = Math.min(1, th.t / 0.6) * (th.t > 7.4 ? Math.max(0, (8 - th.t) / 0.6) : 1);
              bflySp.current.scale.setScalar(L ? 0.1 : 0.2);
              m.color.set(L ? '#ff5a5a' : '#e8b7c4');
            }
            const dx = bx - rt.current.x;
            const dz = bz - rt.current.z;
            const d = Math.hypot(dx, dz);
            if (d > 0.3) {
              const sp = (L ? 2.1 : 1.25) * dt;
              rt.current.x += (dx / d) * Math.min(sp, d);
              rt.current.z += (dz / d) * Math.min(sp, d);
              rt.current.moving = true;
              rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(dx, dz), Math.min(1, dt * 7));
              collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
            } else {
              rt.current.moving = false;
              rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(dx, dz), Math.min(1, dt * 5));
            }
            if (th.t > 8) {
              th.kind = null;
              if (bflySp.current) bflySp.current.visible = false;
              rt.current.target = null;
            }
          } else if (th.kind === 'box') {
            // —— v10 C1 钻纸箱：纸箱出现在旁边 → 钻进去窝一会儿 → 出来（箱子淡出） ——
            if (boxRef.current) {
              boxFade.current = Math.min(1, boxFade.current + dt * 2.2);
              boxRef.current.visible = boxFade.current > 0.02;
              boxRef.current.position.set(th.ax, 0, th.az);
              boxRef.current.rotation.y = th.az * 1.7;
              boxRef.current.scale.setScalar(Math.max(0.02, boxFade.current));
            }
            const dx2 = th.ax - rt.current.x;
            const dz2 = th.az - rt.current.z;
            const d2 = Math.hypot(dx2, dz2);
            if (th.t < 3.2 && d2 > 0.34) {
              rt.current.target = { x: th.ax, z: th.az };
              rt.current.route = undefined;
              rt.current.nextWander = Number.POSITIVE_INFINITY;
              roamStep(rt.current, dt, itemsRef.current, doors, ROAM_CAT.speed * 1.25);
            } else {
              rt.current.target = null;
              rt.current.moving = false;
              rt.current.x = THREE.MathUtils.damp(rt.current.x, th.ax, 5, dt);
              rt.current.z = THREE.MathUtils.damp(rt.current.z, th.az, 5, dt);
            }
            if (th.t > 9) {
              th.kind = null;
              rt.current.target = null;
              rt.current.nextWander = performance.now() / 1000 + 2.5;
            }
          } else if (th.kind === 'mirror') {
            // —— v10 C1 照镜子炸毛：凑近落地镜 → 认不出自己 → 猛地后跳 → 逃开 ——
            const dx3 = th.ax - rt.current.x;
            const dz3 = th.az - rt.current.z;
            const d3 = Math.hypot(dx3, dz3);
            if (!th.scared) {
              if (d3 > 0.5) {
                rt.current.target = { x: th.ax, z: th.az };
                rt.current.route = undefined;
                rt.current.nextWander = Number.POSITIVE_INFINITY;
                roamStep(rt.current, dt, itemsRef.current, doors, ROAM_CAT.speed);
              } else {
                rt.current.target = null;
                rt.current.moving = false;
                th.scared = true;
                hopY.current = 0.22;
                sfx.meow();
              }
            } else {
              const fx = rt.current.x - th.ax;
              const fz = rt.current.z - th.az;
              const fd = Math.max(0.001, Math.hypot(fx, fz));
              rt.current.x += (fx / fd) * 1.5 * dt;
              rt.current.z += (fz / fd) * 1.5 * dt;
              rt.current.moving = true;
              rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(fx, fz), Math.min(1, dt * 8));
              collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
            }
            if (th.t > 6.5) {
              th.kind = null;
              rt.current.target = null;
              rt.current.nextWander = performance.now() / 1000 + 3;
            }
          } else if (th.kind === 'firefly') {
            // 夜里萤火虫忽明忽暗地飘，猫蹲守着扑跳
            flySp.current.forEach((sp, i) => {
              if (!sp) return;
              sp.visible = true;
              const ph = t * 0.8 + flyBeat.current[i];
              sp.position.set(
                th.ax + Math.sin(ph) * (0.5 + i * 0.22),
                0.45 + Math.sin(ph * 1.7) * 0.1,
                th.az + Math.cos(ph * 0.9) * (0.45 + i * 0.18),
              );
              (sp.material as THREE.SpriteMaterial).opacity = Math.min(1, th.t / 0.8) * (0.72 + Math.sin(ph * 5) * 0.28);
              sp.scale.setScalar(0.12);
            });
            const dx = th.ax - rt.current.x;
            const dz = th.az - rt.current.z;
            const d = Math.hypot(dx, dz);
            if (d > 0.55) {
              const sp = 0.9 * dt;
              rt.current.x += (dx / d) * Math.min(sp, d);
              rt.current.z += (dz / d) * Math.min(sp, d);
              rt.current.moving = true;
              rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(dx, dz), Math.min(1, dt * 6));
              collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
            } else {
              rt.current.moving = false;
              rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(dx, dz), Math.min(1, dt * 5));
              th.pounced -= dt;
              if (th.pounced <= 0) {
                th.pounced = 2.6;
                hopY.current = 0.16;
                sfx.pop();
              }
            }
            if (th.t > 10) {
              th.kind = null;
              flySp.current.forEach((sp) => {
                if (sp) sp.visible = false;
              });
              rt.current.target = null;
            }
          } else {
            // —— 雨天：走到沙发/柜子旁的「屋檐下」趴一会儿 ——
            const dx = th.ax - rt.current.x;
            const dz = th.az - rt.current.z;
            const d = Math.hypot(dx, dz);
            rainRest.current = THREE.MathUtils.damp(rainRest.current, d < 0.3 ? 1 : 0, 3, dt);
            if (d > 0.28) {
              rt.current.target = { x: th.ax, z: th.az };
              rt.current.route = undefined;
              rt.current.nextWander = Number.POSITIVE_INFINITY;
              roamStep(rt.current, dt, itemsRef.current, doors, ROAM_CAT.speed);
            } else {
              rt.current.target = null;
              rt.current.moving = false;
            }
            if (th.t > 10) {
              th.kind = null;
              rt.current.target = null;
              rt.current.nextWander = performance.now() / 1000 + 2;
            }
          }
        } else {
          rainRest.current = THREE.MathUtils.damp(rainRest.current, 0, 3, dt);
          // —— v11 H1 逗宠手指：按住屏幕划动 → 追指尖（1.3×速度，距 <0.28m 停住小幅扑跳）；
  //    低于照顾/捡球/小剧场/夜晚回窝全部优先级（小剧场进行中走上面 th.kind 分支不响应指尖） ——
          const fg = petFingerRef.current;
          if (fg && Date.now() - fg.t < 2000) {
            const fdx = fg.x - rt.current.x;
            const fdz = fg.z - rt.current.z;
            const fd = Math.hypot(fdx, fdz);
            if (fd > 0.28) {
              const sp = ROAM_CAT.speed * 1.3 * dt;
              rt.current.x += (fdx / fd) * Math.min(sp, fd);
              rt.current.z += (fdz / fd) * Math.min(sp, fd);
              rt.current.moving = true;
              rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(fdx, fdz), Math.min(1, dt * 9));
              rt.current.target = null;
              rt.current.route = undefined;
              collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
            } else {
              rt.current.moving = false;
              rt.current.target = null;
              rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(fdx, fdz), Math.min(1, dt * 5));
              // 到指尖旁：小幅扑跳撒娇（偶尔应一声喵）
              fingerHopT.current -= dt;
              if (fingerHopT.current <= 0) {
                fingerHopT.current = 1.3 + Math.random() * 0.9;
                hopY.current = Math.max(hopY.current, 0.12);
                if (Math.random() < 0.3) sfx.meow();
              }
            }
            // 指尖新鲜期内暂停漫游与剧场倒计时，停更 2s 后很快恢复漫游
            rt.current.nextWander = performance.now() / 1000 + 0.35;
          } else {
          // 触发新剧场（30~60s 一次；照顾/捡球/睡觉时不打扰）
          nextTheaterAt.current -= dt;
          if (nextTheaterAt.current <= 0) {
            nextTheaterAt.current = 30 + Math.random() * 30;
            if (weatherFx === 'rain') {
              const sh = itemsRef.current.find(
                (f) => (f.kind === 'sofa' || f.kind === 'sofaLong' || f.kind === 'bookcase' || f.kind === 'sideTable') && (f.y ?? 0) < 0.45,
              );
              if (sh) {
                th.kind = 'rain';
                th.t = 0;
                const fpw = CATALOG[sh.kind]?.fp?.[0] ?? 0.6;
                th.ax = sh.x + fpw / 2 + 0.3;
                th.az = sh.z;
              }
            } else if (night) {
              th.kind = 'firefly';
              th.t = 0;
              th.pounced = 1.2;
              th.ax = rt.current.x + (Math.random() - 0.5) * 1.6;
              th.az = rt.current.z + (Math.random() - 0.5) * 1.6;
            } else {
              const roll = Math.random();
              if (roll < 0.42) {
                th.kind = 'butterfly';
                th.t = 0;
                th.ax = rt.current.x + (Math.random() - 0.5) * 1.4;
                th.az = rt.current.z + (Math.random() - 0.5) * 1.4;
              } else if (roll < 0.62) {
                // v10 C1 激光笔：红点乱窜，猫疯追
                th.kind = 'laser';
                th.t = 0;
                th.ax = rt.current.x + (Math.random() - 0.5) * 1.6;
                th.az = rt.current.z + (Math.random() - 0.5) * 1.6;
              } else if (roll < 0.8) {
                // v10 C1 钻纸箱
                th.kind = 'box';
                th.t = 0;
                th.scared = false;
                th.ax = rt.current.x + (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.4);
                th.az = rt.current.z + (Math.random() - 0.5) * 0.9;
              } else {
                // v10 C1 照镜子炸毛（家里有落地镜才演）
                const mir = itemsRef.current.find((f) => f.kind === 'standingMirror' && (f.y ?? 0) < 0.45);
                if (mir) {
                  th.kind = 'mirror';
                  th.t = 0;
                  th.scared = false;
                  const ry = mir.ry ?? 0;
                  th.ax = mir.x + Math.sin(ry) * 0.55;
                  th.az = mir.z + Math.cos(ry) * 0.55;
                }
              }
            }
          }
          // v10 C1 纸箱淡出收尾（剧场结束后缩没）
          if (!th.kind && boxRef.current) {
            boxFade.current = Math.max(0, boxFade.current - dt * 1.6);
            boxRef.current.scale.setScalar(Math.max(0.02, boxFade.current));
            if (boxFade.current <= 0.02) boxRef.current.visible = false;
          }
          // —— v10 C3 多宠社交：猫偶尔追着兄弟宠物跑（追上 = 开心跳一下冒爱心） ——
          const nowS = performance.now() / 1000;
          const sc = sibChase.current;
          if (sc) {
            const sib = PET_RT_REG.get(sc.id);
            if (!sib || nowS > sc.until) {
              sibChase.current = null;
              rt.current.target = null;
            } else {
              const dxs = sib.x - rt.current.x;
              const dzs = sib.z - rt.current.z;
              const ds = Math.hypot(dxs, dzs);
              if (ds > 0.42) {
                rt.current.target = { x: sib.x, z: sib.z };
                rt.current.route = undefined;
                rt.current.nextWander = Number.POSITIVE_INFINITY;
                roamStep(rt.current, dt, itemsRef.current, doors, ROAM_CAT.speed * 1.6);
              } else {
                rt.current.target = null;
                rt.current.moving = false;
                hopY.current = Math.max(hopY.current, 0.12);
                heartT.current = heartT.current.map((v) => (v < nowS ? nowS + 0.05 + Math.random() * 0.3 : v));
                sfx.meow();
                sibChase.current = null;
                rt.current.nextWander = nowS + 2.2;
              }
            }
          } else if (PET_RT_REG.size > 1 && Math.random() < dt * 0.025) {
            const ids = [...PET_RT_REG.keys()].filter((k) => k !== 'cat');
            if (ids.length > 0) sibChase.current = { id: ids[Math.floor(Math.random() * ids.length)], until: nowS + 5.5 };
          }
          roam(rt.current, dt, itemsRef.current, doors, ROAM_CAT);
          }
        }
      }
      // 夜晚且已在睡：安睡不动（等天亮/照顾指令唤醒）
    }
    // —— 睡觉入梦缓动（趴下缩成团 0→1） ——
    sleepEase.current = THREE.MathUtils.damp(sleepEase.current, sleeping.current ? 1 : 0, 3.2, dt);
    const se = sleeping.current || sleepEase.current > 0.02 ? sleepEase.current : 0;

    // —— v11 H2 成长体型：目标缩放随 petGrowLv（Lv1 幼年 0.62 → Lv9 成年 1.0），每帧 0.03 lerp 平滑过渡（乘算进下面的压扁/睡觉缩放，不覆盖） ——
    const growTarget = 0.62 + ((Math.min(9, Math.max(1, Math.round(petGrowLv))) - 1) / 8) * 0.38;
    grow.current = THREE.MathUtils.lerp(grow.current, growTarget, 0.03);
    const gw = grow.current;

    const mv = rt.current.moving;
    const lift = hugLift.current;
    // v8.3 打滚：侧滚一周（沿 z 翻转 2π）+ 离地小弧；转圈：原地自转
    const rolling = care.current?.kind === 'roll' || care.current?.kind === 'dead' ? trickSpin.current : 0;
    const spinning = care.current?.kind === 'spin' ? trickSpin.current : 0;
    if (se > 0.02 && !care.current) {
      // 睡觉：贴在窝中心 + 呼吸起伏（覆盖常规位置）
      g.position.set(
        rt.current.x,
        0.055 + Math.sin(t * 1.5) * 0.006 * se,
        rt.current.z,
      );
    } else {
      g.position.set(
        rt.current.x,
        (mv ? Math.abs(Math.sin(t * 11)) * 0.03 : Math.sin(t * 2.1) * 0.006) +
          lift * (0.33 + Math.sin(t * 3.1) * 0.012) +
          hopY.current +
          (rolling ? Math.abs(Math.sin(Math.min(rolling, Math.PI * 2))) * 0.055 : 0),
        rt.current.z,
      );
    }
    g.rotation.y = rt.current.heading + spinning;
    g.rotation.z = rolling;
    // v8.3 扑跳高度衰减 + 躲雨趴伏缓动
    hopY.current = Math.max(0, hopY.current - dt * 0.55);

    // —— 洗澡泡泡（bath do 阶段显示：泡泡呼吸起伏 + 肥皂光泽） ——
    if (foamGrp.current) {
      const foamy = care.current?.phase === 'do' && care.current.kind === 'bath';
      foamGrp.current.visible = foamy;
      if (foamy) {
        foamGrp.current.children.forEach((m, i) => {
          m.scale.setScalar(0.8 + Math.sin(t * 6 + i * 1.7) * 0.22);
          m.position.y = PET_FOAM[i][1] + Math.sin(t * 3 + i * 2.1) * 0.008;
          const mm = (m as THREE.Mesh).material as THREE.MeshStandardMaterial;
          mm.opacity = 0.72 + Math.sin(t * 5 + i) * 0.14;
        });
      }
    }

    // —— 碗（喂食/喂水 do 阶段显示，摆在小人与宠物之间地面） ——
    if (bowl.current) {
      const show = care.current?.phase === 'do' && (care.current.kind === 'feed' || care.current.kind === 'water');
      if (show && care.current) {
        const bx = (rt.current.x + meRT.x) / 2;
        const bz = (rt.current.z + meRT.z) / 2;
        const dir = Math.atan2(meRT.x - rt.current.x, meRT.z - rt.current.z);
        // 碗往小人方向挪 0.18m：小人手够得着、宠物低头吃得着
        bowl.current.position.set(bx + Math.sin(dir) * 0.18, 0.022 + Math.sin(Math.min(1, care.current.t * 5) * Math.PI) * 0.02, bz + Math.cos(dir) * 0.18);
        bowl.current.rotation.y = dir;
        bowl.current.visible = true;
        bowl.current.scale.setScalar(Math.min(1, care.current.t * 5) * 0.98 + 0.02);
        // 内容物随动作换色：喂食 = 猫粮棕 + 小鱼饼干；喂水 = 清水蓝
        const content = bowl.current.getObjectByName('bowl-content') as THREE.Mesh | undefined;
        const fish = bowl.current.getObjectByName('bowl-fish') as THREE.Mesh | undefined;
        if (content) (content.material as THREE.MeshStandardMaterial).color.set(care.current.kind === 'water' ? '#8ec9ea' : '#c98d5e');
        if (fish) fish.visible = care.current.kind === 'feed';
      } else {
        bowl.current.visible = false;
      }
    }

    // —— 吃/喝：低头啄食节拍（仅喂食/喂水的 do 阶段）；睡觉时头埋进身子 ——
    if (headGrp.current) {
      const eating = care.current?.phase === 'do' && (care.current.kind === 'feed' || care.current.kind === 'water');
      if (eating) {
        headGrp.current.rotation.x = Math.max(0, Math.sin(t * 7.5)) * 0.34;
        headGrp.current.position.z = 0.068 + Math.max(0, Math.sin(t * 7.5)) * 0.02;
      } else {
        headGrp.current.rotation.x = se * 0.55; // 睡觉：脑袋埋下去
        headGrp.current.position.z = 0.068 - se * 0.018;
      }
    }

    // —— 摸头余韵：压扁回弹 + 耳朵抖 + 尾巴快摇；睡觉：缩成团 + 耳朵放平 + 尾巴卷身 ——
    pat.current = Math.max(0, pat.current - dt / 0.95);
    const pp = pat.current;
    const sq = Math.sin(pp * Math.PI);
    // v7.2 被抱着：软软地窝成团（用抱起抬升做平滑过渡）
    const cs = carrying.current ? lift : 0;
    const rr = rainRest.current;
    g.scale.set(
      (1 + sq * 0.1) * (1 + se * 0.14) * (1 + cs * 0.07) * (1 + rr * 0.06) * gw,
      (1 - sq * 0.14) * (1 - se * 0.34) * (1 - cs * 0.11) * (1 - rr * 0.18) * gw,
      (1 + sq * 0.1) * (1 + se * 0.14) * (1 + cs * 0.07) * (1 + rr * 0.06) * gw,
    );
    const earBase = 0.26 * (1 - se);
    if (earL.current) earL.current.rotation.z = earBase + (pp > 0 ? Math.sin(t * 19) * 0.22 * pp : Math.sin(t * 1.8) * 0.03 * (1 - se));
    if (earR.current) earR.current.rotation.z = -earBase - (pp > 0 ? Math.sin(t * 19 + 1.2) * 0.22 * pp : Math.sin(t * 1.6 + 1) * 0.03 * (1 - se));
    if (tail.current) {
      const happy = care.current?.phase === 'do' ? 1 : 0;
      tail.current.rotation.y =
        (Math.sin(t * (mv ? 7 : 2.7)) * (mv ? 0.3 : 0.2) + sq * Math.sin(t * 15) * 0.55 + happy * Math.sin(t * 9) * 0.4) * (1 - se);
      tail.current.rotation.x = -0.55 - se * 0.6 - cs * 0.45; // 睡觉/被抱着：尾巴卷贴身侧
    }

    // —— 喵气泡 ——
    if (meowSp.current) {
      meow.current = Math.max(0, meow.current - dt);
      const m = meowSp.current.material as THREE.SpriteMaterial;
      if (meow.current > 0) {
        meowSp.current.visible = true;
        m.opacity = Math.min(1, meow.current / 0.35);
        meowSp.current.position.y = 0.56 + (1.35 - meow.current) * 0.06;
      } else {
        meowSp.current.visible = false;
      }
    }

    // —— 爱心上浮 ——
    const now = performance.now() / 1000;
    for (let i = 0; i < PET_HEART_N; i++) {
      const sp = g.children.find((c) => c.userData.petHeart === i) as THREE.Sprite | undefined;
      if (!sp) continue;
      const age = now - heartT.current[i];
      const mat = sp.material as THREE.SpriteMaterial;
      if (age > 0 && age < 1.15) {
        sp.visible = true;
        sp.position.set(Math.sin(age * 5 + i * 1.9) * 0.06 + (i - (PET_HEART_N - 1) / 2) * 0.07, 0.5 + age * 0.36, 0.16);
        mat.opacity = age < 0.14 ? age / 0.14 : 1 - (age - 0.14) / 1.01;
        sp.scale.setScalar(0.085 + Math.sin(Math.min(1, age * 3) * Math.PI) * 0.02);
      } else {
        sp.visible = false;
      }
    }

    // —— v7.1 Zzz（睡觉时循环冒泡上浮） ——
    if (zzzSp.current) {
      const on = sleeping.current && se > 0.55;
      zzzSp.current.visible = on;
      if (on) {
        zzzBeat.current = (zzzBeat.current + dt) % 2.2;
        const ph = zzzBeat.current / 2.2; // 0→1
        zzzSp.current.position.set(0.14 + ph * 0.1, 0.34 + ph * 0.3, 0.1);
        const m = zzzSp.current.material as THREE.SpriteMaterial;
        m.opacity = ph < 0.15 ? ph / 0.15 : 1 - (ph - 0.15) / 0.85;
        zzzSp.current.scale.setScalar(0.13 + ph * 0.06);
      }
    }

    // —— v7.1 需求气泡（D：体力低=饿了 / 心情低=想喝水 / 清洁低=要洗澡；睡觉/照顾中隐藏） ——
    {
      const ps = petState;
      const needs: PetNeed[] = [];
      if (ps) {
        if (ps.st < 30) needs.push('hungry');
        if (ps.mo < 30) needs.push('thirsty');
        if (ps.cl < 30) needs.push('bath');
      }
      const show = needs.length > 0 && se < 0.3 && !care.current;
      needSp.current.forEach((sp, i) => {
        if (!sp) return;
        const m = sp.material as THREE.SpriteMaterial;
        if (show && i < needs.length) {
          const tex = needTex[needs[i]];
          if (m.map !== tex) {
            m.map = tex;
            m.needsUpdate = true;
          }
          sp.visible = true;
          m.opacity = Math.min(1, m.opacity + dt * 5);
          const cnt = Math.min(needs.length, 3);
          sp.position.set((i - (cnt - 1) / 2) * 0.17, 0.6 + Math.sin(t * 2.3 + i * 1.7) * 0.016, 0.12);
        } else {
          m.opacity = Math.max(0, m.opacity - dt * 5);
          if (m.opacity <= 0) sp.visible = false;
        }
      });
    }

    // —— v7.1 小人表情联动（E：照顾时小人头顶冒爱心/星星；抱抱时双方冒笑脸） ——
    {
      const careDo = care.current?.phase === 'do' && !(carrying.current && (care.current.t ?? 0) > 3.4); // v7.2 抱着：开头庆祝 3.4s 后安静窝着
      if (careDo && emoteBeat.current <= 0) {
        emoteBeat.current = 0.55;
        // 找一个已完成上一轮的槽位发射
        const idx = emoteT.current.findIndex((v) => now - v > 1.05);
        if (idx >= 0) emoteT.current[idx] = now;
      }
      if (!careDo) emoteBeat.current = 0;
      emoteBeat.current -= dt;
      emoteSp.current.forEach((sp, i) => {
        if (!sp) return;
        const age = now - emoteT.current[i];
        const m = sp.material as THREE.SpriteMaterial;
        if (careDo && age > 0 && age < 1.05) {
          sp.visible = true;
          sp.position.set(meRT.x + (i - 1.5) * 0.075 + Math.sin(age * 5 + i) * 0.03, 1.02 + age * 0.3, meRT.z + 0.12);
          m.opacity = age < 0.12 ? age / 0.12 : 1 - (age - 0.12) / 0.93;
          sp.scale.setScalar(0.095 + Math.sin(Math.min(1, age * 3) * Math.PI) * 0.02);
        } else {
          sp.visible = false;
        }
      });
      // 抱抱：小人头顶冒大笑脸（周期 1.6s）
      const hugging = careDo && care.current?.kind === 'hug';
      if (hugging && smileT.current <= 0) smileT.current = 1.6;
      if (!hugging) smileT.current = 0;
      if (smileSp.current) {
        const age = hugging ? 1.6 - smileT.current : 99;
        const m = smileSp.current.material as THREE.SpriteMaterial;
        if (hugging && age < 1.5) {
          smileSp.current.visible = true;
          smileSp.current.position.set(meRT.x, 1.16 + age * 0.16, meRT.z + 0.1);
          m.opacity = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 1.35;
          smileSp.current.scale.setScalar(0.15 + Math.sin(Math.min(1, age * 2) * Math.PI) * 0.02);
        } else {
          smileSp.current.visible = false;
        }
      }
      if (hugging) smileT.current -= dt;
    }
  });

  const coatC = PET_COATS[petCoat] ?? PET_COATS.cream;
  const isCow = petCoat === 'cow';

  return (
    <>
    <group ref={root} position={[-1.4, 0, 1.5]}>
      {/* 身体（面包团；v8.3 毛色可选） */}
      <mesh castShadow position={[0, 0.135, -0.012]} scale={[1, 0.8, 1.22]}>
        <sphereGeometry args={[0.135, 18, 14]} />
        <meshStandardMaterial color={coatC.body} roughness={0.86} />
      </mesh>
      {/* v8.3 奶牛斑（coat=cow 时显示的三块深灰斑） */}
      {isCow && (
        <>
          <mesh position={[-0.07, 0.17, -0.03]} scale={[1, 0.72, 1.3]}>
            <sphereGeometry args={[0.052, 10, 8]} />
            <meshStandardMaterial color="#3f3f44" roughness={0.9} />
          </mesh>
          <mesh position={[0.075, 0.1, 0.05]} scale={[0.9, 0.6, 1.2]}>
            <sphereGeometry args={[0.046, 10, 8]} />
            <meshStandardMaterial color="#3f3f44" roughness={0.9} />
          </mesh>
          <mesh position={[0.03, 0.24, 0.02]} scale={[1.2, 0.5, 0.9]}>
            <sphereGeometry args={[0.04, 10, 8]} />
            <meshStandardMaterial color="#3f3f44" roughness={0.9} />
          </mesh>
        </>
      )}
      {/* 头（低头啄食节拍用 group 包裹） */}
      <group ref={headGrp} position={[0, 0.272, 0.068]}>
        <mesh castShadow position={[0, 0, 0]}>
          <sphereGeometry args={[0.118, 20, 16]} />
          <meshStandardMaterial color={coatC.head} roughness={0.86} />
        </mesh>
      {/* 耳朵（外耳 + 粉内耳） */}
      <group ref={earL} position={[-0.063, 0.103, -0.018]} rotation={[-0.1, 0, 0.26]}>
        <mesh castShadow>
          <coneGeometry args={[0.038, 0.064, 10]} />
          <meshStandardMaterial color={coatC.head} roughness={0.86} />
        </mesh>
        <mesh position={[0, -0.006, 0.014]} scale={[0.58, 0.62, 0.5]}>
          <coneGeometry args={[0.038, 0.064, 10]} />
          <meshStandardMaterial color="#f6c2ca" roughness={0.8} />
        </mesh>
      </group>
      <group ref={earR} position={[0.063, 0.103, -0.018]} rotation={[-0.1, 0, -0.26]}>
        <mesh castShadow>
          <coneGeometry args={[0.038, 0.064, 10]} />
          <meshStandardMaterial color={coatC.head} roughness={0.86} />
        </mesh>
        <mesh position={[0, -0.006, 0.014]} scale={[0.58, 0.62, 0.5]}>
          <coneGeometry args={[0.038, 0.064, 10]} />
          <meshStandardMaterial color="#f6c2ca" roughness={0.8} />
        </mesh>
      </group>
      {/* 黑豆眼 + 高光 */}
      {[-1, 1].map((sx) => (
        <group key={sx} position={[0.046 * sx, 0.014, 0.104]}>
          <mesh>
            <sphereGeometry args={[0.0145, 10, 8]} />
            <meshStandardMaterial color="#3a3230" roughness={0.25} />
          </mesh>
          <mesh position={[0.004 * sx, 0.005, 0.01]}>
            <sphereGeometry args={[0.005, 8, 6]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      ))}
      {/* 粉鼻子 + 腮红 */}
      <mesh position={[0, -0.016, 0.114]}>
        <sphereGeometry args={[0.009, 8, 8]} />
        <meshStandardMaterial color="#e89aa4" roughness={0.5} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[0.077 * sx, -0.022, 0.084]} scale={[1, 0.62, 0.4]}>
          <sphereGeometry args={[0.014, 8, 8]} />
          <meshBasicMaterial color="#f6bfc6" transparent opacity={0.75} />
        </mesh>
      ))}
      {/* 胡须 */}
      {[
        [-1, 0.012],
        [-1, -0.012],
        [1, 0.012],
        [1, -0.012],
      ].map(([sx, dy], i) => (
        <mesh key={i} position={[0.098 * sx, -0.02 + dy, 0.087]} rotation={[0, sx * 0.25, sx * (1.42 + dy * 4)]}>
          <cylinderGeometry args={[0.0016, 0.0016, 0.055, 5]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
        </mesh>
      ))}
      </group>
      {/* 四只小爪（右前爪 ref：握手把戏抬爪用） */}
      {[
        [-0.062, 0.115],
        [0.062, 0.115],
        [-0.068, -0.075],
        [0.068, -0.075],
      ].map(([px, pz], i) => (
        <mesh key={i} ref={i === 1 ? pawFR : undefined} castShadow position={[px, 0.033, pz]} rotation={[0, 0, 0]}>
          <sphereGeometry args={[0.034, 10, 8]} />
          <meshStandardMaterial color={coatC.head} roughness={0.86} />
        </mesh>
      ))}
      {/* 尾巴（摆动） */}
      <group ref={tail} position={[0, 0.13, -0.16]} rotation={[-0.55, 0, 0]}>
        <mesh castShadow position={[0, 0.062, 0]} rotation={[0.42, 0, 0]}>
          <capsuleGeometry args={[0.02, 0.115, 6, 10]} />
          <meshStandardMaterial color={coatC.body} roughness={0.86} />
        </mesh>
        <mesh position={[0, 0.128, 0.045]}>
          <sphereGeometry args={[0.023, 10, 8]} />
          <meshStandardMaterial color={coatC.tail} roughness={0.86} />
        </mesh>
      </group>
      {/* 项圈（颜色自选）+ 金铃铛 */}
      <mesh position={[0, 0.206, 0.088]} rotation={[1.22, 0, 0]}>
        <torusGeometry args={[0.076, 0.0105, 8, 18]} />
        <meshStandardMaterial color={petWear?.collar ?? '#e46a6a'} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.182, 0.155]}>
        <sphereGeometry args={[0.016, 10, 8]} />
        <meshStandardMaterial color="#f4c34e" roughness={0.3} metalness={0.55} />
      </mesh>
      {/* v8.3 小围巾（戴上时显示：脖圈 + 垂下的小巾角） */}
      {petWear?.scarf && (
        <>
          <mesh position={[0, 0.178, 0.07]} rotation={[1.3, 0, 0]}>
            <torusGeometry args={[0.072, 0.014, 8, 18]} />
            <meshStandardMaterial color={petWear.scarf} roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.132, 0.128]} rotation={[0.28, 0, 0.12]}>
            <capsuleGeometry args={[0.013, 0.05, 4, 8]} />
            <meshStandardMaterial color={petWear.scarf} roughness={0.85} />
          </mesh>
        </>
      )}
      {/* v8.3 蝴蝶结（戴上时别在左耳根） */}
      {petWear?.bow && (
        <group position={[-0.072, 0.196, 0.028]} rotation={[0.2, 0, 0.5]}>
          <mesh rotation={[0, 0, 0.6]} scale={[1, 0.62, 0.6]}>
            <sphereGeometry args={[0.022, 10, 8]} />
            <meshStandardMaterial color={petWear.bow} roughness={0.6} />
          </mesh>
          <mesh position={[0.026, 0.012, 0]} rotation={[0, 0, -0.6]} scale={[1, 0.62, 0.6]}>
            <sphereGeometry args={[0.022, 10, 8]} />
            <meshStandardMaterial color={petWear.bow} roughness={0.6} />
          </mesh>
          <mesh scale={[0.55, 0.55, 0.55]}>
            <sphereGeometry args={[0.014, 8, 8]} />
            <meshStandardMaterial color={petWear.bow} roughness={0.55} />
          </mesh>
        </group>
      )}
      {/* 摸头爱心（上浮粒子） */}
      {Array.from({ length: PET_HEART_N }, (_, i) => (
        <sprite key={i} material={heartMats[i]} visible={false} userData={{ petHeart: i }} />
      ))}
      {/* 喵~ 气泡 */}
      <sprite ref={meowSp} position={[0.18, 0.56, 0.05]} scale={[0.2, 0.15, 1]} visible={false}>
        <spriteMaterial map={meowTex} transparent depthWrite={false} />
      </sprite>
      {/* v7.1 Zzz（睡觉时循环上浮） */}
      <sprite ref={zzzSp} position={[0.14, 0.34, 0.1]} scale={[0.13, 0.1, 1]} visible={false}>
        <spriteMaterial map={zzzTex} transparent depthWrite={false} />
      </sprite>
      {/* v7.1 需求气泡（饿了/想喝水/要洗澡；材质 map 运行时切换） */}
      {(['hungry', 'thirsty', 'bath'] as PetNeed[]).map((k, i) => (
        <sprite
          key={k}
          ref={(el) => {
            needSp.current[i] = el;
          }}
          position={[0, 0.6, 0.12]}
          scale={[0.165, 0.13, 1]}
          visible={false}
        >
          <spriteMaterial map={needTex[k]} transparent depthWrite={false} opacity={0} />
        </sprite>
      ))}
      {/* 洗澡泡泡（bath do 阶段显示，肥皂光泽） */}
      <group ref={foamGrp} visible={false}>
        {PET_FOAM.map(([fx, fy, fz, fr], i) => (
          <mesh key={i} position={[fx, fy, fz]}>
            <sphereGeometry args={[fr, 10, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={0.25} transparent opacity={0.8} depthWrite={false} />
          </mesh>
        ))}
      </group>
      {/* 点击热区（透明大球，盖住猫全身 + 富余，走动中也容易点中） */}
      <mesh position={[0, 0.22, 0.02]} onPointerDown={onDown}>
        <sphereGeometry args={[0.42, 12, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
    {/* 喂食/喂水的碗（世界坐标，摆在小人与宠物之间） */}
    <group ref={bowl} visible={false}>
      <mesh castShadow position={[0, 0.012, 0]}>
        <cylinderGeometry args={[0.075, 0.058, 0.044, 16]} />
        <meshStandardMaterial color="#f2a9b8" roughness={0.5} />
      </mesh>
      {/* 内容物（food 棕色粮 / water 蓝色水，运行时换色） */}
      <mesh position={[0, 0.034, 0]} name="bowl-content">
        <cylinderGeometry args={[0.058, 0.05, 0.014, 16]} />
        <meshStandardMaterial color="#c98d5e" roughness={0.7} />
      </mesh>
      {/* 小鱼饼干（喂食时的点缀） */}
      <mesh position={[0.02, 0.045, 0.01]} rotation={[0, 0.5, 0]} name="bowl-fish">
        <capsuleGeometry args={[0.012, 0.03, 4, 8]} />
        <meshStandardMaterial color="#e8b45c" roughness={0.6} />
      </mesh>
    </group>
    {/* v7.1 小人头顶表情粒子（世界坐标跟随 meRT：照顾时爱心/星星，抱抱时大笑脸） */}
    {emoteMats.map((m, i) => (
      <sprite
        key={`em-${i}`}
        material={m}
        visible={false}
        ref={(el) => {
          emoteSp.current[i] = el;
        }}
      />
    ))}
    <sprite
      ref={smileSp}
      material={smileMat}
      visible={false}
    />
    {/* v8.3 玩具球（扔出 → 猫追着叼回来；粉白双色小球） */}
    <group ref={ballGrp} visible={false}>
      <mesh castShadow>
        <sphereGeometry args={[0.055, 14, 12]} />
        <meshStandardMaterial color="#fdfdfb" roughness={0.4} />
      </mesh>
      <mesh rotation={[0.4, 0, 0.9]}>
        <torusGeometry args={[0.054, 0.012, 8, 20]} />
        <meshStandardMaterial color="#f2a9b8" roughness={0.45} />
      </mesh>
    </group>
    {/* v8.3 小剧场精灵：蝴蝶（白天追）/ 萤火虫 ×3（夜里扑） */}
    <sprite ref={bflySp} material={bflyMat} visible={false} />
    {/* v10 C1 钻纸箱小剧场：临时纸箱（出现/淡出由剧场驱动） */}
    <group ref={boxRef} visible={false}>
      <mesh castShadow>
        <boxGeometry args={[0.52, 0.4, 0.46]} />
        <meshStandardMaterial color="#d9b98a" roughness={0.95} transparent opacity={0.97} />
      </mesh>
      <mesh position={[0, 0.21, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.4, 0.36]} />
        <meshBasicMaterial color="#8a6b4a" transparent opacity={0.55} depthWrite={false} />
      </mesh>
    </group>
    {[0, 1, 2].map((i) => (
      <sprite
        key={`fly-${i}`}
        material={flyMats[i]}
        visible={false}
        ref={(el) => {
          flySp.current[i] = el;
        }}
      />
    ))}
    </>
  );
}

// ---------------- v8.3 第二只宠物（C 选项：小狗 / 小兔子；追着第一只猫玩 + 摸摸反应 + 夜里蜷窝边睡） ----------------

function PetBuddy2({
  mode,
  items,
  night,
  buddy,
  petId,
  meRT,
  catRTRef,
  doorRef,
  petCmdRef,
  petCarryCmdRef,
  petBallCmdRef,
  onCareEvent,
  onPetTap,
  petGrowLv = 1,
}: {
  mode: HomeMode;
  items: FurnitureItem[];
  night?: boolean;
  buddy: Pet2State;
  /** v9 宠物 id（'p2:<i>'；照顾指令/事件都带它路由到对应宠物状态） */
  petId: string;
  meRT: CharRT;
  /** 第一只猫的运行时 ref（追着玩用；每帧 PetBuddy 写入） */
  catRTRef?: RefObject<CharRT | null>;
  doorRef?: RefObject<{ bed: DoorLive; kt: DoorLive; bath: DoorLive; bal?: DoorLive; sr?: DoorLive; yd?: DoorLive }>;
  /** v9 照顾指令（target 路由：只有 target === petId 的指令本实例才接） */
  petCmdRef?: RefObject<{ kind: PetCareKind; seq: number; carry?: boolean; target?: string } | null>;
  petCarryCmdRef?: RefObject<{ on: boolean; seq: number; target?: string }>;
  petBallCmdRef?: RefObject<{ seq: number; target?: string }>;
  /** 照顾事件（arrive/done/cancel/dropped；宿主按 petId 结算对应宠物状态） */
  onCareEvent?: (ev: 'arrive' | 'done' | 'cancel' | 'dropped', kind: PetCareKind, petId: string) => void;
  /** 点到它（宿主：把互动竖条切到这只） */
  onPetTap?: (petId: string) => void;
  /** v11 成长等级 1~9（体型缩放 0.62→1.0，与第一只猫共享同一等级） */
  petGrowLv?: number;
}) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const isDog = buddy.kind === 'dog';
  const rt = useRef<CharRT>({ x: 1.2 + Math.random() * 0.6, z: 2.6 + Math.random() * 0.6, heading: 1.2, moving: false, target: null, nextWander: 0 });
  const root = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group | THREE.Mesh>(null);
  /** 追猫玩剩余时间 / 下次发起时刻 */
  const chaseT = useRef(0);
  const nextChaseAt = useRef(9 + Math.random() * 8);
  /** 摸摸余韵 / 开心跳 / 爱心 */
  const pat = useRef(0);
  const hopY = useRef(0);
  const heartSp = useRef<THREE.Sprite>(null);
  const heartT = useRef(-10);
  const heartTex = useMemo(() => makeHeartTexture(), []);
  const heartMat = useMemo(
    () => new THREE.SpriteMaterial({ map: heartTex, transparent: true, opacity: 0, depthWrite: false }),
    [heartTex],
  );
  /** 夜晚蜷在猫窝边睡觉 */
  const sleeping = useRef(false);
  const zzzEase = useRef(0);
  // —— v9 全功能照顾引擎（与团子同权）：care 走位/互动 + 抱起跟随 + 扔球捡球 + 把戏 ——
  /** 照顾中的动作（phase: walk 走向小人 / do 就位互动；carry=true 抱起模式） */
  const care = useRef<{ kind: PetCareKind; phase: 'walk' | 'do'; t: number; carry?: boolean } | null>(null);
  const lastSeq = useRef(-1);
  const carrying = useRef(false);
  const lastCarrySeq = useRef(0);
  /** 抱起抬升缓动（0→1） */
  const hugLift = useRef(0);
  /** 把戏累计角度（转圈 4π / 打滚 2π）+ 握手摆动相位 */
  const trickSpin = useRef(0);
  const trickShake = useRef(0);
  /** 扔球状态机 */
  const ballGrp = useRef<THREE.Group>(null);
  const ball = useRef<{ phase: 'hidden' | 'fly' | 'rest' | 'carried'; t: number; from: Pt; to: Pt; bounce: number }>({
    phase: 'hidden',
    t: 0,
    from: { x: 0, z: 0 },
    to: { x: 0, z: 0 },
    bounce: 0,
  });
  const lastBallSeq = useRef(0);
  const fetching = useRef<'chase' | 'return' | null>(null);
  /** 摸它时的小音效（狗汪汪 / 兔子噔噔） */
  const sndHappy = useCallback(() => {
    if (isDog) sfx.bark();
    else sfx.boing();
  }, [isDog]);
  // —— v11 H1 逗宠手指：0~400ms 随机延迟（多宠错开更自然）+ 到位后扑跳节拍 ——
  const fingerDelay = useRef(Math.random() * 400);
  const fingerHopT2 = useRef(0);
  // —— v11 H2 成长体型（与第一只猫共享同一 petGrowLv） ——
  const grow = useRef(0.62 + ((Math.min(9, Math.max(1, petGrowLv)) - 1) / 8) * 0.38);

  /** 结束照顾（done=正常完成，cancel=中断） */
  const endCare = useCallback(
    (done: boolean) => {
      const k = care.current?.kind;
      care.current = null;
      carrying.current = false;
      trickSpin.current = 0;
      trickShake.current = 0;
      if (k) onCareEvent?.(done ? 'done' : 'cancel', k, petId);
      rt.current.nextWander = performance.now() / 1000 + 1.2;
    },
    [onCareEvent, petId],
  );

  /** v9 扔球：从主人手上抛物线飞到同房间随机点（推出家具/钳回房间），随后它自动去捡 */
  const throwBall = useCallback(() => {
    const dr = doorRef?.current;
    const doors = {
      bed: dr?.bed ?? CLOSED_DOOR,
      kt: dr?.kt ?? CLOSED_DOOR,
      bath: dr?.bath ?? CLOSED_DOOR,
      bal: dr?.bal ?? CLOSED_DOOR,
      sr: dr?.sr ?? CLOSED_DOOR,
      yd: dr?.yd ?? CLOSED_DOOR,
    };
    const ang = Math.random() * Math.PI * 2;
    const dist = 1.1 + Math.random() * 1.3;
    const probe: CharRT = {
      x: meRT.x + Math.sin(ang) * dist,
      z: meRT.z + Math.cos(ang) * dist,
      heading: 0,
      moving: false,
      target: null,
      nextWander: 0,
    };
    collideAndClamp(probe, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
    ball.current = { phase: 'fly', t: 0, from: { x: meRT.x, z: meRT.z }, to: { x: probe.x, z: probe.z }, bounce: 0 };
    fetching.current = null;
    if (sleeping.current) {
      sleeping.current = false;
      rt.current.target = null;
      rt.current.nextWander = performance.now() / 1000 + 4;
    }
    sfx.whoosh();
  }, [meRT, doorRef]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    const g = root.current;
    if (!g) return;
    if (modeRef.current !== 'live') {
      g.visible = false;
      return;
    }
    g.visible = true;
    const dr = doorRef?.current;
    const doors = {
      bed: dr?.bed ?? CLOSED_DOOR,
      kt: dr?.kt ?? CLOSED_DOOR,
      bath: dr?.bath ?? CLOSED_DOOR,
      bal: dr?.bal ?? CLOSED_DOOR,
      sr: dr?.sr ?? CLOSED_DOOR,
      yd: dr?.yd ?? CLOSED_DOOR,
    };

    // —— 捕获新照顾指令（target 路由：只接自己的） ——
    const cmd = petCmdRef?.current;
    if (cmd && cmd.seq !== lastSeq.current && (!cmd.target || cmd.target === petId)) {
      lastSeq.current = cmd.seq;
      if (!care.current) {
        care.current = { kind: cmd.kind, phase: 'walk', t: 0, carry: cmd.carry };
        if (cmd.kind === 'summon') sfx.whistle();
        if (sleeping.current) {
          sleeping.current = false;
          rt.current.target = null;
          rt.current.nextWander = performance.now() / 1000 + 4;
        }
      }
    }
    // —— 放下指令（抱着时收到 on=false → 轻轻放到小人面前） ——
    const cc = petCarryCmdRef?.current;
    if (cc && !cc.on && cc.seq !== lastCarrySeq.current && (!cc.target || cc.target === petId)) {
      lastCarrySeq.current = cc.seq;
      if (care.current?.carry) {
        if (carrying.current) {
          carrying.current = false;
          const hd = meRT.heading;
          rt.current.x = meRT.x + Math.sin(hd) * 0.42;
          rt.current.z = meRT.z + Math.cos(hd) * 0.42;
          rt.current.moving = false;
          rt.current.target = null;
          collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
          pat.current = 0.85;
          sndHappy();
          heartT.current = performance.now() / 1000;
          rt.current.nextWander = performance.now() / 1000 + 1.6;
        }
        care.current = null;
        onCareEvent?.('dropped', 'hug', petId);
      }
    }
    // —— 扔球指令（seq 变化 = 扔一次；只接自己的；照顾中/被抱着时不接） ——
    const bc = petBallCmdRef?.current;
    if (bc && bc.seq !== lastBallSeq.current && (!bc.target || bc.target === petId)) {
      lastBallSeq.current = bc.seq;
      if (!care.current && !carrying.current) throwBall();
    }

    // —— 球物理（抛物线 → 落地轻弹 → 等它来叼；叼着时贴在嘴前） ——
    if (ballGrp.current) {
      const b = ball.current;
      if (b.phase === 'fly') {
        b.t += dt / 0.85;
        if (b.t >= 1) {
          b.t = 0;
          b.phase = 'rest';
          b.bounce = 2;
          if (!fetching.current && !care.current && !carrying.current && modeRef.current === 'live') {
            fetching.current = 'chase';
          }
        }
      } else if (b.phase === 'rest' && b.bounce > 0) {
        b.t += dt;
        if (b.t > 0.34) {
          b.t = 0;
          b.bounce -= 1;
        }
      }
      const bg = ballGrp.current;
      if (b.phase === 'hidden') {
        bg.visible = false;
      } else if (b.phase === 'fly') {
        bg.visible = true;
        const k = Math.min(1, b.t);
        bg.position.set(
          THREE.MathUtils.lerp(b.from.x, b.to.x, k),
          0.055 + Math.sin(Math.PI * k) * 0.72,
          THREE.MathUtils.lerp(b.from.z, b.to.z, k),
        );
        bg.rotation.z -= dt * 13;
        bg.rotation.x += dt * 5;
      } else if (b.phase === 'carried') {
        bg.visible = true;
        bg.position.set(rt.current.x + Math.sin(rt.current.heading) * 0.17, 0.13, rt.current.z + Math.cos(rt.current.heading) * 0.17);
        bg.rotation.z += dt * 2;
      } else {
        bg.visible = true;
        const hop = b.bounce > 0 ? Math.sin(Math.PI * Math.min(1, b.t / 0.34)) * 0.09 * b.bounce : 0;
        bg.position.set(b.to.x, 0.055 + hop, b.to.z);
      }
    }

    // —— 漫游 / 照顾移动 / 夜睡 ——
    const c = care.current;
    const nightNow = !!night && !!itemsRef.current.find((f) => f.kind === 'petBed' && (f.y ?? 0) < 0.45);
    if (c) {
      const cx = meRT.x;
      const cz = meRT.z;
      const dx = cx - rt.current.x;
      const dz = cz - rt.current.z;
      const d = Math.hypot(dx, dz);
      if (c.phase === 'walk') {
        c.t += dt;
        if (d > 0.34 && c.t < 9) {
          const sp = petWalkSpeed(c.kind) * dt;
          rt.current.x += (dx / d) * Math.min(sp, d);
          rt.current.z += (dz / d) * Math.min(sp, d);
          rt.current.moving = true;
          rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(dx, dz), Math.min(1, dt * 8));
          rt.current.target = null;
          collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
        } else {
          // 9s 超时兜底：被卡住直接放到小人身边（照顾一定能完成）
          if (d > 0.5) {
            const inv = 1 / Math.max(0.001, d);
            rt.current.x = cx - dx * inv * 0.45;
            rt.current.z = cz - dz * inv * 0.45;
          }
          rt.current.moving = false;
          c.phase = 'do';
          c.t = 0;
          if (c.kind === 'pat' || c.kind === 'summon' || c.kind === 'hug') {
            pat.current = 1;
            hopY.current = 0.12;
            sndHappy();
            if (c.kind === 'hug') sfx.kiss();
          } else {
            sndHappy();
          }
          heartT.current = performance.now() / 1000;
          onCareEvent?.('arrive', c.kind, petId);
        }
      } else {
        // —— do 阶段：面对面互动 ——
        rt.current.moving = false;
        if (c.kind === 'hug') {
          const hd = meRT.heading;
          const off = c.carry ? 0.27 : 0.16;
          const k = Math.min(1, dt * (c.carry ? 10 : 8));
          rt.current.x = THREE.MathUtils.lerp(rt.current.x, meRT.x + Math.sin(hd) * off, k);
          rt.current.z = THREE.MathUtils.lerp(rt.current.z, meRT.z + Math.cos(hd) * off, k);
          rt.current.heading = lerpAngle(rt.current.heading, hd, k);
          hugLift.current = Math.min(1, hugLift.current + dt * 2.6);
          if (c.carry) carrying.current = true;
          if (c.t % 1.1 < dt && (!c.carry || c.t < 3.2)) heartT.current = performance.now() / 1000;
        } else {
          hugLift.current = Math.max(0, hugLift.current - dt * 4);
          rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(-dx, -dz), Math.min(1, dt * 6));
          meRT.heading = lerpAngle(meRT.heading, Math.atan2(rt.current.x - meRT.x, rt.current.z - meRT.z), Math.min(1, dt * 6));
        }
        // 互动节拍音效
        if (c.kind === 'feed' && c.t % 0.55 < dt) sfx.crunch();
        else if (c.kind === 'water' && c.t % 0.7 < dt) sfx.sip();
        else if (c.kind === 'bath' && c.t % 2.4 < dt) sfx.bathWater();
        c.t += dt;
        // —— 成长把戏：握手（小跳 + 摆头）/ 转圈（原地转两圈）/ 打滚（侧滚一周） ——
        if (c.kind === 'shake') {
          trickShake.current = Math.sin(c.t * 9) * 0.24;
          if (c.t % 0.5 < dt) hopY.current = 0.09;
        } else if (c.kind === 'spin') {
          trickSpin.current += dt * ((Math.PI * 4) / PET_CARE_DUR.spin);
        } else if (c.kind === 'roll') {
          trickSpin.current += dt * ((Math.PI * 2) / PET_CARE_DUR.roll);
        }
        if (c.kind !== 'hug' && Math.hypot(meRT.x - rt.current.x, meRT.z - rt.current.z) > 0.75) {
          endCare(false);
        } else if (!c.carry && c.t >= PET_CARE_DUR[c.kind]) {
          endCare(true);
        }
      }
    } else if (fetching.current) {
      // —— 捡球任务：追球 → 叼住 → 送回主人脚边 ——
      sleeping.current = false;
      const b = ball.current;
      const tx = b.phase === 'carried' ? meRT.x : b.to.x;
      const tz = b.phase === 'carried' ? meRT.z : b.to.z;
      const dx = tx - rt.current.x;
      const dz = tz - rt.current.z;
      const d = Math.hypot(dx, dz);
      if (fetching.current === 'chase' && b.phase === 'rest' && d < 0.26) {
        b.phase = 'carried';
        fetching.current = 'return';
        sfx.pop();
      } else if (fetching.current === 'return' && d < 0.6) {
        const hd = meRT.heading;
        b.phase = 'rest';
        b.to = { x: meRT.x + Math.sin(hd) * 0.42, z: meRT.z + Math.cos(hd) * 0.42 };
        b.t = 0;
        b.bounce = 0;
        fetching.current = null;
        rt.current.target = null;
        rt.current.moving = false;
        pat.current = 0.85;
        sndHappy();
        heartT.current = performance.now() / 1000;
        rt.current.nextWander = performance.now() / 1000 + 2;
        onCareEvent?.('done', 'ball', petId);
      } else if (d > 0.02) {
        const sp = (fetching.current === 'chase' ? 2.0 : 1.8) * dt;
        rt.current.x += (dx / d) * Math.min(sp, d);
        rt.current.z += (dz / d) * Math.min(sp, d);
        rt.current.moving = true;
        rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(dx, dz), Math.min(1, dt * 9));
        rt.current.target = null;
        collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
      } else {
        rt.current.moving = false;
      }
    } else if (nightNow && !carrying.current) {
      // 夜晚：蜷在猫窝边睡（无窝就地睡）
      if (!sleeping.current) {
        sleeping.current = true;
        rt.current.moving = false;
        rt.current.target = null;
        const bed = itemsRef.current.find((f) => f.kind === 'petBed' && (f.y ?? 0) < 0.45);
        if (bed) {
          rt.current.x = bed.x + 0.42 + (rt.current.x % 0.1);
          rt.current.z = bed.z + 0.2;
          collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
        }
      }
    } else {
      if (sleeping.current) {
        sleeping.current = false;
        rt.current.nextWander = performance.now() / 1000 + 1.5;
      }
      // —— v11 H1 逗宠手指：同样追指尖（带 0~400ms 随机延迟更自然）；照顾/捡球/夜晚回窝优先 ——
      const fg = petFingerRef.current;
      const fAge = fg ? Date.now() - fg.t - fingerDelay.current : Number.POSITIVE_INFINITY;
      if (fg && fAge >= 0 && fAge < 2000) {
        const fdx = fg.x - rt.current.x;
        const fdz = fg.z - rt.current.z;
        const fd = Math.hypot(fdx, fdz);
        if (fd > 0.28) {
          const sp = ROAM_CAT.speed * 1.3 * dt;
          rt.current.x += (fdx / fd) * Math.min(sp, fd);
          rt.current.z += (fdz / fd) * Math.min(sp, fd);
          rt.current.moving = true;
          rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(fdx, fdz), Math.min(1, dt * 9));
          rt.current.target = null;
          rt.current.route = undefined;
          collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
        } else {
          rt.current.moving = false;
          rt.current.target = null;
          rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(fdx, fdz), Math.min(1, dt * 5));
          fingerHopT2.current -= dt;
          if (fingerHopT2.current <= 0) {
            fingerHopT2.current = 1.5 + Math.random() * 1.1;
            hopY.current = Math.max(hopY.current, 0.1);
            if (Math.random() < 0.2) sndHappy();
          }
        }
        rt.current.nextWander = performance.now() / 1000 + 0.35;
        nextChaseAt.current = Math.max(nextChaseAt.current, 3);
      } else {
      // 追猫玩（每 9~17s 一次 3.5s 追追）
      const cat = catRTRef?.current ?? null;
      nextChaseAt.current -= dt;
      if (chaseT.current > 0 && cat) {
        chaseT.current -= dt;
        const dx = cat.x - rt.current.x;
        const dz = cat.z - rt.current.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.42) {
          const sp = 1.5 * dt;
          rt.current.x += (dx / d) * Math.min(sp, d);
          rt.current.z += (dz / d) * Math.min(sp, d);
          rt.current.moving = true;
          rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(dx, dz), Math.min(1, dt * 9));
          collideAndClamp(rt.current, itemsRef.current, doors.bed, doors.kt, doors.bath, doors.bal, doors.sr, doors.yd);
        } else {
          rt.current.moving = false;
          rt.current.heading = lerpAngle(rt.current.heading, Math.atan2(dx, dz), Math.min(1, dt * 6));
        }
      } else {
        chaseT.current = 0;
        if (nextChaseAt.current <= 0 && cat) {
          nextChaseAt.current = 9 + Math.random() * 8;
          chaseT.current = 3.5;
        }
        roam(rt.current, dt, itemsRef.current, doors, ROAM_CAT);
      }
      }
    }
    zzzEase.current = THREE.MathUtils.damp(zzzEase.current, sleeping.current ? 1 : 0, 3, dt);
    // —— v11 H2 成长体型：与第一只猫同一 petGrowLv，每帧 0.03 lerp 平滑过渡（乘算进压扁/睡觉缩放） ——
    const growTarget2 = 0.62 + ((Math.min(9, Math.max(1, Math.round(petGrowLv))) - 1) / 8) * 0.38;
    grow.current = THREE.MathUtils.lerp(grow.current, growTarget2, 0.03);
    const gw2 = grow.current;
    const se2 = zzzEase.current;
    pat.current = Math.max(0, pat.current - dt / 0.9);
    const pp = pat.current;
    hopY.current = Math.max(0, hopY.current - dt * 0.7);
    const mv = rt.current.moving;
    const hopAmp = isDog ? 0.022 : 0.05;
    // 被抱着：贴在怀里抬到胸口；否则地面 + 走路小跳
    const carryY = carrying.current ? 0.34 + hugLift.current * 0.14 : 0;
    g.position.set(
      rt.current.x,
      (mv ? Math.abs(Math.sin(t * (isDog ? 10 : 8))) * hopAmp : Math.sin(t * 2) * 0.005) + hopY.current + se2 * 0.02 + carryY,
      rt.current.z,
    );
    // 把戏姿态：转圈/打滚累计角 + 握手小侧倾
    g.rotation.y = rt.current.heading + trickSpin.current;
    g.rotation.z = c?.kind === 'roll' ? trickSpin.current : trickShake.current;
    const sq = Math.sin(pp * Math.PI);
    const squash = c?.kind === 'roll' ? 1 : 0;
    g.scale.set(
      (1 + sq * 0.1) * (1 + se2 * 0.12) * (1 + squash * 0.06) * gw2,
      (1 - sq * 0.14) * (1 - se2 * 0.3) * (1 - squash * 0.22) * gw2,
      (1 + sq * 0.1) * (1 + se2 * 0.12) * (1 + squash * 0.06) * gw2,
    );
    if (tail.current) tail.current.rotation.z = Math.sin(t * (mv ? 13 : 5)) * 0.4 * (1 - se2);
    // 摸摸爱心
    if (heartSp.current) {
      const age = t - heartT.current;
      const m = heartSp.current.material as THREE.SpriteMaterial;
      if (age > 0 && age < 1.1) {
        heartSp.current.visible = true;
        heartSp.current.position.set(0.02, 0.52 + age * 0.3, 0.12);
        m.opacity = Math.min(age / 0.12, 1) * (1 - (age - 0.12) / 0.98);
        heartSp.current.scale.setScalar(0.1);
      } else {
        heartSp.current.visible = false;
      }
    }
  });

  const onDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (modeRef.current !== 'live') return;
      pat.current = 1;
      hopY.current = 0.14;
      heartT.current = performance.now() / 1000;
      sndHappy();
      onPetTap?.(petId);
    },
    [sndHappy, onPetTap, petId],
  );

  // v9 毛色（调色盘任意色）/ 装扮（项圈/围巾/蝴蝶结）——与团子同权
  const body = typeof buddy.coat === 'string' && buddy.coat.startsWith('#') ? buddy.coat : isDog ? '#e8d3ae' : '#f8f6f2';
  const shade = (hex: string, f: number) => {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
    const gg = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
    const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
    return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0')}`;
  };
  const body2 = shade(body, 0.88);
  const earC = isDog ? shade(body, 0.72) : '#f3c9d4';
  const collarC = buddy.wear?.collar ?? '#e46a6a';
  return (
    <group ref={root} position={[rt.current.x, 0, rt.current.z]}>
      {/* 身体 */}
      <mesh castShadow position={[0, 0.13, -0.02]} scale={[1, 0.82, 1.24]}>
        <sphereGeometry args={[0.125, 18, 14]} />
        <meshStandardMaterial color={body} roughness={0.88} />
      </mesh>
      {/* 头 */}
      <group position={[0, 0.26, 0.075]}>
        <mesh castShadow>
          <sphereGeometry args={[0.105, 18, 14]} />
          <meshStandardMaterial color={body} roughness={0.88} />
        </mesh>
        {isDog ? (
          <>
            {/* 吻部 + 黑鼻头 */}
            <mesh position={[0, -0.02, 0.09]} scale={[1, 0.8, 0.9]}>
              <sphereGeometry args={[0.05, 12, 10]} />
              <meshStandardMaterial color={body2} roughness={0.88} />
            </mesh>
            <mesh position={[0, -0.008, 0.135]}>
              <sphereGeometry args={[0.017, 8, 8]} />
              <meshStandardMaterial color="#3a3230" roughness={0.4} />
            </mesh>
          </>
        ) : (
          <mesh position={[0, -0.012, 0.098]}>
            <sphereGeometry args={[0.011, 8, 8]} />
            <meshStandardMaterial color="#e89aa4" roughness={0.5} />
          </mesh>
        )}
        {/* 耳朵：小狗 = 两侧垂耳；兔子 = 长立耳（内耳粉） */}
        {isDog ? (
          <>
            <mesh castShadow position={[-0.082, 0.03, -0.01]} rotation={[0, 0, 0.5]} scale={[0.6, 1.35, 0.55]}>
              <sphereGeometry args={[0.045, 10, 8]} />
              <meshStandardMaterial color={earC} roughness={0.9} />
            </mesh>
            <mesh castShadow position={[0.082, 0.03, -0.01]} rotation={[0, 0, -0.5]} scale={[0.6, 1.35, 0.55]}>
              <sphereGeometry args={[0.045, 10, 8]} />
              <meshStandardMaterial color={earC} roughness={0.9} />
            </mesh>
          </>
        ) : (
          <>
            {[-1, 1].map((sx) => (
              <group key={sx} position={[0.038 * sx, 0.112, -0.005]} rotation={[-0.08, 0, -0.13 * sx]}>
                <mesh castShadow>
                  <capsuleGeometry args={[0.021, 0.075, 4, 8]} />
                  <meshStandardMaterial color={body} roughness={0.88} />
                </mesh>
                <mesh position={[0, 0, 0.016]} scale={[0.5, 0.9, 0.4]}>
                  <capsuleGeometry args={[0.021, 0.075, 4, 8]} />
                  <meshStandardMaterial color={earC} roughness={0.85} />
                </mesh>
              </group>
            ))}
          </>
        )}
        {/* 豆豆眼 + 腮红 */}
        {[-1, 1].map((sx) => (
          <mesh key={`e${sx}`} position={[0.04 * sx, 0.012, 0.09]}>
            <sphereGeometry args={[0.013, 8, 8]} />
            <meshStandardMaterial color="#3a3230" roughness={0.25} />
          </mesh>
        ))}
        {[-1, 1].map((sx) => (
          <mesh key={`c${sx}`} position={[0.068 * sx, -0.02, 0.07]} scale={[1, 0.62, 0.4]}>
            <sphereGeometry args={[0.013, 8, 8]} />
            <meshBasicMaterial color="#f6bfc6" transparent opacity={0.7} />
          </mesh>
        ))}
      </group>
      {/* v9 装扮：项圈（脖子一圈）/ 小围巾 / 蝴蝶结（耳边） */}
      <mesh position={[0, 0.185, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.085, 0.012, 8, 18]} />
        <meshStandardMaterial color={collarC} roughness={0.5} />
      </mesh>
      {typeof buddy.wear?.scarf === 'string' && (
        <mesh position={[0, 0.15, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.09, 0.02, 8, 18]} />
          <meshStandardMaterial color={buddy.wear.scarf} roughness={0.95} />
        </mesh>
      )}
      {typeof buddy.wear?.bow === 'string' && (
        <group position={[0.075, 0.34, 0.04]} rotation={[0, 0, 0.5]}>
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[0.024 * sx, 0, 0]} scale={[0.9, 0.6, 0.5]}>
              <sphereGeometry args={[0.02, 8, 8]} />
              <meshStandardMaterial color={buddy.wear!.bow!} roughness={0.85} />
            </mesh>
          ))}
          <mesh>
            <sphereGeometry args={[0.011, 8, 8]} />
            <meshStandardMaterial color={shade(buddy.wear!.bow!, 0.8)} roughness={0.85} />
          </mesh>
        </group>
      )}
      {/* 四只小爪 */}
      {[
        [-0.055, 0.1],
        [0.055, 0.1],
        [-0.06, -0.07],
        [0.06, -0.07],
      ].map(([px, pz], i) => (
        <mesh key={i} castShadow position={[px, 0.03, pz]}>
          <sphereGeometry args={[0.03, 10, 8]} />
          <meshStandardMaterial color={body} roughness={0.88} />
        </mesh>
      ))}
      {/* 尾巴：小狗 = 翘尾快摇；兔子 = 小圆尾 */}
      {isDog ? (
        <group ref={tail} position={[0, 0.16, -0.15]} rotation={[0.7, 0, 0]}>
          <mesh castShadow position={[0, 0.05, 0]} rotation={[0.5, 0, 0]}>
            <capsuleGeometry args={[0.017, 0.08, 4, 8]} />
            <meshStandardMaterial color={body2} roughness={0.88} />
          </mesh>
        </group>
      ) : (
        <mesh ref={tail} castShadow position={[0, 0.13, -0.15]}>
          <sphereGeometry args={[0.028, 10, 8]} />
          <meshStandardMaterial color="#ffffff" roughness={0.9} />
        </mesh>
      )}
      {/* v9 玩具球（它自己的捡球通道） */}
      <group ref={ballGrp} visible={false}>
        <mesh castShadow>
          <sphereGeometry args={[0.055, 14, 12]} />
          <meshStandardMaterial color={isDog ? '#f0a068' : '#f4a7bc'} roughness={0.5} />
        </mesh>
      </group>
      {/* 摸摸爱心 + 点击热区 */}
      <sprite ref={heartSp} material={heartMat} visible={false} />
      <mesh position={[0, 0.2, 0.02]} onPointerDown={onDown}>
        <sphereGeometry args={[0.4, 12, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------- v8.0 3D 头顶对话气泡（用户/AI 消息，投影为 billboard sprite） ----------------

/** 气泡纹理缓存（同一文本复用；上限 60 条，超出丢最旧）；v9 记录逻辑尺寸供 sprite 缩放用 */
const bubbleTexCache = new Map<string, { tex: THREE.CanvasTexture; w: number; h: number }>();

/** v10.3 超采样倍率：canvas 按 4x 分辨率绘制，高分屏（dpr 2~3）上文字边缘锐利不发虚 */
const BUBBLE_SS = 4;

/** 气泡样式：plain = iOS 磨砂白卡片（默认）/ thought = 想法泡（云朵虚线蓝描边 + 💭）/ love = 爱心泡（粉描边 + 顶部小爱心装饰） */
type BubbleStyle = 'plain' | 'thought' | 'love';

/**
 * 文字气泡贴图：iOS 风白底圆角卡片 + 淡淡投影 + 樱粉细描边 + 底部小尾巴 + 自动换行
 * （15 字/行，最多 5 行，超出省略号）。纯 canvas 绘制不依赖 DOM；宽度按字符宽度估算
 * （CJK 全宽 / 半角半宽）；4x 超采样 + 关 mipmap（LinearFilter 直采）保证文字边缘锐利。
 * 主体与尾巴合并为单一路径一次性填充/描边：半透明磨砂质感下不出现重叠双影。
 * v11 love 样式：粉色描边 + 顶部画一颗小爱心装饰，其余卡片样式不变（顶部多留一行高度给爱心）。
 */
function makeBubbleTexture(text: string, style: BubbleStyle = 'plain'): { tex: THREE.CanvasTexture; w: number; h: number } {
  const thought = style === 'thought';
  const love = style === 'love';
  const cacheKey = (thought ? '\u3031\u3031' : love ? '\u3032\u3032' : '') + text;
  const hit = bubbleTexCache.get(cacheKey);
  if (hit) return hit;
  const raw = (thought ? '\ud83d\udcad ' : '') + text.replace(/\s+/g, ' ').trim().slice(0, 120);
  const PER_LINE = 15;
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i += PER_LINE) {
    lines.push(raw.slice(i, i + PER_LINE));
    if (lines.length >= 5) break;
  }
  if (raw.length > PER_LINE * 5) lines[4] = `${lines[4].slice(0, PER_LINE - 1)}…`;
  const charW = (ch: string) => (ch.charCodeAt(0) > 0x2e7f ? 30 : 16);
  const lineW = lines.map((l) => [...l].reduce((s, ch) => s + charW(ch), 0));
  const W = Math.min(560, Math.max(170, Math.max(...lineW) + 52));
  const padTop = love ? 20 : 0; // love：顶部多留一条给小爱心装饰
  const H = lines.length * 40 + 40 + 18 + padTop; // 行高×行数 + 上下内边距 + 尾巴
  const SS = BUBBLE_SS;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(W * SS);
  cv.height = Math.ceil(H * SS);
  const ctx = cv.getContext('2d')!;
  ctx.scale(SS, SS); // 之后的绘制全部用逻辑坐标，输出即 4x 高清
  const r = 20;
  const bh = H - 18; // 气泡主体底边（留出尾巴）
  const tx = Math.min(W - 44, Math.max(44, W / 2)); // 尾巴尖水平位置
  const stroke = love ? 'rgba(246,140,170,0.95)' : thought ? 'rgba(150,180,205,0.85)' : 'rgba(242,183,199,0.9)';
  // —— iOS 风磨砂卡片：主体+尾巴单一路径，一次性填（带柔和投影）+ 细描边 ——
  ctx.save();
  ctx.shadowColor = 'rgba(120,80,95,0.20)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.moveTo(r, 3);
  ctx.arcTo(W - 3, 3, W - 3, bh, r); // 顶边 + 右上角
  ctx.arcTo(W - 3, bh, tx + 12, bh, r); // 右边 + 右下角（沿底边向左）
  ctx.lineTo(tx + 12, bh); // 底边走到尾巴右根
  ctx.quadraticCurveTo(tx + 5, H - 7, tx - 1, H - 3); // 尾巴右侧收到尖
  ctx.quadraticCurveTo(tx - 5, H - 7, tx - 12, bh); // 尾巴左侧收回
  ctx.lineTo(r, bh); // 底边剩余段
  ctx.arcTo(3, bh, 3, 3, r); // 左下角
  ctx.arcTo(3, 3, W - 3, 3, r); // 左边 + 左上角
  ctx.closePath();
  ctx.fillStyle = thought ? 'rgba(246,250,255,0.92)' : 'rgba(255,255,255,0.88)';
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = stroke;
  if (thought) ctx.setLineDash([9, 7]);
  ctx.stroke();
  ctx.setLineDash([]);
  // 顶部高光（磨砂玻璃的「光边」）
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r + 6, 5.5);
  ctx.lineTo(W - r - 6, 5.5);
  ctx.stroke();
  // v11 love：顶部居中小爱心装饰（粉渐变，不影响卡片其余样式）
  if (love) {
    const hx = W / 2;
    const hy = 17;
    const hg = ctx.createLinearGradient(hx, hy - 8, hx, hy + 8);
    hg.addColorStop(0, '#ff9db4');
    hg.addColorStop(1, '#f76e92');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(hx, hy + 8);
    ctx.bezierCurveTo(hx - 11, hy, hx - 9, hy - 8, hx - 4, hy - 8);
    ctx.bezierCurveTo(hx - 1, hy - 8, hx, hy - 5.5, hx, hy - 4);
    ctx.bezierCurveTo(hx, hy - 5.5, hx + 1, hy - 8, hx + 4, hy - 8);
    ctx.bezierCurveTo(hx + 9, hy - 8, hx + 11, hy, hx, hy + 8);
    ctx.fill();
  }
  // 文本
  ctx.fillStyle = '#43434a';
  ctx.font = '600 30px "PingFang SC", "Nunito", ui-rounded, "Microsoft YaHei", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.fillText(l, W / 2, 24 + padTop + i * 40 + 20);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  // v10.3 关 mipmap + Linear 直采：文字边缘不再被多级纹理采样模糊
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  const rec = { tex, w: W, h: H };
  bubbleTexCache.set(cacheKey, rec);
  if (bubbleTexCache.size > 60) {
    const oldest = bubbleTexCache.keys().next().value;
    if (oldest !== undefined) {
      bubbleTexCache.get(oldest)?.tex.dispose();
      bubbleTexCache.delete(oldest);
    }
  }
  return rec;
}

/**
 * 头顶气泡渲染（ billboard sprite，跟随 me/ta 小人）：
 * CoupleHome 向 bubbleRef 队列 push {who, text, hold}，本组件逐条消费 ——
 * 淡入 0.25s → 保持 hold 秒（缺省按字数 3.2+0.16/字，封顶 12s）→ 淡出 0.5s。
 */
function HeadBubbles({
  meRT,
  taRT,
  bubbleRef,
}: {
  meRT: CharRT;
  taRT: CharRT;
  bubbleRef?: RefObject<BubbleCmd[]>;
}) {
  const spMe = useRef<THREE.Sprite>(null);
  const spTa = useRef<THREE.Sprite>(null);
  const slots = useRef({
    me: { rec: null as { tex: THREE.CanvasTexture; w: number; h: number } | null, own: false, until: 0, total: 1 },
    ta: { rec: null as { tex: THREE.CanvasTexture; w: number; h: number } | null, own: false, until: 0, total: 1 },
  });
  useFrame((st) => {
    const now = st.clock.elapsedTime;
    // —— 消费队列（每人一个槽：空/到期才接新气泡，一次最多接一条防跳变） ——
    const q = bubbleRef?.current;
    if (q && q.length > 0) {
      for (let i = 0; i < q.length; i++) {
        const c = q[i];
        const slot = slots.current[c.who];
        if (slot.rec && now < slot.until) continue; // 该小人正在展示：排队等
        q.splice(i, 1);
        i--;
        // 页面切后台时 TA 的说话气泡（非想法/爱心泡）补一条系统通知（微信式；cabin-notify 内部自带
        // 可见性/总闸/授权检查，可见时 no-op）——宿主 CoupleHome 禁改期在共同下游挂钩
        if (c.who === 'ta' && !c.kind) notifyTaBubbleIfHidden(c.text);
        if (slot.own) slot.rec?.tex.dispose();
        slot.rec = makeBubbleTexture(c.text, c.kind === 'thought' ? 'thought' : c.kind === 'love' ? 'love' : 'plain');
        slot.own = true;
        slot.total = c.hold ?? Math.min(12, 3.2 + c.text.replace(/\s/g, '').length * 0.16);
        slot.until = now + slot.total;
        const sp = c.who === 'me' ? spMe.current : spTa.current;
        if (sp) {
          const m = sp.material as THREE.SpriteMaterial;
          m.map = slot.rec.tex;
          m.needsUpdate = true;
        }
        break; // 每帧每小人只接一条
      }
    }
    // —— 位置 / 缩放 / 透明度 ——
    for (const who of ['me', 'ta'] as const) {
      const sp = who === 'me' ? spMe.current : spTa.current;
      const slot = slots.current[who];
      if (!sp) continue;
      const remain = slot.until - now;
      const on = !!slot.rec && remain > 0;
      sp.visible = on;
      if (!on) continue;
      const pos = who === 'me' ? meRT : taRT;
      const age = slot.total - remain;
      const fadeIn = Math.min(1, age / 0.25);
      const fadeOut = Math.min(1, remain / 0.5);
      const m = sp.material as THREE.SpriteMaterial;
      m.opacity = Math.min(fadeIn, fadeOut);
      sp.position.set(pos.x, 1.42 + Math.sin(now * 2.1) * 0.014, pos.z + 0.04);
      const rec = slot.rec!;
      // v9：用逻辑尺寸算缩放（纹理本身是 3x 超采样，直接用 image.width 会放大 3 倍）
      const wS = Math.min(1.95, rec.w * 0.0034);
      sp.scale.set(wS, wS * (rec.h / rec.w), 1);
    }
  });
  return (
    <>
      <sprite ref={spMe} visible={false}>
        <spriteMaterial transparent depthWrite={false} toneMapped={false} opacity={0} />
      </sprite>
      <sprite ref={spTa} visible={false}>
        <spriteMaterial transparent depthWrite={false} toneMapped={false} opacity={0} />
      </sprite>
    </>
  );
}

// ---------------- Canvas 主体 ----------------

/**
 * v10.3 全局禁用视锥体裁剪（frustumCulled=false）：门/家具/GLB/精灵在屏幕边缘与
 * 转角瞬间不再突然消失（用户实测「靠近门时门会莫名消失」）。每 0.5s 扫一遍场景，
 * 覆盖异步加载的 GLB 与新放置的家具；全场景遍历 ≈几百对象，开销可忽略。
 */
function NoCull() {
  const { scene } = useThree();
  const tick = useRef(0);
  useFrame(() => {
    if (tick.current++ % 30 !== 0) return;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m.isMesh || (o as THREE.Sprite).isSprite) && m.frustumCulled) m.frustumCulled = false;
    });
  });
  return null;
}

/** 进屋过场状态（相机推镜路径缓存） */
interface IntroState {
  on: boolean;
  t: number;
  path?: { pos: THREE.CatmullRomCurve3; look: THREE.CatmullRomCurve3 };
}

export default function HomeScene(props: HomeSceneProps) {
  // D4：FPS 自适应画质（PerformanceMonitor 检测掉帧逐级降，恢复后逐级升；连续抖动 2 次锁最低）
  const [quality, setQuality] = useState<SceneQuality>('high');
  /** v6.8 进屋过场：白光渐隐（CoupleHome 白幕）+ 阳台外推镜进门（开门+拉升），结束机位 = 默认跟随轨道 */
  const introRef = useRef<IntroState>({ on: true, t: 0 });
  const {
    items, mode, night, selId, moveOn, meRT, taRT, joyRef, zoomCmd, moveCmd, onNudge, fp, fpRef,
    poseRef, actRef, carryRef, instRef, onFaucetTap, activeAct, mealTableId, floorTex, wallTex, wear, wear2,
    win, onToggleWin, winExist, winPos, doorPos,
    floorCol, wallCol, doorCol, winCol, floorColBed, wallColBed, floorColK, wallColK, floorColB, wallColB,
    floorColBal, wallColBal,
    ceilCol, ceilColBed, ceilColK, ceilColB,
    doorOpen, kitchenDoorOpen, bathDoorOpen, balconyDoorOpen, studyDoorOpen, gardenGateOpen,
    onToggleDoor, onToggleKitchenDoor, onToggleBathDoor, onToggleBalconyDoor, onToggleStudyDoor, onToggleGardenGateDoor,
    musicPlaying, weatherFx, litLamps, onCritterTap,
    petCmdRef, onPetTap, onPetEvent, petState, petCarryCmdRef,
    onFloorTap, onFurnTap, onDragEnd, onDragMove, onDragSelect, onWallTap,
    companionCmdRef, onCompanionEvent, onPartnerTap, bubbleRef, partnerPlayingId,
    petCoat, petWear, pets2, petBallCmdRef,
    onPartnerLongPress, petGrowLv,
  } = props;

  // —— v8.0 陪伴系统：状态机实例 / 小人姿势槽 / A* 阻挡网格（网格重建见下方 wallBoxes 之后） ——
  const compRT = useRef<CompanionRT>(createCompanionRT());
  const partnerPoseRef = useRef<PoseSlot>({ pose: 'stand', y: 0 });
  const gridRef = useRef<{ grid: BlockGrid | null }>({ grid: null });
  /** v8.3 第一只猫的运行时（PetBuddy 每帧写入 → 第二只宠物追着玩用） */
  const catRTRef = useRef<CharRT | null>(null);

  // —— v11 G3 四季：真实日期月份（每次挂载取一次；可传 date 测试） ——
  const season = useMemo(() => seasonNow(), []);
  // —— v11 G1 雷电闪白：weatherFx==='rain' 且生活模式时随机 8~22s 一次双闪（主闪 0.12s → 熄 0.18s → 二闪 0.1s）+ 延迟雷声 ——
  const [flashRaw, setFlashRaw] = useState(false);
  const lightningOn = mode === 'live' && weatherFx === 'rain';
  const lightning = flashRaw && lightningOn; // 天气/模式切走时由逻辑门控立即熄灭（避免 effect 内同步 setState）
  useEffect(() => {
    if (!lightningOn) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let thunderT: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!alive) return;
      timer = setTimeout(fire, 8000 + Math.random() * 14000);
    };
    const fire = () => {
      if (!alive) return;
      // 真实双闪：主闪 0.12s → 熄 0.18s → 二闪 0.1s → 结束重新排下一道
      setFlashRaw(true);
      timer = setTimeout(() => {
        if (!alive) return;
        setFlashRaw(false);
        timer = setTimeout(() => {
          if (!alive) return;
          setFlashRaw(true);
          timer = setTimeout(() => {
            if (!alive) return;
            setFlashRaw(false);
            schedule();
          }, 100);
        }, 180);
      }, 120);
      // 雷声：闪电触发后延迟 0.5~1.8s（远近感）
      thunderT = setTimeout(() => sfx.thunder(), 500 + Math.random() * 1300);
    };
    // 异步复位残留的闪状态（上次 rain 中途卸载可能停在 lit）
    const kickoff = setTimeout(() => {
      if (alive) setFlashRaw(false);
    }, 0);
    schedule();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (thunderT) clearTimeout(thunderT);
      clearTimeout(kickoff);
    };
  }, [lightningOn]);
  // —— v11 G4 抱抱暖光脉冲：陪伴状态机 hugStart 事件 → 两人中点触发一圈暖色光环 ——
  const hugPulseRef = useRef<HugPulseReq | null>(null);
  const onCompEvRef = useRef(onCompanionEvent);
  useEffect(() => {
    onCompEvRef.current = onCompanionEvent;
  });
  const handleCompanionEvent = useCallback(
    (e: CompanionEvent) => {
      if (e.ev === 'hugStart') {
        hugPulseRef.current = { x: (meRT.x + taRT.x) / 2, z: (meRT.z + taRT.z) / 2 };
      }
      onCompEvRef.current?.(e);
    },
    [meRT, taRT],
  );

  const modeRef = useRef<HomeMode>(mode);
  const itemsRef = useRef<FurnitureItem[]>(items);
  /** E2 昼夜混合系数（0=白天 → 1=夜晚，每帧阻尼） */
  const nightMixRef = useRef({ v: night ? 1 : 0 });
  const winPosRef = useRef(winPos);
  const doorPosRef = useRef(doorPos);
  const doorRef = useRef({
    bed: { open: !!doorOpen, along: DOORS[0].def },
    kt: { open: !!kitchenDoorOpen, along: DOORS[1].def },
    bath: { open: !!bathDoorOpen, along: DOORS[2].def },
    bal: { open: !!balconyDoorOpen, along: DOORS[3].def },
    sr: { open: !!studyDoorOpen, along: SRDOOR_Z },
    yd: { open: !!gardenGateOpen, along: YDOOR_X },
  });
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    winPosRef.current = winPos;
    doorPosRef.current = doorPos;
  }, [winPos, doorPos]);
  useEffect(() => {
    doorRef.current.bed.open = !!doorOpen;
    doorRef.current.kt.open = !!kitchenDoorOpen;
    doorRef.current.bath.open = !!bathDoorOpen;
    doorRef.current.bal.open = !!balconyDoorOpen;
    doorRef.current.sr.open = !!studyDoorOpen;
    doorRef.current.yd.open = !!gardenGateOpen;
  }, [doorOpen, kitchenDoorOpen, bathDoorOpen, balconyDoorOpen, studyDoorOpen, gardenGateOpen]);
  useEffect(() => {
    doorRef.current.bed.along = doorPos?.bed ?? DOORS[0].def;
    doorRef.current.kt.along = doorPos?.kt ?? DOORS[1].def;
    doorRef.current.bath.along = doorPos?.bath ?? DOORS[2].def;
    doorRef.current.bal.along = doorPos?.bal ?? DOORS[3].def;
  }, [doorPos]);

  const azRef = useRef({ az: 0 });
  const pitchRef = useRef({ p: 0.92 });
  const distRef = useRef({ d: 8.8 });

  /** 墙段碰撞盒（随门位变化重建；生活模式相机防钻墙钳制用） */
  const wallBoxes = useMemo(
    () =>
      buildWallBoxes(
        doorPos?.bed ?? DOORS[0].def,
        doorPos?.kt ?? DOORS[1].def,
        doorPos?.bath ?? DOORS[2].def,
        doorPos?.bal ?? DOORS[3].def,
      ),
    [doorPos?.bed, doorPos?.kt, doorPos?.bath, doorPos?.bal],
  );

  // —— v8.0 A* 阻挡网格重建：items / 墙段（门位）/ 门开态任一变化 → 重建（毫秒级） ——
  useEffect(() => {
    const dr = doorRef.current;
    gridRef.current.grid = buildBlockGrid(
      items,
      wallBoxes,
      {
        bed: dr?.bed ?? { open: false, along: DOORS[0].def },
        kt: dr?.kt ?? { open: false, along: DOORS[1].def },
        bath: dr?.bath ?? { open: false, along: DOORS[2].def },
        bal: dr?.bal ?? { open: false, along: DOORS[3].def },
        sr: dr?.sr ?? { open: false, along: SRDOOR_Z },
        yd: dr?.yd ?? { open: false, along: YDOOR_X },
      },
    );
  }, [items, wallBoxes, doorOpen, kitchenDoorOpen, bathDoorOpen, balconyDoorOpen, studyDoorOpen, gardenGateOpen, doorPos]);

  // —— v10 天气总线：TV 天气台 / 花园等深层组件实时读取（避免 props 穿透） ——
  useEffect(() => {
    weatherBusSet(weatherFx ?? 'sunny', night);
  }, [weatherFx, night]);

  /** 任一投影仪开着（幕布放下放电影） */
  const projectorOn = items.some((f) => f.kind === 'projector' && f.st?.on);
  /** G5 雨天/阴天氛围：环境光阴沉（内部换算传给 Lights，不进 Props 合同） */
  const gloomy = weatherFx === 'rain' || weatherFx === 'overcast';
  /** 正坐着的家具（吊篮秋千摆幅加大） */
  const sittingId = activeAct?.active && activeAct.type === 'sit' ? activeAct.itemId : null;

  const dragRef = useRef<DragInfo | null>(null);
  const lookRef = useRef({ on: false });
  /** 相机对焦物（生活=小人 / 编辑=轨道中心）→ 隔墙判断是否挡在镜头与它之间 */
  const focusRef = useRef({ x: 0, z: 2.4 });
  const moveSelRef = useRef<{ id: string | null; on: boolean }>({ id: null, on: false });
  useEffect(() => {
    moveSelRef.current = { id: moveOn ? selId : null, on: moveOn && !!selId };
  }, [moveOn, selId]);
  const keysRef = useRef<Set<string>>(new Set());
  useKeys(keysRef);

  const onFurnPointerDown = (e: ThreeEvent<PointerEvent>, item: FurnitureItem) => {
    if (modeRef.current === 'edit') {
      dragRef.current = { id: item.id, active: false, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY };
    }
  };

  /** 编辑模式：门窗按下 → 同家具一样进入拖拽语境（沿墙滑行） */
  const onWallPointerDown = (e: ThreeEvent<PointerEvent>, id: string) => {
    if (modeRef.current === 'edit') {
      dragRef.current = { id, active: false, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY };
    }
  };

  /** 拖拽实时钳位 + 吸附（家具四房间钳制；门窗沿墙滑行 + 避让同墙邻居） */
  const handleDragMove = (id: string, x: number, z: number) => {
    if (id.startsWith('win-')) {
      const i = Number(id.slice(4));
      const w = WINS[i];
      if (!w) return;
      const r = resolveWinPos(i, w.axis === 'z' ? x : z, winPosRef.current, doorPosRef.current);
      onDragMove(id, r.x, r.z);
      return;
    }
    if (id.startsWith('door-')) {
      const did = id.slice(5) as 'bed' | 'kt' | 'bath' | 'bal';
      const d = DOORS.find((x) => x.id === did);
      if (!d) return;
      const r = resolveDoorPos(did, d.axis === 'z' ? x : z, winPosRef.current, doorPosRef.current);
      onDragMove(id, r.x, r.z);
      return;
    }
    const it = itemsRef.current.find((f) => f.id === id);
    if (it) {
      const e: CatalogEntry | undefined = CATALOG[it.kind];
      const [w, d] = e ? footprintOf(e, it.ry ?? 0) : [0.5, 0.5];
      const hw = Math.max(w / 2, 0.18);
      const hd = Math.max(d / 2, 0.18);
      const sx = Math.round(x / SNAP) * SNAP;
      const sz = Math.round(z / SNAP) * SNAP;
      const [cx, cz] = clampFurnToRooms(sx, sz, hw, hd);
      onDragMove(id, cx, cz);
    }
  };

  return (
    <Canvas
      gl={{ preserveDrawingBuffer: true }}
      shadows="soft"
      dpr={Q_DPR[quality]}
      camera={{ fov: 48, near: 0.1, far: 80, position: [0, 6.2, 7.4] }}
      style={{ touchAction: 'none' }}
      resize={{ offsetSize: true }}
      performance={{ min: 0.5 }}
    >
      <PerformanceMonitor
        onDecline={() => setQuality((q) => (q === 'high' ? 'mid' : 'low'))}
        onIncline={() => setQuality((q) => (q === 'low' ? 'mid' : 'high'))}
        flipflops={2}
        onFallback={() => setQuality('low')}
      />
      <NoCull />
      <NightBlend night={night} mixRef={nightMixRef} weather={weatherFx ?? 'sunny'} />
      <Lights night={night} mixRef={nightMixRef} quality={quality} litLamps={litLamps} gloomy={gloomy} />
      {/* v11 G1 雷电室内瞬亮（独立加法环境光脉冲）+ H1 指尖追踪 + G4 抱抱暖光脉冲 */}
      <LightningPulse lit={lightning} />
      <PetFingerTracker modeRef={modeRef} />
      <HugWarmPulse reqRef={hugPulseRef} />
      <OutdoorWorld weather={weatherFx ?? 'sunny'} night={night} mixRef={nightMixRef} season={season} />
      <Room
        night={night}
        onFloorTap={onFloorTap}
        editMode={mode === 'edit'}
        selWall={selId && (selId.startsWith('win-') || selId.startsWith('door-')) ? selId : null}
        onWallTap={onWallTap}
        onWallPointerDown={onWallPointerDown}
        win={win}
        onToggleWin={onToggleWin}
        winExist={winExist}
        winPos={winPos}
        doorPos={doorPos}
        floorCol={floorCol}
        wallCol={wallCol}
        floorColBed={floorColBed}
        wallColBed={wallColBed}
        floorColK={floorColK}
        wallColK={wallColK}
        floorColB={floorColB}
        wallColB={wallColB}
        floorColBal={floorColBal}
        wallColBal={wallColBal}
        ceilCol={ceilCol}
        ceilColBed={ceilColBed}
        ceilColK={ceilColK}
        ceilColB={ceilColB}
        doorCol={doorCol}
        winCol={winCol}
        doorOpen={doorOpen}
        kitchenDoorOpen={kitchenDoorOpen}
        bathDoorOpen={bathDoorOpen}
        balconyDoorOpen={balconyDoorOpen}
        studyDoorOpen={studyDoorOpen}
        gardenGateOpen={gardenGateOpen}
        onToggleDoor={onToggleDoor}
        onToggleKitchenDoor={onToggleKitchenDoor}
        onToggleBathDoor={onToggleBathDoor}
        onToggleBalconyDoor={onToggleBalconyDoor}
        onToggleStudyDoor={onToggleStudyDoor}
        onToggleGardenGateDoor={onToggleGardenGateDoor}
        focusRef={focusRef}
        floorTex={floorTex}
        wallTex={wallTex}
        introRef={introRef}
        weatherFx={weatherFx}
        lightning={lightning}
        season={season}
      />
      {mode === 'edit' && <EditGrid />}
      <DragAid modeRef={modeRef} dragRef={dragRef} itemsRef={itemsRef} />

      {items.map((item) => {
        const entry = CATALOG[item.kind];
        if (!entry) return null;
        return (
          <Furn3D
            key={item.id}
            item={item}
            entry={entry}
            night={night}
            mode={mode}
            selected={selId === item.id}
            moving={moveOn && selId === item.id}
            onPointerDown={onFurnPointerDown}
            onTap={onFurnTap}
            onFaucetTap={onFaucetTap}
            cooking={activeAct?.type === 'cook' && activeAct.active && activeAct.itemId === item.id}
            playing={
              (activeAct?.type === 'play' && activeAct.active && activeAct.itemId === item.id) ||
              partnerPlayingId === item.id
            }
            meal={!!mealTableId && mealTableId === item.id}
            projectorOn={projectorOn}
            sitting={sittingId === item.id}
          />
        );
      })}

      <CharChibi3D rt={meRT} who="me" hide={fp && mode === 'live'} poseRef={poseRef} carryRef={carryRef} wear={wear} />
      {/* v11 长按陪伴小人（生活模式）→ onPartnerLongPress */}
      <CharChibi3D
        rt={taRT}
        who="partner"
        wear2={wear2}
        poseRef2={partnerPoseRef}
        onTap={onPartnerTap}
        onLongPress={mode === 'live' ? onPartnerLongPress : undefined}
      />
      <PetBuddy
        mode={mode}
        items={items}
        meRT={meRT}
        petCmdRef={petCmdRef}
        petCarryCmdRef={petCarryCmdRef}
        onPetTap={onPetTap}
        onPetEvent={onPetEvent}
        night={night}
        petState={petState}
        doorRef={doorRef}
        weatherFx={weatherFx}
        petCoat={petCoat}
        petWear={petWear}
        petBallCmdRef={petBallCmdRef}
        petRTRef={catRTRef}
        petGrowLv={petGrowLv}
      />
      {/* v8.3 第二只宠物（小狗/小兔子）：追着猫玩，摸摸会开心 */}
      {/* v9 领养宠物全家福：每只都是全功能（照顾/抱抱/扔球/把戏/装扮），互不干扰 */}
      {(pets2 ?? []).map((b, i) => (
        <PetBuddy2
          key={`${b.kind}-${i}`}
          mode={mode}
          items={items}
          night={night}
          buddy={b}
          petId={`p2:${i}`}
          meRT={meRT}
          catRTRef={catRTRef}
          doorRef={doorRef}
          petCmdRef={petCmdRef}
          petCarryCmdRef={petCarryCmdRef}
          petBallCmdRef={petBallCmdRef}
          onCareEvent={onPetEvent}
          onPetTap={onPetTap}
          petGrowLv={petGrowLv}
        />
      ))}
      <BedNightLight poseRef={poseRef} meRT={meRT} />
      {/* v8.0 3D 头顶对话气泡（用户/AI 消息挂在对应小人头顶） */}
      <HeadBubbles meRT={meRT} taRT={taRT} bubbleRef={bubbleRef} />
      <OutdoorPrecip kind={weatherFx ?? 'sunny'} season={season} />
      <GlassRain kind={weatherFx ?? 'sunny'} winExist={winExist} winPos={winPos} />
      <SnowDeco kind={weatherFx ?? 'sunny'} winExist={winExist} winPos={winPos} winter={season === 'winter'} />
      <Critters mode={mode} items={items} onCritterTap={onCritterTap} />
      {/* v8.1 音箱/收音机开着也飘音符（陪伴小人放歌时同享） */}
      <SpeakerNotes
        items={items}
        active={!!musicPlaying || items.some((f) => (f.kind === 'speaker' || f.kind === 'radio') && f.st?.on)}
      />
      <EditCameraKick mode={mode} />
      <ZoomPoker zoomCmd={zoomCmd} />
      <NudgePoker moveCmd={moveCmd} onNudge={onNudge} />
      <MoveModeGate moveOn={moveOn} mode={mode} />

      {mode === 'edit' && (
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={3.2}
          maxDistance={30}
          minPolarAngle={0.12}
          maxPolarAngle={1.32}
          target={[2.9, 0.4, 2.5]}
          screenSpacePanning={false}
        />
      )}

      <GameLoop
        meRT={meRT}
        taRT={taRT}
        joyRef={joyRef}
        keysRef={keysRef}
        azRef={azRef}
        pitchRef={pitchRef}
        distRef={distRef}
        modeRef={modeRef}
        itemsRef={itemsRef}
        doorRef={doorRef}
        lookRef={lookRef}
        focusRef={focusRef}
        fpRef={fpRef}
        poseRef={poseRef}
        actRef={actRef}
        wallBoxes={wallBoxes}
        instRef={instRef}
        introRef={introRef}
        compRT={compRT.current}
        companionCmdRef={companionCmdRef}
        onCompanionEvent={handleCompanionEvent}
        gridRef={gridRef}
        partnerPoseRef={partnerPoseRef}
      />
      <PointerRig
        mode={mode}
        modeRef={modeRef}
        azRef={azRef}
        pitchRef={pitchRef}
        distRef={distRef}
        dragRef={dragRef}
        moveSelRef={moveSelRef}
        itemsRef={itemsRef}
        lookRef={lookRef}
        fpRef={fpRef}
        onDragMove={handleDragMove}
        onDragEnd={onDragEnd}
        onDragSelect={onDragSelect}
      />
    </Canvas>
  );
}

// ---------------- v9 室外大世界：大地 / 太阳月亮星星 / 云朵 / 屋外雨雪（真实天气联动） ----------------

/** 柔和云朵贴图（几团重叠的径向渐变白团） */
function makeCloudTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const puff = (x: number, y: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.62, `rgba(255,255,255,${a * 0.55})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  puff(88, 74, 44, 0.95);
  puff(132, 60, 52, 0.95);
  puff(176, 76, 42, 0.9);
  puff(112, 84, 40, 0.85);
  puff(152, 88, 38, 0.8);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 光晕贴图（太阳/月亮通用：中心实心 + 大范围柔光） */
function makeGlowTexture(core: string, glow: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, core);
  g.addColorStop(0.24, core);
  g.addColorStop(0.42, glow);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** v9 各天气室外地面色（雪原 / 雨天湿地；草地色 v11 起改由 SEASON_GROUND 按季节驱动） */
const GROUND_DAY: Record<HomeWeather, string> = {
  sunny: '#9cc489',
  cloudy: '#8fb283',
  overcast: '#88967f',
  rain: '#77896f',
  snow: '#edf2f6',
};

/** v11 G3 四季室外草地色：春嫩绿 / 夏浓绿 / 秋枯黄 / 冬薄雪覆地（雪天仍全雪原） */
const SEASON_GROUND: Record<Season, string> = {
  spring: '#a6d18c',
  summer: '#7dbb67',
  autumn: '#c9a95f',
  winter: '#e6ecf2',
};

/** 云朵调校：透明度 / 颜色 / 藏几朵（晴天云最少） */
const CLOUD_TUNE: Record<HomeWeather, { op: number; tint: string; hide: number }> = {
  sunny: { op: 0.85, tint: '#ffffff', hide: 4 },
  cloudy: { op: 0.95, tint: '#ffffff', hide: 0 },
  overcast: { op: 0.98, tint: '#a9afb8', hide: 0 },
  rain: { op: 0.98, tint: '#787f88', hide: 0 },
  snow: { op: 0.92, tint: '#dfe4ea', hide: 1 },
};

/** 房子占位盒（雨雪粒子排除屋内；含一点墙体余量） */
const HOUSE_BX0 = STUDY_X0 - 0.35;
const HOUSE_BX1 = KTCH_X1 + 0.35;
const HOUSE_BZ0 = -ROOM_Z - 0.35;
const HOUSE_BZ1 = BAL_Z1 + 0.35;
/** 房子中心（云/星/日月绕着它布置） */
const HOUSE_CX = (KTCH_X1 - ROOM_X) / 2;
const HOUSE_CZ = (BAL_Z1 - ROOM_Z) / 2;

/**
 * v9 室外大世界（房子外面不再是一片白）：
 * - 大地圆盘（草地/雪原/湿地随天气变、夜晚变暗）；
 * - 晴天太阳光晕；夜晚月亮 + 满天星星（阴雨夜隐约）；
 * - 一圈慢速漂移的云朵（阴雨变灰压低，晴天只剩几朵）。
 * 全部悬在房外高空/远处 —— 透过窗户与无墙遮挡的第三人称视角自然可见。
 */
function OutdoorWorld({
  weather,
  mixRef,
  season = 'summer',
}: {
  weather: HomeWeather;
  night: boolean;
  mixRef: RefObject<{ v: number }>;
  /** v11 G3 季节（草地四季色） */
  season?: Season;
}) {
  const cloudTex = useMemo(() => makeCloudTexture(), []);
  const sunTex = useMemo(() => makeGlowTexture('rgba(255,244,214,1)', 'rgba(255,214,140,0.55)'), []);
  const moonTex = useMemo(() => makeGlowTexture('rgba(240,244,255,1)', 'rgba(200,214,255,0.4)'), []);
  const cloudGrps = useRef<(THREE.Group | null)[]>([]);
  /** 云朵实例（一次生成；每帧漂移 + 天气换色） */
  const clouds = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        x: HOUSE_CX + Math.cos((i / 9) * Math.PI * 2 + 0.4 * Math.sin(i * 7.3)) * (12.5 + ((i * 37) % 11)),
        y: 5.4 + ((i * 53) % 23) / 10,
        z: HOUSE_CZ + Math.sin((i / 9) * Math.PI * 2 + 0.4 * Math.sin(i * 7.3)) * (10 + ((i * 37) % 9)),
        s: 2.6 + ((i * 29) % 18) / 10,
        spd: 0.1 + ((i * 17) % 10) / 70,
        mat: new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }),
      })),
    [cloudTex],
  );
  /** 星星（Points，夜里淡入 + 微闪） */
  const stars = useMemo(() => {
    const n = 170;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 20 + Math.random() * 9;
      pos[i * 3] = HOUSE_CX + Math.cos(ang) * r;
      pos[i * 3 + 1] = 3.8 + Math.random() * 9;
      pos[i * 3 + 2] = HOUSE_CZ + Math.sin(ang) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: '#eef2ff', size: 0.12, transparent: true, opacity: 0, sizeAttenuation: true, depthWrite: false, toneMapped: false });
    return { geo, mat };
  }, []);
  const groundMat = useRef<THREE.MeshStandardMaterial>(null);
  const sunSp = useRef<THREE.Sprite>(null);
  const moonSp = useRef<THREE.Sprite>(null);
  const tmpC = useRef(new THREE.Color());
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const mix = mixRef.current.v;
    const tune = CLOUD_TUNE[weather];
    // —— 地面颜色（v11 四季草地 × 天气压暗 × 昼夜变暗） ——
    if (groundMat.current) {
      if (weather === 'snow') {
        tmpC.current.set(GROUND_DAY.snow); // 雪天仍全雪原
      } else {
        tmpC.current.set(SEASON_GROUND[season]);
        if (weather === 'rain') tmpC.current.multiplyScalar(0.8); // 雨天湿地压暗（沿用旧比例）
        else if (weather === 'overcast') tmpC.current.multiplyScalar(0.88);
      }
      if (mix > 0) tmpC.current.multiplyScalar(1 - mix * 0.62);
      groundMat.current.color.lerp(tmpC.current, Math.min(1, dt * 1.4));
    }
    // —— 太阳（晴天白天）/ 月亮 + 星星（夜晚；阴雨夜隐约） ——
    if (sunSp.current) {
      const m = sunSp.current.material as THREE.SpriteMaterial;
      m.opacity = THREE.MathUtils.damp(m.opacity, Math.max(0, (1 - mix) * (weather === 'sunny' ? 1 : 0)), 2.2, dt);
    }
    if (moonSp.current) {
      const m = moonSp.current.material as THREE.SpriteMaterial;
      const clearF = weather === 'rain' || weather === 'overcast' ? 0.32 : 1;
      m.opacity = THREE.MathUtils.damp(m.opacity, mix * clearF, 2.2, dt);
    }
    stars.mat.opacity = THREE.MathUtils.damp(stars.mat.opacity, mix * (weather === 'rain' || weather === 'overcast' ? 0.18 : 0.95), 2, dt);
    stars.mat.size = 0.11 + Math.sin(state.clock.elapsedTime * 2.1) * 0.025;
    // —— 云朵漂移 + 天气换色/换透明度 ——
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      c.x += c.spd * dt;
      if (c.x > HOUSE_CX + 27) c.x = HOUSE_CX - 27;
      const g = cloudGrps.current[i];
      if (g) {
        g.position.set(c.x, c.y - (weather === 'rain' || weather === 'overcast' ? 0.9 : 0), c.z);
      }
      c.mat.opacity = THREE.MathUtils.damp(c.mat.opacity, i >= clouds.length - tune.hide ? 0 : tune.op, 1.8, dt);
      c.mat.color.lerp(tmpC.current.set(tune.tint), Math.min(1, dt * 1.2));
    }
  });
  return (
    <group>
      {/* 大地（房子外的草地/雪原圆盘，半径 34m；v11 草地随四季换色） */}
      <mesh position={[HOUSE_CX, -0.048, HOUSE_CZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[34, 48]} />
        <meshStandardMaterial ref={groundMat} color={weather === 'snow' ? GROUND_DAY.snow : SEASON_GROUND[season]} roughness={1} />
      </mesh>
      {/* 太阳（晴天白天淡入） */}
      <sprite ref={sunSp} position={[HOUSE_CX - 13, 8.8, HOUSE_CZ - 14]} scale={[4.8, 4.8, 1]}>
        <spriteMaterial map={sunTex} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </sprite>
      {/* 月亮（夜晚淡入） */}
      <sprite ref={moonSp} position={[HOUSE_CX + 11, 8.4, HOUSE_CZ + 12]} scale={[3.5, 3.5, 1]}>
        <spriteMaterial map={moonTex} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </sprite>
      {/* 星空 */}
      <points geometry={stars.geo} material={stars.mat} frustumCulled={false} />
      {/* 云朵（一朵 = 3 片柔云 sprite，慢速漂移） */}
      {clouds.map((c, i) => (
        <group key={i} ref={(g) => { cloudGrps.current[i] = g; }}>
          <sprite scale={[c.s * 1.9, c.s * 0.95, 1]} material={c.mat} />
          <sprite scale={[c.s * 1.2, c.s * 0.72, 1]} material={c.mat} position={[c.s * 0.55, -c.s * 0.14, 0.01]} />
          <sprite scale={[c.s * 1.05, c.s * 0.66, 1]} material={c.mat} position={[-c.s * 0.58, -c.s * 0.12, -0.01]} />
        </group>
      ))}
    </group>
  );
}

/** 雨点贴图（细长竖条柔边） */
function makeRainDropTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(16, 0, 16, 64);
  g.addColorStop(0, 'rgba(208,226,242,0)');
  g.addColorStop(0.5, 'rgba(214,232,248,0.92)');
  g.addColorStop(1, 'rgba(208,226,242,0)');
  ctx.fillStyle = g;
  ctx.fillRect(13, 4, 6, 56);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 雪点贴图（柔边白点） */
function makeSnowDotTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 32;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 14);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** v11 G3 樱花瓣贴图（粉色小圆片，柔边） */
function makePetalTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 32;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 14, 1, 16, 16, 13);
  g.addColorStop(0, 'rgba(252,216,228,1)');
  g.addColorStop(0.65, 'rgba(248,186,206,0.9)');
  g.addColorStop(1, 'rgba(248,186,206,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(16, 16, 12, 8, 0.6, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** v11 G3 落叶贴图（橙色小叶片） */
function makeLeafTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 32;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(15, 14, 1, 16, 16, 13);
  g.addColorStop(0, 'rgba(238,178,96,1)');
  g.addColorStop(0.65, 'rgba(222,146,62,0.92)');
  g.addColorStop(1, 'rgba(222,146,62,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(16, 16, 12, 7, -0.5, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 在房子外的环带里随机取一点（屋内重采样最多 8 次，兜底放到北墙外） */
function randOutdoorPoint(out: Float32Array, i: number): void {
  for (let k = 0; k < 8; k++) {
    const x = HOUSE_BX0 - 7 + Math.random() * (HOUSE_BX1 - HOUSE_BX0 + 14);
    const z = HOUSE_BZ0 - 7 + Math.random() * (HOUSE_BZ1 - HOUSE_BZ0 + 14);
    if (x < HOUSE_BX0 || x > HOUSE_BX1 || z < HOUSE_BZ0 || z > HOUSE_BZ1) {
      out[i * 3] = x;
      out[i * 3 + 2] = z;
      return;
    }
  }
  out[i * 3] = HOUSE_BX0 - 1 - Math.random() * 4;
  out[i * 3 + 2] = HOUSE_BZ0 - 1 - Math.random() * 4;
}

/**
 * v9 室外雨/雪粒子（真 3D 世界空间）：雨雪只落在房子外面的世界里 ——
 * 透过窗户能看到外面下雨/飘雪，屋里绝不再飘雨点（旧「窗帘雨」已移除）。
 * v11 G3 季节粒子：非雨雪时春飘樱花瓣 / 秋飘橙落叶（复用同一套粒子机制，同样只落屋外；雨雪优先）。
 */
function OutdoorPrecip({ kind, season = 'summer' }: { kind: HomeWeather; season?: Season }) {
  const mode: 'rain' | 'snow' | 'petal' | 'leaf' | null =
    kind === 'rain'
      ? 'rain'
      : kind === 'snow'
        ? 'snow'
        : season === 'spring'
          ? 'petal'
          : season === 'autumn'
            ? 'leaf'
            : null;
  const tex = useMemo(
    () =>
      mode === 'snow'
        ? makeSnowDotTexture()
        : mode === 'rain'
          ? makeRainDropTexture()
          : mode === 'petal'
            ? makePetalTexture()
            : mode === 'leaf'
              ? makeLeafTexture()
              : null,
    [mode],
  );
  const pts = useMemo(() => {
    const n = 460;
    const pos = new Float32Array(n * 3);
    const spd = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      randOutdoorPoint(pos, i);
      pos[i * 3 + 1] = Math.random() * 5.4;
      spd[i] = 0.85 + Math.random() * 0.5;
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { geo, pos, spd, phase, n };
  }, []);
  useFrame((state, rawDt) => {
    if (!mode) return;
    const dt = Math.min(rawDt, 0.05);
    const { pos, spd, phase, n, geo } = pts;
    const speed = mode === 'rain' ? 4.4 : mode === 'snow' ? 0.55 : 0.75; // 花瓣/落叶缓落
    const sway = mode === 'petal' ? 0.34 : mode === 'leaf' ? 0.42 : mode === 'snow' ? 0.24 : 0;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < n; i++) {
      pos[i * 3 + 1] -= spd[i] * speed * dt;
      pos[i * 3] += Math.sin(t * 1.4 + phase[i]) * dt * sway;
      if (pos[i * 3 + 1] < 0.04) {
        pos[i * 3 + 1] = 5.2 + Math.random() * 0.6;
        randOutdoorPoint(pos, i);
      }
    }
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  });
  if (!mode || !tex) return null;
  return (
    <points geometry={pts.geo} frustumCulled={false}>
      <pointsMaterial
        key={mode}
        map={tex}
        size={mode === 'snow' ? 0.13 : mode === 'rain' ? 0.2 : mode === 'petal' ? 0.115 : 0.125}
        transparent
        opacity={mode === 'rain' ? 0.62 : mode === 'snow' ? 0.85 : 0.9}
        depthWrite={false}
        sizeAttenuation
        toneMapped={false}
        color={mode === 'rain' ? '#cfe0ee' : mode === 'petal' ? '#f9c9d8' : mode === 'leaf' ? '#e8a05a' : '#ffffff'}
      />
    </points>
  );
}

// ---------------- G5 积雪/水珠 + G3 彩蛋小生物（v6.1；G2 远景幕帘已按需求移除） ----------------

/** G5 玻璃水珠贴图（圆珠 + 竖向水痕） */
function makeGlassRainTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);
  // 三道水痕
  for (let i = 0; i < 3; i++) {
    const x = 16 + Math.random() * 96;
    const y = Math.random() * 120;
    const h = 70 + Math.random() * 90;
    const lg = ctx.createLinearGradient(0, y, 0, y + h);
    lg.addColorStop(0, 'rgba(225,238,248,0.05)');
    lg.addColorStop(0.8, 'rgba(225,238,248,0.3)');
    lg.addColorStop(1, 'rgba(225,238,248,0.05)');
    ctx.strokeStyle = lg;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 1.5, y + h);
    ctx.stroke();
  }
  // 圆珠
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 256;
    const r = 1.2 + Math.random() * 2.6;
    const rg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)');
    rg.addColorStop(0.55, 'rgba(214,232,244,0.5)');
    rg.addColorStop(1, 'rgba(214,232,244,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.4, 1.6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** G5 雨天玻璃水珠层：贴在每扇窗玻璃外表面，极缓慢下滑 */
function GlassRain({ kind, winExist, winPos }: { kind: HomeWeather; winExist?: boolean[]; winPos?: number[] }) {
  const tex = useMemo(() => makeGlassRainTexture(), []);
  useFrame((_, dt) => {
    if (kind !== 'rain') return;
    tex.offset.y = (tex.offset.y - dt * 0.016) % 1;
    tex.offset.x = Math.sin(performance.now() / 3400) * 0.01;
  });
  return (
    <group>
      {WINS.map((w, i) => {
        if (winExist && winExist[i] === false) return null; // 已收起的窗不挂水珠
        const along = winPos?.[i] ?? w.def;
        const x = w.axis === 'z' ? along : w.at + w.side * 0.44;
        const z = w.axis === 'z' ? w.at + w.side * 0.44 : along;
        return (
          <mesh key={i} position={[x, 1.52, z]} rotation={[0, w.ry, 0]} visible={kind === 'rain'}>
            <planeGeometry args={[1.7, 2.2]} />
            <meshBasicMaterial map={tex} transparent opacity={0.55} depthWrite={false} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

/** G5 雪天积雪 + v11 G3 冬季：窗外窗台白沿 + 阳台地面薄雪（snow 天气或冬季常驻薄雪底） */
function SnowDeco({ kind, winExist, winPos, winter = false }: { kind: HomeWeather; winExist?: boolean[]; winPos?: number[]; winter?: boolean }) {
  const on = kind === 'snow' || winter;
  return (
    <group visible={on}>
      {WINS.map((w, i) => {
        if (winExist && winExist[i] === false) return null; // 已收起的窗不留雪沿
        const along = winPos?.[i] ?? w.def;
        const x = w.axis === 'z' ? along : w.at + w.side * 0.56;
        const z = w.axis === 'z' ? w.at + w.side * 0.56 : along;
        return (
          <mesh key={i} position={[x, 0.92, z]} rotation={[0, w.ry, 0]}>
            <boxGeometry args={[1.72, 0.055, 0.16]} />
            <meshStandardMaterial color="#f3f7fb" roughness={1} />
          </mesh>
        );
      })}
      <mesh
        position={[(BAL_X0 + BAL_X1) / 2, 0.014, (BAL_Z0 + BAL_Z1) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[BAL_X1 - BAL_X0 - 0.24, BAL_Z1 - BAL_Z0 - 0.24]} />
        <meshStandardMaterial color="#eef4f9" transparent opacity={0.55} roughness={1} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** 彩蛋小生物运行时状态（ref 内高频更新，不入 React state） */
interface CritterRT {
  active: boolean;
  kind: 'butterfly' | 'bird';
  ax: number;
  az: number;
  t0: number;
  life: number;
  fleeing: boolean;
  fx: number;
  fz: number;
  fy: number;
  seed: number;
}

const CRITTER_PLANTS = new Set(['plant', 'plantSmall', 'monstera', 'flowerBox', 'flowerStand', 'hydro', 'cactus']);

/** G3 彩蛋小生物：蝴蝶/小鸟在阳台花丛附近漫游，点击惊飞（仅 live 模式生成） */
function Critters({
  mode,
  items,
  onCritterTap,
}: {
  mode: HomeMode;
  items: FurnitureItem[];
  onCritterTap?: (kind: 'butterfly' | 'bird') => void;
}) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const tapRef = useRef(onCritterTap);
  tapRef.current = onCritterTap;

  const crits = useRef<CritterRT[]>(
    Array.from({ length: 2 }, (_, i) => ({
      active: false,
      kind: i === 0 ? 'butterfly' : 'bird',
      ax: 0,
      az: 0,
      t0: 0,
      life: 0,
      fleeing: false,
      fx: 0,
      fz: 0,
      fy: 0,
      seed: Math.random() * 10,
    })),
  );
  const groups = useRef<(THREE.Group | null)[]>([]);
  const wings = useRef<(THREE.Group | null)[][]>([[], []]);
  const prev = useRef<[number, number][]>([[0, 0], [0, 0]]);
  const nextSpawn = useRef(7 + Math.random() * 8); // 首次 7~15s 出现，后续 25~55s

  const startle = useCallback((c: CritterRT, kind: 'butterfly' | 'bird') => {
    if (!c.active || c.fleeing) return;
    c.fleeing = true;
    c.fx = (Math.random() - 0.5) * 3.2;
    c.fz = -2.4 - Math.random() * 1.6;
    c.fy = 3.4;
    tapRef.current?.(kind);
  }, []);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    // 生成调度（仅 live）
    if (modeRef.current === 'live') {
      if (t >= nextSpawn.current) {
        const c = crits.current.find((x) => !x.active);
        if (c) {
          const plants = itemsRef.current.filter((f) => CRITTER_PLANTS.has(f.kind));
          if (plants.length && Math.random() < 0.4) {
            const p = plants[Math.floor(Math.random() * plants.length)];
            c.ax = p.x + (Math.random() - 0.5) * 1.3;
            c.az = p.z + (Math.random() - 0.5) * 1.3;
          } else {
            c.ax = BAL_X0 + 0.7 + Math.random() * Math.max(0.4, BAL_X1 - BAL_X0 - 1.4);
            c.az = BAL_Z0 + 0.55 + Math.random() * Math.max(0.4, BAL_Z1 - BAL_Z0 - 1.1);
          }
          c.active = true;
          c.t0 = t;
          c.life = 15 + Math.random() * 10;
          c.fleeing = false;
          c.seed = Math.random() * 10;
          const g = groups.current[crits.current.indexOf(c)];
          if (g) {
            g.position.set(c.ax, c.kind === 'butterfly' ? 0.6 : 1.0, c.az);
            g.visible = true;
          }
          nextSpawn.current = t + 25 + Math.random() * 30;
        } else {
          nextSpawn.current = t + 8;
        }
      }
    } else {
      // 编辑模式：全部悄悄离场（不弹提示）
      crits.current.forEach((c) => {
        if (c.active && !c.fleeing) {
          c.fleeing = true;
          c.fy = 2.8;
        }
      });
    }

    crits.current.forEach((c, i) => {
      const g = groups.current[i];
      if (!g) return;
      if (!c.active) {
        g.visible = false;
        return;
      }
      const age = t - c.t0;
      if (!c.fleeing && age > c.life) {
        // 生命期到：自然飞走
        c.fleeing = true;
        const a = Math.random() * Math.PI * 2;
        c.fx = Math.cos(a) * 2.4;
        c.fz = Math.sin(a) * 2.4 - 1.6;
        c.fy = 2.8;
      }
      const px = prev.current[i][0];
      const pz = prev.current[i][1];
      if (c.fleeing) {
        g.position.x += c.fx * dt;
        g.position.y += c.fy * dt;
        g.position.z += c.fz * dt;
        if (g.position.y > 6.2) {
          c.active = false;
          g.visible = false;
          return;
        }
      } else {
        const s = c.seed;
        const bx = c.ax + Math.sin(t * 0.55 + s) * 0.72;
        const bz = c.az + Math.cos(t * 0.42 + s * 1.7) * 0.58;
        const by = c.kind === 'butterfly' ? 0.55 + Math.sin(t * 1.6 + s) * 0.3 : 0.95 + Math.sin(t * 1.1 + s) * 0.2;
        const k = Math.min(1, dt * 2.4);
        g.position.x += (bx - g.position.x) * k;
        g.position.y += (by - g.position.y) * k;
        g.position.z += (bz - g.position.z) * k;
      }
      // 朝向速度方向
      const dx = g.position.x - px;
      const dz = g.position.z - pz;
      if (Math.abs(dx) + Math.abs(dz) > 0.002) g.rotation.y = Math.atan2(dx, dz);
      prev.current[i][0] = g.position.x;
      prev.current[i][1] = g.position.z;
      // 翅膀扑扇（惊飞更快）
      const flapRate = c.kind === 'butterfly' ? 17 : 11;
      const flap = Math.sin(t * flapRate + c.seed * 3) * (c.fleeing ? 1.05 : 0.75);
      const wl = wings.current[i]?.[0];
      const wr = wings.current[i]?.[1];
      if (wl) wl.rotation.z = 0.3 + flap;
      if (wr) wr.rotation.z = -0.3 - flap;
    });
  });

  const handleDown = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const c = crits.current[i];
    if (modeRef.current !== 'live') return;
    startle(c, c.kind);
  };

  const setWing = (i: number, j: number) => (g: THREE.Group | null) => {
    if (wings.current[i]) wings.current[i][j] = g;
  };

  return (
    <group>
      {/* 蝴蝶 */}
      <group
        ref={(g) => {
          groups.current[0] = g;
        }}
        visible={false}
        onPointerDown={handleDown(0)}
      >
        <mesh scale={[0.045, 0.045, 0.1]}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#7a5a62" roughness={0.8} />
        </mesh>
        <group ref={setWing(0, 0)} position={[0.02, 0.02, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.09, 0, 0.01]}>
            <circleGeometry args={[0.11, 14]} />
            <meshStandardMaterial color="#f2a9c4" roughness={0.7} side={THREE.DoubleSide} />
          </mesh>
        </group>
        <group ref={setWing(0, 1)} position={[-0.02, 0.02, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.09, 0, 0.01]}>
            <circleGeometry args={[0.11, 14]} />
            <meshStandardMaterial color="#f2a9c4" roughness={0.7} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>
      {/* 小鸟 */}
      <group
        ref={(g) => {
          groups.current[1] = g;
        }}
        visible={false}
        onPointerDown={handleDown(1)}
      >
        <mesh scale={[0.075, 0.068, 0.098]}>
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial color="#c98a5e" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.055, 0.075]} scale={[0.05, 0.05, 0.05]}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#d49a6e" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.05, 0.125]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.016, 0.05, 8]} />
          <meshStandardMaterial color="#e8b04a" roughness={0.7} />
        </mesh>
        <group ref={setWing(1, 0)} position={[0.05, 0.03, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.055, 0, 0]}>
            <circleGeometry args={[0.062, 12]} />
            <meshStandardMaterial color="#a8703f" roughness={0.8} side={THREE.DoubleSide} />
          </mesh>
        </group>
        <group ref={setWing(1, 1)} position={[-0.05, 0.03, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.055, 0, 0]}>
            <circleGeometry args={[0.062, 12]} />
            <meshStandardMaterial color="#a8703f" roughness={0.8} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ---------------- 音响放歌：音箱上方飘音符（v5.7 F3） ----------------

/** 音符贴图（canvas 画 ♪♫） */
function makeNoteSprite(ch: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, 96, 96);
  ctx.fillStyle = '#c98a9e';
  ctx.font = '60px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, 48, 52);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function SpeakerNotes({ items, active }: { items: FurnitureItem[]; active: boolean }) {
  const speakers = useMemo(() => items.filter((f) => f.kind === 'speaker' || f.kind === 'radio'), [items]);
  const noteTex = useMemo(() => [makeNoteSprite('♪'), makeNoteSprite('♫')], []);
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const seeds = useMemo(() => [0, 0.3, 0.6, 0.15, 0.45, 0.8], []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    sprites.current.forEach((sp, i) => {
      if (!sp) return;
      const si = Math.floor(i / 3);
      const sp3 = i % 3;
      const host = speakers[si];
      if (!host || !active) {
        sp.visible = false;
        return;
      }
      const s = seeds[i % seeds.length];
      const life = (t * 0.55 + s) % 1;
      sp.visible = true;
      sp.position.set(
        host.x + Math.sin(s * 21 + t * 1.2) * 0.16,
        1.5 + sp3 * 0.25 + life * 0.55,
        host.z + Math.cos(s * 15 + t * 0.9) * 0.16,
      );
      sp.scale.setScalar(0.22 + life * 0.1);
      (sp.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.9 * (1 - life));
    });
  });
  return (
    <group>
      {Array.from({ length: speakers.length * 3 }, (_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            sprites.current[i] = el;
          }}
          visible={false}
        >
          <spriteMaterial map={noteTex[i % 2]} transparent depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}
