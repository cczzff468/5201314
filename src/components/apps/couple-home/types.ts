/**
 * 情侣小家 3D —— 类型定义（v5.3 四室一厅）
 *
 * - 客厅 9m × 6m + 卧室 6×5 + 厨房 6×5 + 卫生间 4×5，家具 MODEL_SCALE=2.0；
 * - 家具 (x, z) 底部中心，y 为抬升（电视上墙 / 空调上墙 / 物件上桌 / 吊灯挂顶）；
 * - ry = 任意角度水平旋转（弧度），rx = 俯仰旋转（弧度，钳 ±1.05）；
 * - col = 用户自选主色（编辑模式调色盘）；
 * - 窗户/门可编辑：winPos（每扇沿墙滑行坐标）/ doorPos（每扇门沿墙坐标）；
 * - 天花板四房间分开换色；fp = 第一人称视角；
 * - 两个模式：live（摇杆+跟随镜头+家具交互）/ edit（俯瞰+拖拽+旋转+调色+商店）。
 */

/** 家具种类（catalog 的 key） */
export type FurnitureKind =
  | 'sofa'
  | 'sofaLong'
  | 'loungeChair'
  | 'ottoman'
  | 'coffeeTable'
  | 'diningTable'
  | 'chair'
  | 'sideTable'
  | 'bed'
  | 'bedSingle'
  | 'nightstand'
  | 'rug'
  | 'rugRect'
  | 'doormat'
  | 'tv'
  | 'tvStand'
  | 'speaker'
  | 'radio'
  | 'lampFloor'
  | 'lampTable'
  | 'plant'
  | 'plantSmall'
  | 'bookcase'
  | 'wardrobe'
  | 'books'
  | 'bear'
  | 'box'
  | 'trashcan'
  | 'aircon'
  | 'photoFrame'
  | 'photoWall'
  | 'photoWallWide'
  | 'polaroid'
  | 'plushBunny'
  | 'plushDuck'
  | 'plushPanda'
  | 'plushPig'
  | 'plushCat'
  | 'vanity'
  | 'fridge'
  | 'stove'
  | 'sink'
  | 'kitchenBar'
  | 'washer'
  | 'bathtub'
  | 'toilet'
  | 'desk'
  | 'coatRack'
  | 'toaster'
  | 'microwave'
  | 'pot'
  | 'kettle'
  | 'bowls'
  | 'plates'
  | 'chopsticks'
  | 'spoons'
  | 'cup'
  | 'juicer'
  | 'fan'
  | 'socket'
  | 'chandelier'
  | 'shower'
  | 'basin'
  | 'mirror'
  | 'towelRack'
  | 'laptop'
  | 'curtain'
  | 'fireplace'
  | 'fishtank'
  | 'beanbag'
  | 'piano'
  | 'guitar'
  | 'standingMirror'
  | 'starLamp'
  | 'canopy'
  | 'coffeeMaker'
  | 'fruitBasket'
  | 'wallShelf'
  | 'bathCurtain'
  | 'toiletries'
  | 'scale'
  // ---- v5.7 拾光扩展（用户选择清单 J1~J11） ----
  | 'projector'
  | 'screen'
  | 'swingChair'
  | 'shoeCabinet'
  | 'wallArt'
  | 'humidifier'
  | 'wineCabinet'
  | 'chessTable'
  | 'hotpotTable'
  | 'gameConsole'
  | 'flowerStand'
  // ---- v5.8 旋律扩展（B1 黑胶唱片机/八音盒） ----
  | 'vinyl'
  | 'musicBox'
  // ---- v5.9 节日限定（F1：按月份自动出现，商店不售） ----
  | 'xmasTree'
  | 'giftPile'
  | 'lantern'
  | 'springCouplet'
  | 'pumpkin'
  // ---- v5.9 阳台扩充（F4） ----
  | 'hammock'
  | 'bbq'
  | 'loungeOutdoor'
  | 'flowerBox'
  // ---- v5.9 墙面装饰（F5） ----
  | 'wallClock'
  | 'worldMap'
  | 'photoWallLove'
  // ---- v5.9 绿植系列（F6） ----
  | 'monstera'
  | 'cactus'
  | 'hydro'
  // ---- v5.9 毛绒伙伴（F7） ----
  | 'teddyBig'
  | 'pillowPile'
  | 'beanbagBlanket'
  // ---- v5.9 下午茶角（F8） ----
  | 'teaSet'
  | 'cakeStand'
  // ---- v6.1 留言板 + 娃娃机（G8 共享留言板 / G10 抓娃娃） ----
  | 'clawMachine'
  | 'noteBoard'
  // ---- v7.1 宠物小窝（猫窝：夜晚宠物自己回去睡觉） ----
  | 'petBed';

/** 家具分类（商店栏的 tab；set = 成套摆放 F3） */
export type FurnCategory =
  | 'all'
  | 'sofa'
  | 'table'
  | 'bed'
  | 'lamp'
  | 'plant'
  | 'appliance'
  | 'bathroom'
  | 'kitchen'
  | 'decor'
  | 'set';

/** 单件家具实例（持久化最小单元） */
export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  /** 世界坐标：底部中心 */
  x: number;
  z: number;
  /** 抬升（米）：电视上墙 / 小物件放上桌面 / 吊灯挂顶；默认 0 贴地 */
  y?: number;
  /** 水平旋转（弧度，任意角度；π = 面向北） */
  ry?: number;
  /** 俯仰旋转（弧度，钳 ±1.05 ≈ ±60°） */
  rx?: number;
  /** 用户自选主色（#rrggbb；undefined = 目录默认白色系） */
  col?: string;
  /** 家具私有状态（开关/门/洗衣等） */
  st: FurnitureState;
}

/** 房间标识（小人在哪个房间，商店家具就添到哪个房间；bal = 阳台 v5.7；sr = 书房 / yd = 花园 v10 扩建） */
export type RoomId = 'lr' | 'br' | 'kt' | 'ba' | 'bal' | 'sr' | 'yd';

/** 家具状态（按需可选字段） */
export interface FurnitureState {
  /** 灯 / 电视 / 收音机 / 空调 / 风扇 / 吊灯：开 = true */
  on?: boolean;
  /** 衣橱 / 冰箱 / 纸箱 / 洗衣机门：开 = true */
  open?: boolean;
  /** 洗衣机：运转中 */
  washing?: boolean;
  /** 洗衣机：洗好待取 */
  washDone?: boolean;
  /** 洗衣机：本次运转开始时间戳 */
  washStart?: number;
  /** playful 上次互动时间戳（弹跳冷却） */
  lastTouch?: number;
  /** 相框照片（压缩后 dataURL，永久保存在档案里） */
  photo?: string;
  /** 浴缸/淋浴：水龙头放水中 */
  bathWater?: boolean;
  /** 电视频道（0=关机不算，1..N 频道） */
  channel?: number;
  /** 鱼缸：上次投喂时间戳（Date.now()，6 秒内鱼加速聚食） */
  fedAt?: number;
  /** 咖啡机：煮咖啡中 */
  brewing?: boolean;
  /** 火锅桌：炉火开着（汤底沸腾冒泡）——复用 on 亦可，此字段预留 */
  simmer?: boolean;
  /** 棋盘桌：上一局的残局（编辑模式存档不丢） */
  chess?: number[];
  /** 灯具自选光色（#rrggbb；E7 灯光氛围：台灯/落地灯/星空灯可调，undefined = 目录默认暖光） */
  lc?: string;
  /** 娃娃机：上次抓中时间戳（Date.now()，冷却用） */
  lastClaw?: number;
  /** 猫窝自选窝色（#rrggbb；H3 宠物小窝装修：undefined = 目录默认樱粉） */
  bedColor?: string;
}

/** 小人身份（guest = 邀请来做客的 AI 联系人，v5.7） */
export type CharId = 'me' | 'partner';

/** 小人朝向（持久化 4 向） */
export type CharDir = 'up' | 'down' | 'left' | 'right';

/** 小人持久化状态 */
export interface CharState {
  id: CharId;
  x: number;
  z: number;
  dir: CharDir;
}

/** 三/四扇门沿墙坐标（卧室门/厨房门在 z=3 隔墙上沿 x 滑动；卫生间门在 x=7.5 墙上沿 z 滑动；bal = 阳台门 v5.7） */
export interface DoorPos {
  bed: number;
  kt: number;
  bath: number;
  bal?: number;
}

// ---------------- 女主衣柜（v6.2） ----------------

/** 女主发型：twin 双马尾 / high 高马尾 / bob 短发 / straight 黑长直 / wave 大波浪 */
export type GirlHairStyle = 'twin' | 'high' | 'bob' | 'straight' | 'wave';

/** 男生发型：smooth 顺滑短发 / fluffy 蓬松卷发 / middle 中分刘海 / spiky 活力刺猬 */
export type BoyHairStyle = 'smooth' | 'fluffy' | 'middle' | 'spiky';

/** 调色盘自选色：字段为 null/undefined = 用默认款色 */
export interface WearTints {
  hair?: string | null;
  dress?: string | null;
  top?: string | null;
  bottom?: string | null;
  shoes?: string | null;
}

/** 女主衣柜穿搭：dress ≥ 0 穿连衣裙（忽略 top/bottom），dress = -1 穿分体（上衣 + 裤/裙） */
export interface GirlWear {
  hair: GirlHairStyle;
  /** 连衣裙款号（-1 = 分体穿搭） */
  dress: number;
  /** 上衣款号（分体时生效） */
  top: number;
  /** 下装款号（分体时生效；0-1 裙 / 2 短裤 / 3 长裤） */
  bottom: number;
  /** 鞋子款号 */
  shoes: number;
  /** 调色盘自选色（缺省字段 = 用默认款色） */
  tints?: WearTints;
}

/** 默认穿搭：樱粉连衣裙 + 双马尾 + 棕色小皮鞋（与 v6.1 造型一致） */
export const DEFAULT_WEAR: GirlWear = { hair: 'twin', dress: 0, top: 0, bottom: 0, shoes: 0 };

/** 男生衣柜穿搭：发型 + 上衣 + 裤子 + 鞋子（款号对应 wardrobe-data 的 BOY_* 目录） */
export interface BoyWear {
  hair: BoyHairStyle;
  top: number;
  bottom: number;
  shoes: number;
  /** 调色盘自选色（缺省字段 = 用默认款色） */
  tints?: WearTints;
}

/** 默认男生穿搭：顺滑短发 + 奶白连帽卫衣 + 藏蓝短裤 + 白色圆头鞋（与 v6.2 造型一致） */
export const DEFAULT_BOY_WEAR: BoyWear = { hair: 'smooth', top: 0, bottom: 0, shoes: 0 };

/** 清洗调色盘自选色：仅接受 #rrggbb（统一转小写）；全部无效/为空 → undefined */
export function sanitizeTints(t: unknown): WearTints | undefined {
  const o = (t ?? {}) as Partial<WearTints>;
  const col = (v: unknown): string | null =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
  const hair = col(o.hair);
  const dress = col(o.dress);
  const top = col(o.top);
  const bottom = col(o.bottom);
  const shoes = col(o.shoes);
  const out: WearTints = {};
  if (hair) out.hair = hair;
  if (dress) out.dress = dress;
  if (top) out.top = top;
  if (bottom) out.bottom = bottom;
  if (shoes) out.shoes = shoes;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 归档非法数据 → 合法穿搭（防旧档/脏数据渲染崩溃） */
export function sanitizeWear(w: unknown): GirlWear {
  const HAIRS: GirlHairStyle[] = ['twin', 'high', 'bob', 'straight', 'wave'];
  const o = (w ?? {}) as Partial<GirlWear>;
  const idx = (v: unknown, max: number, dflt: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= -1 && v <= max ? Math.round(v) : dflt;
  return {
    hair: HAIRS.includes(o.hair as GirlHairStyle) ? (o.hair as GirlHairStyle) : 'twin',
    dress: idx(o.dress, 3, 0) === -1 ? -1 : Math.min(3, Math.max(0, idx(o.dress, 3, 0))),
    top: Math.min(3, Math.max(0, idx(o.top, 3, 0))),
    bottom: Math.min(3, Math.max(0, idx(o.bottom, 3, 0))),
    shoes: Math.min(3, Math.max(0, idx(o.shoes, 3, 0))),
    tints: sanitizeTints(o.tints),
  };
}

/** 归档非法数据 → 合法男生穿搭（款号钳 0..3，发型白名单，调色盘清洗） */
export function sanitizeBoyWear(w: unknown): BoyWear {
  const HAIRS: BoyHairStyle[] = ['smooth', 'fluffy', 'middle', 'spiky'];
  const o = (w ?? {}) as Partial<BoyWear>;
  const idx = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(3, Math.max(0, Math.round(v))) : 0;
  return {
    hair: HAIRS.includes(o.hair as BoyHairStyle) ? (o.hair as BoyHairStyle) : 'smooth',
    top: idx(o.top),
    bottom: idx(o.bottom),
    shoes: idx(o.shoes),
    tints: sanitizeTints(o.tints),
  };
}

/** 小家整体持久化数据（服务端 JSON 快照） */
export interface HomeState {
  /** 数据版本：5 = 3D 时代（四室一厅靠增量迁移，不换版本号） */
  v: 5;
  furniture: FurnitureItem[];
  chars: Record<CharId, { x: number; z: number; dir: CharDir }>;
  /** 昼夜：true = 夜晚 */
  night: boolean;
  /** 窗户开态（9 扇：客厅北×2 / 客厅西 / 卧室西 / 卧室南 / 厨房东 / 厨房南 / 卫生间北 / 卫生间东） */
  win?: boolean[];
  /** 每扇窗是否存在（false = 已被收起；缺省 = 全部存在；编辑模式可收起、商店可装回） */
  winExist?: boolean[];
  /** 每扇窗沿墙滑行坐标（undefined = 默认位） */
  winPos?: number[];
  /** 三扇门沿墙坐标（undefined = 默认位） */
  doorPos?: DoorPos;
  /** 地板自定义色（#rrggbb；缺省 = 默认云白；客厅） */
  floorCol?: string;
  /** 墙壁自定义色（#rrggbb；缺省 = 默认暖白；客厅） */
  wallCol?: string;
  /** 卧室地板自定义色 */
  floorColBed?: string;
  /** 卧室墙壁自定义色 */
  wallColBed?: string;
  /** 厨房地板自定义色 */
  floorColK?: string;
  /** 厨房墙壁自定义色 */
  wallColK?: string;
  /** 卫生间地板自定义色 */
  floorColB?: string;
  /** 卫生间墙壁自定义色 */
  wallColB?: string;
  /** 天花板自定义色（客厅/卧室/厨房/卫生间 分开换色） */
  ceilCol?: string;
  ceilColBed?: string;
  ceilColK?: string;
  ceilColB?: string;
  /** 卧室门开态（开 = 小人可以穿过门洞进出卧室） */
  doorOpen?: boolean;
  /** 厨房门开态 */
  kitchenDoorOpen?: boolean;
  /** 卫生间门开态 */
  bathDoorOpen?: boolean;
  /** 门自定义色（#rrggbb；缺省 = 默认暖白；全屋通用） */
  doorCol?: string;
  /** 窗框自定义色（#rrggbb；缺省 = 默认浅木白） */
  winCol?: string;
  /** 第一人称视角（true = 小人就是「我」） */
  fp?: boolean;
  /** 昼夜跟随真实时间（手动点太阳/月亮后变 false） */
  nightAuto?: boolean;
  /** 「我」正在进行的家具动作（重进页面恢复姿势；家具被删则忽略） */
  act?: { type: CharAction['type']; itemId: string };
  /** 「我」的穿搭编号（衣柜换装；0=默认，1/2=换色套装） */
  outfit?: number;
  /** 「我」的衣柜穿搭（v6.2：发型 + 连衣裙/分体上下装 + 鞋子） */
  wear?: GirlWear;
  /** 「对方」的衣柜穿搭（v6.3：男生发型 + 上衣/裤子/鞋子 + 调色盘） */
  wear2?: BoyWear;
  /** 地板纹理：wood = 木纹条（默认）/ plain = 素色 / check = 大格瓷砖（全屋通用、颜色仍分房间） */
  floorTex?: 'plain' | 'wood' | 'check';
  /** 墙面纹理：dot = 碎花 / stripe = 细条纹（缺省素色，全屋通用、颜色仍分房间） */
  wallTex?: 'plain' | 'dot' | 'stripe';
  /** 做饭系统：一桌好菜已上桌（去餐桌「开饭」） */
  mealReady?: boolean;
  /** 做饭小游戏：本次上桌的菜名（端上桌显示 + 开饭 toast） */
  mealName?: string;
  /** 阳台门开态（v5.7 阳台房间） */
  balconyDoorOpen?: boolean;
  /** 书房门开态（v10 客厅西墙门洞；缺省 = 关） */
  studyDoorOpen?: boolean;
  /** 花园栅栏门开态（v10 花园北栅栏；缺省 = 关） */
  gardenGateOpen?: boolean;
  /** 阳台地板/墙自定义色 */
  floorColBal?: string;
  wallColBal?: string;
  /** G1 多套装修方案：保存的整屋快照（最多 3 套；应用时整组切换、一步可撤销） */
  layouts?: LayoutSnap[];
  /** G8 共享留言板：留言（最多 50 条，新的在后） */
  notes?: NoteEntry[];
  /** G8 各自身份最后已读时间戳（毫秒）；进门提醒未读便签用 */
  notesSeen?: { me?: number; partner?: number };
  /** 宠物「团子」状态（v6.9：名字 + 体力/清洁/心情，跨会话持久化） */
  pet?: PetState;
  /** v8.3 第二只宠物（小狗/小兔子，C 选项；null/undefined = 还没领；v9 兼容字段 = pets2[0]） */
  pet2?: Pet2State;
  /** v9 领养宠物全家福（可领养无数只；pet2 为首只的兼容镜像） */
  pets2?: Pet2State[];
}

/**
 * 宠物毛色：v8.3 G 选项四预设（奶油/橘/灰/奶牛）之外，
 * v9 调色盘支持任意 #rrggbb（`string & {}` 保留字面量提示，预设名照常工作）。
 */
export type PetCoat = 'cream' | 'orange' | 'gray' | 'cow' | (string & {});

/** v9 小屋天气（真实天气 API + 时间变化共同驱动室外世界）：晴 / 多云 / 阴 / 雨 / 雪 */
export type HomeWeather = 'sunny' | 'cloudy' | 'overcast' | 'rain' | 'snow';

/** 宠物装扮（v8.3 B 选项：项圈颜色 / 小围巾 / 蝴蝶结；scarf/bow 为 null = 不戴，色值 = 戴+颜色） */
export interface PetWear {
  /** 项圈颜色（#rrggbb；缺省 = 默认樱红 #e46a6a） */
  collar?: string;
  /** 小围巾（null = 不戴；色值 = 戴上） */
  scarf?: string | null;
  /** 蝴蝶结（null = 不戴；色值 = 戴上，戴在耳边） */
  bow?: string | null;
}

/** 宠物成长/装扮持久化字段（v8.3：since 收养时间 / care 累计照顾次数 / coat 毛色 / wear 装扮；v10 C2：train 把戏训练次数） */
export interface PetExtra {
  /** 收养时刻（毫秒；成长系统按陪伴天数升级） */
  since?: number;
  /** 累计照顾/互动次数（升级经验） */
  care?: number;
  /** 毛色（缺省 = 奶油猫） */
  coat?: PetCoat;
  /** 装扮（项圈/围巾/蝴蝶结） */
  wear?: PetWear;
  /** v10 C2 训练系统：把戏名（shake/spin/roll/dead）→ 练习次数（熟练度） */
  train?: Record<string, number>;
}

/**
 * 领养宠物（小狗/小兔子；v9 起可领养无数只，存进 HomeState.pets2 数组）。
 * v9 全功能化：与「团子」同权 —— 体力/清洁/心情 + 成长 + 毛色/装扮全量支持
 * （可选字段向后兼容旧存档：缺省时用默认值补齐）。
 */
export interface Pet2State extends PetExtra {
  kind: 'dog' | 'rabbit';
  name?: string;
  /** 收养时刻 */
  since?: number;
  /** 体力（喂食回复；缺省 88） */
  st?: number;
  /** 清洁（喂水回复；缺省 88） */
  cl?: number;
  /** 心情（抚摸回复；缺省 90） */
  mo?: number;
  /** 最后结算时间戳（毫秒；离线衰减用） */
  ts?: number;
}

/** 宠物状态（体力/清洁/心情 0~100，ts = 最后结算时间戳，用于离线衰减；v8.3 继承成长/毛色/装扮字段；v9 kind 供统一面板渲染） */
export interface PetState extends PetExtra {
  /** 物种（v9：猫缺省；领养宠物为 dog/rabbit，统一面板渲染用） */
  kind?: 'cat' | 'dog' | 'rabbit';
  /** 名字（最长 8 字，默认「团子」） */
  name?: string;
  /** 体力（喂食回复） */
  st: number;
  /** 清洁（喂水回复） */
  cl: number;
  /** 心情（抚摸回复） */
  mo: number;
  /** 最后结算时间戳（毫秒） */
  ts: number;
}

/** 宠物照顾动作种类（v7.0：+洗澡 / 抱抱 / 召唤；v8.3 成长解锁：+握手 / 转圈 / 打滚；+玩具球；v10 C2：+装死训练；v11 I1：+挠痒痒） */
export type PetCareKind = 'pat' | 'feed' | 'water' | 'bath' | 'hug' | 'summon' | 'shake' | 'spin' | 'roll' | 'ball' | 'dead' | 'tickle';

/** G1 装修方案快照（家具整组 + 各房间地板/墙色；不含照片 —— 相框照片不随方案备份，控制存档体积） */
export interface LayoutSnap {
  /** 方案名（方案A/B/C…最长 12 字） */
  name: string;
  /** 保存时间戳 */
  ts: number;
  furniture: FurnitureItem[];
  floorCol?: string;
  wallCol?: string;
  floorColBed?: string;
  wallColBed?: string;
  floorColK?: string;
  wallColK?: string;
  floorColB?: string;
  wallColB?: string;
  floorColBal?: string;
  wallColBal?: string;
}

/** G8 留言板单条便签 */
export interface NoteEntry {
  id: string;
  /** 正文（最长 120 字） */
  text: string;
  /** 创建时间戳（毫秒） */
  ts: number;
  /** 留言人身份 */
  by: 'me' | 'partner';
}

/** 家具目录条目（静态配置，不持久化） */
export interface CatalogEntry {
  kind: FurnitureKind;
  /** GLB 路径（程序化建模的没有） */
  glb?: string;
  /** 开门态 GLB（纸箱这类无独立门节点的换模型） */
  glbAlt?: string;
  name: string;
  cat: FurnCategory;
  /** 占位脚印（世界米，未旋转时 x×z，已含 MODEL_SCALE 与 scale） */
  fp: [number, number];
  /** 非均匀缩放（xyz 各轴乘子，在 MODEL_SCALE 之上；用于拉宽电视柜等单件适配） */
  scale?: [number, number, number];
  /** 非客厅家具：商店暂不展示 */
  hidden?: boolean;
  /** 挂墙件（相框/插座/电视）：购买/拖拽后自动吸附到最近的墙 */
  wallMount?: boolean;
  /** 挂墙件的默认挂高（米；缺省 1.45） */
  wallY?: number;
  /** 家具实测高度（米，用于挂墙件避让高家具） */
  h?: number;
  /** 交互能力 */
  acts: {
    /** 点击开/关（灯、电视、收音机、空调、风扇、吊灯、淋浴、壁炉、星空灯） */
    toggle?: boolean;
    /** 可开门（有 door 节点或 glbAlt） */
    door?: boolean;
    /** 洗衣机专属流程 */
    washer?: boolean;
    /** 点击弹跳 */
    playful?: boolean;
    /** 相框：点击从手机上传照片 */
    photo?: boolean;
    /** 投喂（鱼缸）：点一下撒鱼食，6 秒鱼群聚食 */
    feed?: boolean;
    /** 照镜子：小人走过去对镜自照（微微摆 pose） */
    mirror?: { y?: number; dx?: number; dz?: number; out?: [number, number] };
    /** 做饭：小人走到灶台前颠勺，数秒后一桌好菜上餐桌 */
    cook?: { y: number; dx?: number; dz?: number; out?: [number, number] };
    /** 开饭：饭菜已上桌，小人坐到餐桌边吃饭（按钮变「吃饱啦」）；ryOff = 朝向偏移（坐东缘面朝桌心） */
    eat?: { y: number; dx?: number; dz?: number; ryOff?: number; out?: [number, number] };
    /** 喝东西：小人走到冰箱前拿杯喝的（自动开门，喝完自动结束） */
    drink?: { y: number; dx?: number; dz?: number; out?: [number, number] };
    /** 换装：小人走到衣柜前换一套穿搭（自动开门，换完自动结束） */
    dress?: { y?: number; dx?: number; dz?: number; out?: [number, number] };
    /** 演奏乐器：piano 坐琴凳弹 / guitar 站着抱琴弹（音符飘出） */
    play?: { y: number; dx?: number; dz?: number; ryOff?: number; out?: [number, number] };
    /** 化妆：小人坐到梳妆台前补妆（星星特效） */
    makeup?: { y: number; dx?: number; dz?: number; out?: [number, number] };
    /** 可坐：点击出「坐下」按钮，小人走过去坐下（按钮变「站起来」） */
    seat?: { y: number; dx?: number; dz?: number };
    /** 可睡：点击出「睡觉」按钮，小人走过去躺上床（按钮变「起床」，头朝枕头 + Zzz 特效）；
     *  ryOff = 躺下朝向偏移（吊床等长轴沿 x 的家具用，让小人躺在长轴上而非横跨）；
     *  out = 起身落点（局部坐标，锚点缺省时用） */
    sleep?: { y: number; dz?: number; ryOff?: number; out?: [number, number] };
    /**
     * 可泡澡/淋浴：小人脱衣走进浴缸或淋浴房（按钮变「出来」）；out = 起身落点（局部坐标）；
     * stand = 站姿淋浴（花洒自动开水）；ryOff = 朝向偏移；浴缸水龙头可放水
     */
    bath?: {
      y: number;
      dx?: number;
      dz?: number;
      stand?: boolean;
      ryOff?: number;
      out?: [number, number];
    };
    /** 可看：点击出「看电视」按钮，小人坐到电视前地板上（电视自动开机，按钮变「关电视」） */
    watch?: { y: number; dz?: number };
    /** 可用：点击出「上网」按钮，小人坐到电脑前敲键盘（屏幕自动亮起，按钮变「休息一下」） */
    work?: { y: number; dz?: number };
    /** 打游戏：小人走到主机前坐下开玩（同 work 的坐姿；屏幕/电视自动亮） */
    game?: { y: number; dz?: number };
    /** 端一杯咖啡：小人走到咖啡机前煮一杯端着逛（热气袅袅，同 drink 的自由走动） */
    coffee?: { y: number; dx?: number; dz?: number; out?: [number, number] };
    /** 阅读：书架标记（点击抽一本书，走到最近的沙发/椅子坐下翻页看） */
    read?: boolean;
    /** 吃火锅：小人坐到火锅桌边涮火锅（炉火自动开，吃到饱手动起身）；ryOff = 朝向偏移（坐东缘面朝锅） */
    hotpot?: { y: number; dx?: number; dz?: number; ryOff?: number; out?: [number, number] };
  };
  /** 是灯具：开着时附加点光（y 为相对家具原点的灯高） */
  light?: { y: number; color?: string; intensity?: number };
  /** 模型朝向微调（弧度，绕 Y） */
  yaw?: number;
  /** 贴地物（地毯/地垫）：渲染在地面之上、无碰撞 */
  flat?: boolean;
}

/** 运行时小人（ref 中高频更新，不入 React state） */
export interface CharRT {
  x: number;
  z: number;
  /** 朝向弧度（atan2(vx, vz)，0 = 面 +z） */
  heading: number;
  moving: boolean;
  /** 漫游目标（partner/宠物用） */
  target: { x: number; z: number } | null;
  nextWander: number;
  /** 跨房间路径点（v7.1：穿门走廊的中间路点，走完一个 shift 一个；空/缺省 = 直线走向 target） */
  route?: { x: number; z: number }[];
}

/**
 * 小人姿势：站立 / 坐下 / 躺床 / 泡澡（脱衣坐浴缸）/ 淋浴（脱衣站淋浴房）/
 * 做饭 / 吃饭 / 喝东西 / 弹琴 / 弹吉他 / 化妆 / 照镜子（game 复用 sit）/ 坐着看书
 */
export type CharPose =
  | 'stand'
  | 'sit'
  | 'lie'
  | 'bath'
  | 'shower'
  | 'cook'
  | 'eat'
  | 'drink'
  | 'piano'
  | 'guitar'
  | 'makeup'
  | 'mirror'
  | 'read'
  | 'petcare'
  // —— v8.0 陪伴交互（拾光小屋）：拥抱 / 牵手（双方通用姿势） ——
  | 'hug'
  | 'holdhand'
  // —— v10 决策大脑新姿势：跳舞 / 伸懒腰 / 浇花 ——
  | 'dance'
  | 'stretch'
  | 'water';

/** 小人正在执行的家具动作（走向家具 → 摆姿势） */
export interface CharAction {
  type:
    | 'sit'
    | 'lie'
    | 'bath'
    | 'shower'
    | 'watch'
    | 'work'
    | 'cook'
    | 'eat'
    | 'drink'
    | 'play'
    | 'makeup'
    | 'mirror'
    | 'dress'
    | 'game'
    | 'hotpot'
    | 'coffee'
    | 'read';
  itemId: string;
  /** 目标落点（世界坐标）与朝向、坐垫高度 */
  tx: number;
  tz: number;
  ry: number;
  y: number;
  /** 起身落点（世界坐标；结束动作时小人自然走下家具落在这里） */
  ox?: number;
  oz?: number;
  /** 已走到位（姿势已摆好） */
  arrived?: boolean;
  /** 到位后摆的姿势（缺省按 type 查 POSE_OF_ACT；play 乐器按 kind 分流钢琴/吉他） */
  pose?: CharPose;
  /** 走到位后的回调（GameLoop 触发一次；拿饮料 → 开门取杯进入「端着逛」模式） */
  onArrive?: () => void;
}

/** 模式 */
export type HomeMode = 'live' | 'edit';
