import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sanitizeBoyWear, sanitizeTints, type BoyWear, type WearTints } from '@/components/apps/couple-home/types';

export const runtime = 'nodejs';

/**
 * 情侣小家 3D 持久化 API（Prisma 单行快照，按浏览器工作区隔离）
 *
 * - GET  → { data: HomeState | null, rev: number }（无档案时 data=null，客户端播默认布局）
 * - POST → 保存全量快照 { data, rev }（乐观并发：rev 不匹配返回 409 + 服务端最新版，客户端采纳服务端）
 *          { action: 'reset' } → 删除档案（客户端重新播种默认布局）
 *
 * 校验策略：结构宽松但逐字段清洗（条数/坐标/角度/颜色钳制），防止任意大 payload 与坐标穿模。
 * 3D 坐标系：房间中心为原点，坐标可为负（±20 米钳制）；金币系统已移除（列保留恒 0）。
 */

interface FurnItem {
  id: string;
  kind: string;
  x: number;
  z: number;
  /** 抬升（米）：电视上墙 / 小物上桌 */
  y?: number;
  /** 水平旋转（弧度，任意角度） */
  ry?: number;
  /** 俯仰旋转（弧度，±~60°） */
  rx?: number;
  /** 用户自选主色（#rrggbb） */
  col?: string;
  st?: Record<string, unknown>;
}

interface HomePayload {
  v: number;
  furniture: FurnItem[];
  chars: Record<string, { x: number; z: number; dir?: string }>;
  night?: boolean;
  /** 窗户开态（最多 8 扇） */
  win?: boolean[];
  /** 每扇窗是否存在（false = 已被收起；缺省 = 全部存在） */
  winExist?: boolean[];
  /** 地板自定义色（#rrggbb；客厅） */
  floorCol?: string;
  /** 墙壁自定义色（#rrggbb；客厅） */
  wallCol?: string;
  /** 卧室地板自定义色（#rrggbb；客厅卧室分开换色） */
  floorColBed?: string;
  /** 卧室墙壁自定义色（#rrggbb；客厅卧室分开换色） */
  wallColBed?: string;
  /** 卧室门开态 */
  doorOpen?: boolean;
  /** 厨房门开态 */
  kitchenDoorOpen?: boolean;
  /** 卫生间门开态 */
  bathDoorOpen?: boolean;
  /** 门自定义色（#rrggbb） */
  doorCol?: string;
  /** 窗框自定义色（#rrggbb） */
  winCol?: string;
  /** 厨房地板/墙自定义色（#rrggbb；四房间分开换色） */
  floorColK?: string;
  wallColK?: string;
  /** 卫生间地板/墙自定义色 */
  floorColB?: string;
  wallColB?: string;
  /** 天花板自定义色（四房间分开） */
  ceilCol?: string;
  ceilColBed?: string;
  ceilColK?: string;
  ceilColB?: string;
  /** 每扇窗沿墙坐标（≤12 个） */
  winPos?: number[];
  /** 四扇门沿墙坐标 */
  doorPos?: { bed?: number; kt?: number; bath?: number; bal?: number };
  /** 第一人称视角 */
  fp?: boolean;
  /** 昼夜跟随真实时间 */
  nightAuto?: boolean;
  /** 「我」的穿搭编号（衣柜换装） */
  outfit?: number;
  /** 「我」的衣柜穿搭（v6.2：发型 + 连衣裙/分体 + 鞋） */
  wear?: {
    hair?: string;
    dress?: number;
    top?: number;
    bottom?: number;
    shoes?: number;
    tints?: WearTints;
  };
  /** 「对方」的衣柜穿搭（v6.3：男生发型 + 上衣/裤子 + 鞋） */
  wear2?: BoyWear;
  /** 做饭系统：一桌好菜已上桌 */
  mealReady?: boolean;
  /** 做饭小游戏：本次上桌的菜名 */
  mealName?: string;
  /** 阳台门开态（v5.7） */
  balconyDoorOpen?: boolean;
  /** 阳台地板/墙自定义色 */
  floorColBal?: string;
  wallColBal?: string;
  /** 地板纹理 */
  floorTex?: string;
  /** 墙纸纹理 */
  wallTex?: string;
  /** 「我」正在进行的家具动作（重进页面恢复姿势） */
  act?: { type?: string; itemId?: string };
  /** G1 装修方案快照（≤3 套；家具内照片不随方案备份） */
  layouts?: {
    name?: string;
    ts?: number;
    furniture?: FurnItem[];
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
  }[];
  /** G8 留言板便签（≤50 条） */
  notes?: { id?: string; text?: string; ts?: number; by?: string }[];
  /** G8 已读时间戳 */
  notesSeen?: { me?: number; partner?: number };
}

const MAX_ITEMS = 240;
/** 3D 世界坐标绝对值上限（米） */
const MAX_COORD = 20;
/** 相框照片放大后总快照上限（每张照片压缩后约 20~50KB，最多 12 张） */
const MAX_JSON = 1536 * 1024;
/** 单件家具状态（含照片 dataURL）上限 */
const MAX_ST = 320 * 1024;
/** 相框照片数量上限 */
const MAX_PHOTOS = 12;

/** 有符号坐标清洗：钳到 [-max, max]，非法返回 null */
function clampCoord(v: unknown, max = MAX_COORD): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(-max, Math.min(max, Math.round(n * 100) / 100));
}

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cleanStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** 弧度清洗：钳到 [-π, π]（非法返回 null） */
function clampRad(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(-max, Math.min(max, Math.round(n * 1000) / 1000));
}

/** 用户色清洗：仅接受 #rrggbb */
function cleanHex(v: unknown): string | undefined {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined;
}

const DIRS = new Set(['up', 'down', 'left', 'right']);
/** 可持久化的家具动作类型（与前端 CharAction 对齐） */
const ACT_TYPES = new Set([
  'sit', 'lie', 'bath', 'shower', 'watch', 'work',
  'cook', 'eat', 'drink', 'dress', 'play', 'makeup', 'mirror',
  'game', 'hotpot', 'coffee', 'read',
]);
const FLOOR_TEXES = new Set(['plain', 'wood', 'check']);
const WALL_TEXES = new Set(['plain', 'dot', 'stripe']);

/** 单件家具清洗（家具表与回收站共用；photoCounter 跨件累计相框照片数） */
function cleanFurnItem(
  f: Record<string, unknown>,
  photoCounter: { n: number },
): FurnItem | null {
  const x = clampCoord(f.x);
  const z = clampCoord(f.z);
  const id = cleanStr(f.id, 64);
  const kind = cleanStr(f.kind, 24);
  if (x == null || z == null || !id || !kind) return null;
  const ry = clampRad(f.ry, Math.PI);
  const rx = clampRad(f.rx, 1.1);
  const y = clampCoord(f.y, 2.4);
  const col = cleanHex(f.col);
  let st: Record<string, unknown> = {};
  if (f.st && typeof f.st === 'object' && !Array.isArray(f.st)) {
    const rawSt = f.st as Record<string, unknown>;
    if (JSON.stringify(rawSt).length <= MAX_ST) {
      st = rawSt;
      // 相框照片：总数限 12 张，超额剩掉照片字段
      if (typeof st.photo === 'string') {
        if (photoCounter.n >= MAX_PHOTOS || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(st.photo)) {
          const clone = { ...st };
          delete clone.photo;
          st = clone;
        } else {
          photoCounter.n++;
        }
      }
    }
  }
  return { id, kind, x, z, ry: ry ?? 0, rx: rx ?? 0, y: y ?? 0, col, st };
}

/** 宽松清洗 HomeState（3D 版 v5 两室一厅）；结构不合法返回 null */
function normalizeHome(raw: unknown): HomePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.furniture)) return null;
  const furniture: FurnItem[] = [];
  const photoCounter = { n: 0 };
  for (const it of r.furniture.slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== 'object') continue;
    const cleaned = cleanFurnItem(it as Record<string, unknown>, photoCounter);
    if (cleaned) furniture.push(cleaned);
  }
  if (furniture.length === 0 && r.furniture.length > 0) return null;
  const chars: HomePayload['chars'] = {};
  if (r.chars && typeof r.chars === 'object') {
    for (const [key, val] of Object.entries(r.chars as Record<string, unknown>).slice(0, 4)) {
      if (!val || typeof val !== 'object') continue;
      const c = val as Record<string, unknown>;
      const x = clampCoord(c.x);
      const z = clampCoord(c.z);
      if (x == null || z == null) continue;
      const dir = typeof c.dir === 'string' && DIRS.has(c.dir) ? c.dir : undefined;
      chars[key] = { x, z, dir };
    }
  }
  if (!chars.me || !chars.partner) return null;
  // 窗户开态：最多 12 扇布尔值
  let win: boolean[] | undefined;
  if (Array.isArray(r.win)) {
    win = r.win.slice(0, 12).map((w) => w === true);
  }
  // 窗户存在态：最多 12 扇（false = 已收起；未传 = 全部存在）
  let winExist: boolean[] | undefined;
  if (Array.isArray(r.winExist)) {
    winExist = r.winExist.slice(0, 12).map((w) => w === true);
  }
  // 每扇窗沿墙坐标
  let winPos: number[] | undefined;
  if (Array.isArray(r.winPos)) {
    const arr = r.winPos.slice(0, 12)
      .map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-30, Math.min(30, Math.round(v * 100) / 100)) : null));
    if (arr.some((v) => v != null)) winPos = arr.map((v) => v ?? 0);
  }
  // 三扇门沿墙坐标
  let doorPos: HomePayload['doorPos'] | undefined;
  if (r.doorPos && typeof r.doorPos === 'object' && !Array.isArray(r.doorPos)) {
    const d = r.doorPos as Record<string, unknown>;
    const clean = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(-30, Math.min(30, Math.round(v * 100) / 100)) : undefined;
    const bed = clean(d.bed);
    const kt = clean(d.kt);
    const bath = clean(d.bath);
    const bal = clean(d.bal);
    if (bed != null || kt != null || bath != null || bal != null) doorPos = { bed, kt, bath, bal };
  }
  // 「我」正在进行的家具动作（类型白名单 + 家具 id 截断；不合法直接丢）
  let act: HomePayload['act'] | undefined;
  if (r.act && typeof r.act === 'object' && !Array.isArray(r.act)) {
    const a = r.act as Record<string, unknown>;
    const type = typeof a.type === 'string' && ACT_TYPES.has(a.type) ? a.type : undefined;
    const itemId = cleanStr(a.itemId, 64) || undefined;
    if (type && itemId) act = { type, itemId };
  }
  // —— 回收站已下线：撤销/重做走前端快照栈 ——
  return {
    v: typeof r.v === 'number' ? r.v : 5,
    furniture,
    chars,
    night: r.night === true,
    win,
    winExist,
    winPos,
    doorPos,
    floorCol: cleanHex(r.floorCol),
    wallCol: cleanHex(r.wallCol),
    floorColBed: cleanHex(r.floorColBed),
    wallColBed: cleanHex(r.wallColBed),
    doorOpen: r.doorOpen === true,
    kitchenDoorOpen: r.kitchenDoorOpen === true,
    bathDoorOpen: r.bathDoorOpen === true,
    doorCol: cleanHex(r.doorCol),
    winCol: cleanHex(r.winCol),
    floorColK: cleanHex(r.floorColK),
    wallColK: cleanHex(r.wallColK),
    floorColB: cleanHex(r.floorColB),
    wallColB: cleanHex(r.wallColB),
    ceilCol: cleanHex(r.ceilCol),
    ceilColBed: cleanHex(r.ceilColBed),
    ceilColK: cleanHex(r.ceilColK),
    ceilColB: cleanHex(r.ceilColB),
    fp: r.fp === true,
    nightAuto: r.nightAuto !== false,
    outfit: clampInt(r.outfit, 0, 9) ?? undefined,
    ...cleanWear(r.wear),
    ...cleanWear2(r.wear2),
    mealReady: r.mealReady === true,
    mealName: cleanStr(r.mealName, 16) || undefined,
    balconyDoorOpen: r.balconyDoorOpen === true,
    floorColBal: cleanHex(r.floorColBal),
    wallColBal: cleanHex(r.wallColBal),
    floorTex: typeof r.floorTex === 'string' && FLOOR_TEXES.has(r.floorTex) ? r.floorTex : undefined,
    wallTex: typeof r.wallTex === 'string' && WALL_TEXES.has(r.wallTex) ? r.wallTex : undefined,
    act,
    ...cleanG1G8(r, photoCounter),
  };
}

/** 女主衣柜穿搭清洗（v6.2）：发型白名单 + 款号钳制 + 调色盘清洗 */
const HAIR_STYLES = new Set(['twin', 'high', 'bob', 'straight', 'wave']);
function cleanWear(raw: unknown): Pick<HomePayload, 'wear'> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const w = raw as Record<string, unknown>;
  const hair = typeof w.hair === 'string' && HAIR_STYLES.has(w.hair) ? w.hair : undefined;
  const dress = clampInt(w.dress, -1, 8);
  const top = clampInt(w.top, 0, 8);
  const bottom = clampInt(w.bottom, 0, 8);
  const shoes = clampInt(w.shoes, 0, 8);
  const tints = sanitizeTints(w.tints);
  if (hair == null && dress == null && top == null && bottom == null && shoes == null && !tints) return {};
  return {
    wear: {
      hair: hair ?? 'twin',
      dress: dress ?? 0,
      top: top ?? 0,
      bottom: bottom ?? 0,
      shoes: shoes ?? 0,
      ...(tints ? { tints } : {}),
    },
  };
}

/** 男生衣柜穿搭清洗（v6.3）：走 types 的归档清洗器（发型白名单 + 款号钳 0..3 + 调色盘） */
function cleanWear2(raw: unknown): Pick<HomePayload, 'wear2'> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const w = raw as Record<string, unknown>;
  const hasAny =
    typeof w.hair === 'string' ||
    typeof w.top === 'number' ||
    typeof w.bottom === 'number' ||
    typeof w.shoes === 'number' ||
    (w.tints != null && typeof w.tints === 'object' && !Array.isArray(w.tints));
  if (!hasAny) return {};
  return { wear2: sanitizeBoyWear(w) };
}

/** G1/G8 扩展字段清洗：装修方案（≤3 套，照片不备份）/ 留言板便签（≤50 条）/ 已读时间戳 */
function cleanG1G8(r: Record<string, unknown>, photoCounter: { n: number }): Pick<HomePayload, 'layouts' | 'notes' | 'notesSeen'> {
  const out: Pick<HomePayload, 'layouts' | 'notes' | 'notesSeen'> = {};
  // 装修方案：整组家具走同一清洗器（photoCounter 传入但照片一律剔除，避免存档翻倍）
  if (Array.isArray(r.layouts)) {
    const layouts: NonNullable<HomePayload['layouts']> = [];
    for (const raw of r.layouts.slice(0, 3)) {
      if (!raw || typeof raw !== 'object') continue;
      const l = raw as Record<string, unknown>;
      if (!Array.isArray(l.furniture)) continue;
      const furniture: FurnItem[] = [];
      for (const it of l.furniture.slice(0, MAX_ITEMS)) {
        if (!it || typeof it !== 'object') continue;
        const cleaned = cleanFurnItem(it as Record<string, unknown>, photoCounter);
        if (!cleaned) continue;
        if (cleaned.st && typeof cleaned.st === 'object' && 'photo' in cleaned.st) {
          const clone = { ...cleaned.st };
          delete clone.photo; // 方案不备份照片，控存档体积
          cleaned.st = clone;
        }
        furniture.push(cleaned);
      }
      layouts.push({
        name: cleanStr(l.name, 12) || '未命名方案',
        ts: clampInt(l.ts, 0, Number.MAX_SAFE_INTEGER) ?? 0,
        furniture,
        floorCol: cleanHex(l.floorCol),
        wallCol: cleanHex(l.wallCol),
        floorColBed: cleanHex(l.floorColBed),
        wallColBed: cleanHex(l.wallColBed),
        floorColK: cleanHex(l.floorColK),
        wallColK: cleanHex(l.wallColK),
        floorColB: cleanHex(l.floorColB),
        wallColB: cleanHex(l.wallColB),
        floorColBal: cleanHex(l.floorColBal),
        wallColBal: cleanHex(l.wallColBal),
      });
    }
    if (layouts.length) out.layouts = layouts;
  }
  // 留言板便签
  if (Array.isArray(r.notes)) {
    const notes: NonNullable<HomePayload['notes']> = [];
    for (const raw of r.notes.slice(-50)) {
      if (!raw || typeof raw !== 'object') continue;
      const n = raw as Record<string, unknown>;
      const id = cleanStr(n.id, 40);
      const text = cleanStr(n.text, 120);
      const ts = clampInt(n.ts, 0, Number.MAX_SAFE_INTEGER);
      const by = n.by === 'me' || n.by === 'partner' ? n.by : undefined;
      if (!id || !text || ts == null || !by) continue;
      notes.push({ id, text, ts, by });
    }
    if (notes.length) out.notes = notes;
  }
  // 已读时间戳
  if (r.notesSeen && typeof r.notesSeen === 'object' && !Array.isArray(r.notesSeen)) {
    const s = r.notesSeen as Record<string, unknown>;
    const me = clampInt(s.me, 0, Number.MAX_SAFE_INTEGER);
    const partner = clampInt(s.partner, 0, Number.MAX_SAFE_INTEGER);
    if (me != null || partner != null) out.notesSeen = { me: me ?? undefined, partner: partner ?? undefined };
  }
  return out;
}

function wsOf(req: NextRequest): string {
  const raw = req.headers.get('x-workspace-id')?.trim();
  return raw ? raw.slice(0, 64) : 'default';
}

export async function GET(req: NextRequest) {
  try {
    const row = await db.coupleHome.findUnique({ where: { workspaceId: wsOf(req) } });
    if (!row) return NextResponse.json({ data: null, rev: 0 });
    return NextResponse.json({
      data: normalizeHome(JSON.parse(row.data)),
      rev: row.rev,
    });
  } catch {
    return NextResponse.json({ error: 'db-error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const workspaceId = wsOf(req);

  // 重置：删档（客户端随后重新播种默认布局）
  if (body.action === 'reset') {
    try {
      await db.coupleHome.delete({ where: { workspaceId } }).catch(() => null);
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: 'db-error' }, { status: 500 });
    }
  }

  const home = normalizeHome(body.data);
  if (!home) return NextResponse.json({ error: 'bad-data' }, { status: 400 });
  const clientRev = clampInt(body.rev, 0, 1_000_000) ?? 0;
  const dataStr = JSON.stringify(home);
  if (dataStr.length > MAX_JSON) return NextResponse.json({ error: 'too-large' }, { status: 413 });

  try {
    // 乐观并发：仅当服务端存的是「同代（v5）合法数据」且 rev 不一致 → 409 + 回带服务端最新（客户端采纳）；
    // 服务端若存的是旧格式（v4 / 2D 时代 / 损坏数据），直接用新快照覆盖完成迁移。
    const existing = await db.coupleHome.findUnique({ where: { workspaceId } });
    if (existing) {
      let serverVer = 0;
      try {
        serverVer = (JSON.parse(existing.data) as { v?: number }).v ?? 0;
      } catch {
        serverVer = 0;
      }
      const serverHome = serverVer === 5 ? normalizeHome(JSON.parse(existing.data)) : null;
      if (serverHome && existing.rev !== clientRev) {
        return NextResponse.json(
          {
            conflict: true,
            data: serverHome,
            rev: existing.rev,
          },
          { status: 409 },
        );
      }
    }
    const row = await db.coupleHome.upsert({
      where: { workspaceId },
      create: { workspaceId, data: dataStr, coins: 0, rev: 1 },
      update: { data: dataStr, coins: 0, rev: { increment: 1 } },
    });
    return NextResponse.json({ ok: true, rev: row.rev });
  } catch {
    return NextResponse.json({ error: 'db-error' }, { status: 500 });
  }
}
