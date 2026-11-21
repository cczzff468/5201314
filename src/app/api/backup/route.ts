import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * 服务端备份 / 恢复（设置 › 储存空间 › 备份与恢复，随全量备份 JSON 文件的 server 段一起走）：
 * - GET  导出「用户可见」的库表全量行：情侣小家快照（CoupleHome，按工作区隔离的 3D 家快照）
 *   + 联系人 / 微信背景（Contact / WxBackground——本地化迁移前的服务端存量，未迁移浏览器的兜底数据）；
 * - POST 以备份为准 upsert 回写（键冲突备份覆盖；结构不合法的行丢弃，不阻塞其余行）。
 * 不入备份：StickerSearchCache（24h 爬取缓存，可再生）、User / Post（脚手架演示表，无用户数据）。
 */

/** 单表行数上限（防异常大 payload 拖垮恢复） */
const MAX_ROWS = 5000;
/** 单行字符串字段上限（与 couple-home 快照 JSON 上限同量级） */
const MAX_DATA_BYTES = 2 * 1024 * 1024;

function strOf(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

/** coupleHome 行：workspaceId + 快照 JSON 原样字符串 + rev（coins 列已废弃恒 0） */
interface CoupleHomeRow {
  workspaceId: string;
  data: string;
  coins: number;
  rev: number;
}

function cleanCoupleHome(raw: unknown): CoupleHomeRow | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const workspaceId = strOf(r.workspaceId, 64);
  const data = strOf(r.data, MAX_DATA_BYTES);
  if (!workspaceId || !data) return null;
  const rev = typeof r.rev === 'number' && Number.isFinite(r.rev) ? Math.max(0, Math.round(r.rev)) : 0;
  return { workspaceId, data, coins: 0, rev };
}

/** wxBackground 行：key + dataURL 字符串 */
function cleanWxBackground(raw: unknown): { key: string; data: string } | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = strOf(r.key, 64);
  const data = strOf(r.data, MAX_DATA_BYTES);
  return key && data ? { key, data } : null;
}

/** Contact 行：只收模型已知字段（未知字段丢弃，防 Prisma 未知列报错）；缺必填字段整行丢弃 */
interface ContactRow {
  id: string;
  kind: string;
  name: string;
  ownerId?: string;
  gender?: string;
  age?: string;
  height?: string;
  weight?: string;
  persona?: string;
  background?: string;
  occupation?: string;
  company?: string;
  region?: string;
  relation?: string;
  phone?: string;
  wechatId?: string;
  wechatPassword?: string;
  qqId?: string;
  qqPassword?: string;
  avatar?: string;
  isFriend?: boolean;
  workspaceId?: string;
  createdAt?: string;
  updatedAt?: string;
}

const CONTACT_STR_FIELDS = [
  'ownerId',
  'gender',
  'age',
  'height',
  'weight',
  'persona',
  'background',
  'occupation',
  'company',
  'region',
  'relation',
  'phone',
  'wechatId',
  'wechatPassword',
  'qqId',
  'qqPassword',
  'avatar',
  'workspaceId',
] as const;

function cleanContact(raw: unknown): ContactRow | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = strOf(r.id, 64);
  const kind = strOf(r.kind, 16);
  const name = strOf(r.name, 128);
  if (!id || !kind || !name) return null;
  const row: ContactRow = { id, kind, name };
  for (const f of CONTACT_STR_FIELDS) {
    const v = r[f];
    if (typeof v === 'string' && v.length <= MAX_DATA_BYTES) row[f] = v;
  }
  if (typeof r.isFriend === 'boolean') row.isFriend = r.isFriend;
  // 时间字段：接受 ISO 字符串（GET 导出即字符串；非法值丢弃交由 Prisma 默认值）
  for (const f of ['createdAt', 'updatedAt'] as const) {
    const v = r[f];
    if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) row[f] = v;
  }
  return row;
}

export async function GET() {
  try {
    const [coupleHome, contacts, wxBackgrounds] = await Promise.all([
      db.coupleHome.findMany(),
      db.contact.findMany(),
      db.wxBackground.findMany(),
    ]);
    return NextResponse.json({
      ok: true,
      exportedAt: new Date().toISOString(),
      tables: { coupleHome, contacts, wxBackgrounds },
    });
  } catch (err) {
    console.error('[backup:get]', err);
    return NextResponse.json({ ok: false, error: 'db-error' }, { status: 500 });
  }
}

interface BackupBody {
  tables?: {
    coupleHome?: unknown[];
    contacts?: unknown[];
    wxBackgrounds?: unknown[];
  };
}

export async function POST(req: NextRequest) {
  let body: BackupBody;
  try {
    body = (await req.json()) as BackupBody;
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const tables = body.tables;
  if (!tables || typeof tables !== 'object') {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const coupleHomeRows = Array.isArray(tables.coupleHome) ? tables.coupleHome.slice(0, MAX_ROWS) : [];
  const contactRows = Array.isArray(tables.contacts) ? tables.contacts.slice(0, MAX_ROWS) : [];
  const wxBgRows = Array.isArray(tables.wxBackgrounds) ? tables.wxBackgrounds.slice(0, MAX_ROWS) : [];

  try {
    let coupleHome = 0;
    for (const raw of coupleHomeRows) {
      const row = cleanCoupleHome(raw);
      if (!row) continue;
      await db.coupleHome.upsert({
        where: { workspaceId: row.workspaceId },
        create: row,
        update: { data: row.data, coins: row.coins, rev: row.rev },
      });
      coupleHome++;
    }

    let contacts = 0;
    for (const raw of contactRows) {
      const row = cleanContact(raw);
      if (!row) continue;
      const { id, ...rest } = row;
      await db.contact.upsert({ where: { id }, create: row, update: rest });
      contacts++;
    }

    let wxBackgrounds = 0;
    for (const raw of wxBgRows) {
      const row = cleanWxBackground(raw);
      if (!row) continue;
      await db.wxBackground.upsert({
        where: { key: row.key },
        create: row,
        update: { data: row.data },
      });
      wxBackgrounds++;
    }

    return NextResponse.json({ ok: true, counts: { coupleHome, contacts, wxBackgrounds } });
  } catch (err) {
    console.error('[backup:post]', err);
    return NextResponse.json({ ok: false, error: 'db-error' }, { status: 500 });
  }
}
